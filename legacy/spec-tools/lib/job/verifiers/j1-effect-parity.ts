/**
 * J1 ジョブカタログ ⇔ (state_spec の `effects` + access_spec の `writes[].effects`)の
 * 双方向閉世界。
 *
 * job-spec-writing.md の要求:
 *   - `effects[].do` / `writes[].effects` に現れる ID は、すべてカタログに `source: outbox` の
 *     行を持つこと
 *   - カタログの `source: outbox` の行は、すべてどこかの `effects` / `writes[].effects`、または
 *     時刻で起きる走査(`source: schedule`)の `emits` から積まれること
 *   - `source: manual` の行は `effects` / `writes[].effects` に現れないこと(人が押して積むものに
 *     自動発火は無い。N1 が `trigger: manual` の通知に課すのと同じ規則であり、両者は対で
 *     1 つの事実を表す)
 *
 * **`writes[].effects` は state_spec を持たない編集(update-fields)の発火元である**
 * (domain-spec-writing.md §access_spec)。状態遷移の `effects` と違って対応するドメイン
 * イベントが無いため、参照元は `{entity}.update`(update-fields テンプレートの予約イベントID)
 * と表す。
 *
 * N1(通知)との違いは**母集合を接頭辞で切らない**ことである。N1 は `notify_` で始まる副作用だけを
 * 見るが、ジョブカタログは「outbox に積まれうるもの」の全数を宣言するので、
 * `create_member_account` のような通知でない副作用も行を持たなければならない
 * (それらが「積まれない」ことこそ宣言の対象である — 暗黙の挙動の禁止)。
 *
 * 実装のハンドラ一覧との突合は app 側のユニットテスト(job-catalog.test.ts)が担い、
 * 仕様 ⇔ 実装の輪はそこで閉じる。
 *
 * `effects` の走査(`collectJobEffects`)は意味解析の層(`lib/semantics/effect-refs.ts`)にある ——
 * ジョブ本文の生成器も同じ走査を読むので、検証器のファイルには置かない。
 */

import type { SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import { collectJobEffects } from '../../semantics/effect-refs.js';
import { emittedBy } from '../emits.js';
import type { JobSpecModel } from '../../model/job/types.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'J1';

/** J1 の指摘を組み立てる。 */
function j1Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/**
 * カタログの outbox 行と `effects` を双方向に突き合わせる。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param jobs 読み込み済みのジョブカタログ
 * @returns 違反のリスト
 */
export function verifyJobEffectParity(
  domain: SpecModel,
  jobs: JobSpecModel,
  roots: ProductRoots,
): Finding[] {
  const catalog = jobs.catalog;
  if (catalog === null) return [];

  const effects = collectJobEffects(domain);
  const declared = new Map(catalog.jobs.map((decl) => [decl.id, decl]));
  const findings: Finding[] = [];

  const seen = new Set<string>();
  for (const ref of effects) {
    const decl = declared.get(ref.id);
    if (decl === undefined) {
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      findings.push(
        j1Finding({
          message: `${ref.event} の effects にある副作用 ${ref.id} がジョブカタログにありません`,
          location: ref.location,
          suggestion:
            `${specPath(roots, 'backend/jobs.md')} の jobs に "- id: ${ref.id} / source: outbox" の行を足す` +
            '(何が積まれ・失敗したらどうなるかを宣言しないジョブは、どの仕様書にも現れない暗黙の挙動になる)',
          counterexample: { job: ref.id, event: ref.event },
        }),
      );
      continue;
    }
    if (decl.source !== 'outbox') {
      findings.push(
        j1Finding({
          message: `${ref.id} は source: ${decl.source} なのに ${ref.event} の effects から積まれています`,
          location: decl.location,
          suggestion:
            'source: outbox に直すか、effects の do から外す(schedule は時刻で起きるもの・' +
            'manual は人が押して積むものの宣言であり、どちらも effects からの投入と両立しない)',
          counterexample: { job: ref.id, event: ref.event },
        }),
      );
    }
  }

  // 積む元は 2 つある — 遷移 / 編集の `effects` と、時刻で起きる走査の `emits`(積み直しも含む)。
  const enqueued = new Set([...effects.map((ref) => ref.id), ...emittedBy(catalog).keys()]);
  for (const decl of catalog.jobs) {
    if (decl.source !== 'outbox' || enqueued.has(decl.id)) continue;
    findings.push(
      j1Finding({
        message: `カタログの ${decl.id}(source: outbox)を積む effects がありません`,
        location: decl.location,
        suggestion:
          `どこかの state_spec の effects に "- on: {イベント} / do: [${decl.id}]" を足すか、` +
          `時刻で起きる走査(source: schedule)の emits に ${decl.id} を書く。` +
          '時刻で起きる走査そのものなら source: schedule にする(誰にも積まれない outbox ジョブは死んだ宣言)',
        counterexample: { job: decl.id },
      }),
    );
  }
  return findings;
}
