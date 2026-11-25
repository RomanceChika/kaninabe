/**
 * T19 **同一トランザクションで実現される効果が、実現する RPC を名指しする**（ジョブカタログの `realized_by`）の接地。
 *
 * 操作の属性（destructive / bulk / touches_personal）と遷移書き込みの期待表は、「この操作が実際に通る RPC の
 * `also_writes`」から連鎖を導く。どの RPC かを集約の関数の本数から推測すると、関数を 1 本足しただけで連鎖が消える
 * （確認の文言から「データが削除されます」が落ちた）ので、効果の側が RPC を名指しする。この検査は名指しが
 * **過不足なく・実在する RPC に**向いていることを見る:
 *
 *   - 同一トランザクションで実現される効果（`kind` の語が `in_transaction`）は `realized_by` を必ず持つ（無い = 連鎖が推測になる）
 *   - キーは、その効果を `effects` に宣言している全部のイベントと過不足なく一致する
 *     （足りないイベントは連鎖を落とし、余るキーは存在しないイベントを名指している）
 *   - 名指した RPC は data_table の `kind: rpc` に実在する（実在しない名指しは何も実現しない）
 *
 * セッションを終える効果（`ends_sessions`）と、認証フローの主語を匿名化する効果（`anonymizes`。J5）は、さらに `platform_call`（認証基盤の呼び出しを本文に持つ RPC）を名指しする（R11）:
 *
 *   - 名指した RPC は data_table に実在する書き込み RPC（kind: rpc）で、引数は uuid 1 つ（終える相手のアカウント）
 *   - `realized_by` の RPC は、その RPC 自身であるか、`calls` に宣言して呼ぶ（呼ばない RPC はセッションを終えない。
 *     本文が本当に呼ぶかは rpc-parity が `calls` の両方向で見る）
 *
 * 形（キーがイベント ID・値が RPC 名）はパーサー（J0）が見る。逆向き（`realized_by` を持つのに in_transaction でない行）も
 * パーサーが落とす。名指しした RPC が本当にその効果を実現しているかは、見張りテストが担う。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import type { JobDecl, JobSpecModel } from '../../model/job/types.js';
import type { DataFunctionDecl, DataTableSpecModel } from '../../model/data/types.js';
import { collectJobEffects } from '../../semantics/effect-refs.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T19';

/** T19 の指摘を組み立てる。 */
function finding(decl: JobDecl, pointer: string, message: string, suggestion: string, counterexample: Record<string, string>): Finding {
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message,
    location: { ...decl.location, pointer },
    suggestion,
    counterexample,
  };
}

/** 1 行ぶんの検査。 */
function verifyJob(decl: JobDecl, firing: readonly string[], rpcs: ReadonlySet<string>, rpcsKnown: boolean): Finding[] {
  const realizedBy = decl.realizedBy;
  if (realizedBy === undefined) {
    return [
      finding(
        decl,
        `jobs.${decl.id}.realized_by`,
        `同一トランザクションで実現される効果 ${decl.id} が、実現する RPC を名指ししていません（realized_by がありません）`,
        `${decl.id} の行に "realized_by: { ${firing.map((event) => `${event}: {RPC 名}`).join(', ') || '{イベント ID}: {RPC 名}'} }" を書く` +
          '（連鎖＝別の表も書くか・個人データを書き換えるかは、名指しした RPC の also_writes だけから導く。推測しない）',
        { job: decl.id, events: firing.join(', ') },
      ),
    ];
  }
  const findings: Finding[] = [];
  for (const event of firing.filter((candidate) => realizedBy[candidate] === undefined)) {
    findings.push(
      finding(
        decl,
        `jobs.${decl.id}.realized_by`,
        `${decl.id} は ${event} の effects に宣言されていますが、realized_by に ${event} がありません`,
        `realized_by に "${event}: {そのイベントが通る RPC 名}" を足す（名指しの無いイベントは連鎖が落ちる）`,
        { job: decl.id, event },
      ),
    );
  }
  for (const [event, rpc] of Object.entries(realizedBy)) {
    if (!firing.includes(event)) {
      findings.push(
        finding(
          decl,
          `jobs.${decl.id}.realized_by.${event}`,
          `${decl.id} の realized_by の ${event} は、この効果を effects に宣言しているイベントではありません`,
          `${event} を消すか、その遷移の effects に ${decl.id} を宣言する（宣言しているイベント: ${firing.join(', ') || 'なし'}）`,
          { job: decl.id, event, declared: firing.join(', ') },
        ),
      );
    }
    if (rpcsKnown && !rpcs.has(rpc)) {
      findings.push(
        finding(
          decl,
          `jobs.${decl.id}.realized_by.${event}`,
          `${decl.id} の realized_by の ${event}: ${rpc} は、data_table に実在する書き込み RPC（kind: rpc）ではありません`,
          `${rpc} を data_table の functions に kind: rpc で宣言するか、実際に ${event} が通る RPC の名前に直す`,
          { job: decl.id, event, rpc },
        ),
      );
    }
  }
  return findings;
}

/** 認証基盤を呼ぶ効果の `platform_call` の接地（RPC の実在・引数・`realized_by` の RPC からの呼び出し）。 */
function verifyPlatformCall(decl: JobDecl, functions: ReadonlyMap<string, DataFunctionDecl>): Finding[] {
  const call = decl.platformCall;
  if (call === undefined) return [];
  const target = functions.get(call);
  const pointer = `jobs.${decl.id}.platform_call`;
  if (target?.kind !== 'rpc') {
    return [
      finding(
        decl,
        pointer,
        `${decl.id} の platform_call ${call} は、data_table に実在する書き込み RPC（kind: rpc）ではありません`,
        `${call} を data_table の functions に kind: rpc で宣言する（本文に認証基盤の呼び出しを閉じる。引数は uuid 1 つ）`,
        { job: decl.id, rpc: call },
      ),
    ];
  }
  const findings: Finding[] = [];
  if (target.args.length !== 1 || target.args[0] !== 'uuid') {
    findings.push(
      finding(
        decl,
        pointer,
        `${decl.id} の platform_call ${call} の引数が uuid 1 つではありません（${target.args.join(', ') || '引数なし'}）`,
        `${call} は相手のアカウント（uuid）だけを受け取る RPC にする`,
        { job: decl.id, rpc: call, args: target.args.join(', ') },
      ),
    );
  }
  for (const [event, rpc] of Object.entries(decl.realizedBy ?? {})) {
    if (rpc === call || functions.get(rpc)?.calls?.includes(call) === true) continue;
    findings.push(
      finding(
        decl,
        `jobs.${decl.id}.realized_by.${event}`,
        `${decl.id} の realized_by の ${event}: ${rpc} が、platform_call の ${call} を calls に宣言していません（認証基盤の呼び出しが無い）`,
        `${rpc} の本文が ${call} を呼ぶようにして、data_table の ${rpc} に "calls: [${call}]" を足す（生成する遷移の RPC は効果を載せたイベントで自動で呼ぶ）`,
        { job: decl.id, event, rpc, platform_call: call },
      ),
    );
  }
  return findings;
}

/**
 * 同一トランザクションで実現される全効果の `realized_by` を、効果の宣言元と data_table に突き合わせる。
 *
 * @param domain 構築済みのドメイン仕様モデル（効果の宣言元）
 * @param dataTables 読み込み済みの data_table（RPC の実在）
 * @param jobs 読み込み済みのジョブカタログ（無い構成では何も言わない）
 * @returns 違反のリスト
 */
export function verifyRealizedBy(domain: SpecModel, dataTables: DataTableSpecModel, jobs: JobSpecModel | undefined): Finding[] {
  if (jobs?.available !== true || jobs.catalog === null) return [];
  const refs = collectJobEffects(domain);
  const functions = new Map((dataTables.available ? dataTables.tables.flatMap((table) => table.functions) : []).map((fn) => [fn.name, fn] as const));
  const rpcs = new Set([...functions.values()].filter((fn) => fn.kind === 'rpc').map((fn) => fn.name));
  return jobs.catalog.jobs
    .filter((decl) => decl.inTransaction === true)
    .flatMap((decl) => [
      ...verifyJob(
        decl,
        [...new Set(refs.filter((ref) => ref.id === decl.id).map((ref) => ref.event))],
        rpcs,
        dataTables.available,
      ),
      ...(dataTables.available ? verifyPlatformCall(decl, functions) : []),
    ]);
}
