/**
 * A11 operation の閉世界チェック。
 *
 * action-spec-writing.md の A11:「`app/src/operation/{aggregate}/{event}.ts` の実装ファイルは、
 * すべて仕様に宣言された操作に対応する」。
 *
 * A2(Server Action)と A10(走査)は「宣言されたものが実装されているか」を見るが、その逆
 * —— **仕様のどこにも無い操作の実装が置かれていないか** —— は誰も見ていなかった。
 * `operation/entry/teleport.ts` のようなファイルは ESLint(1 ファイル完結)も既存の A 群も
 * 素通しで、由来の無い書き込み経路が静かに増える(S7 の undeclaredRoutes と同じ種類の穴)。
 *
 * 母集合は scan.ts が集めた `operationFiles`。配置規約(server-actions.md /
 * framework/lint-config/src/rules/operation-naming.mjs)どおり `{aggregate}/{event}.ts` を
 * ドメインイベント ID `{aggregate}.{event}` に写し(写す規約は `operation-path.ts` に 1 つ。
 * A14 も同じものを使う)、宣言済み集合(state_spec の全イベント + access_spec の
 * creates / deletes / writes の予約 ID)との差分をエラーにする。操作ではないもの
 * (横断モジュール・定型・保存点・ジョブ基盤・IF 宣言)は仕組みの土台の宣言に従って除く。
 */

import type { Finding, TraceVerifier } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { TraceInput } from '../input.js';
import type { SpecModel } from '../../model/types.js';
import { operationIdOf } from '../operation-path.js';
import {
  CREATE_EVENT,
  DELETE_EVENT,
  UPDATE_EVENT,
  listCreates,
  listDeletes,
  listEvents,
  listUpdates,
} from '../../semantics/domain-index.js';

/** A11: operation の実装ファイルがすべて仕様の宣言に対応するかを検証する。 */
export const undeclaredOperationsVerifier: TraceVerifier = {
  id: 'A11',
  title: '操作の閉世界 — operation の実装ファイルはすべて仕様に宣言がある',

  verify(input: TraceInput): Finding[] {
    // 実装がまだ無い(app/ を読めない)構成では判断材料が無い(A2 の実装側と同じ扱い)。
    if (!input.tests.available) return [];
    const declared = declaredOperationIds(input.domain);
    const findings: Finding[] = [];

    for (const file of input.tests.operationFiles) {
      const id = operationIdOf(file, input.layout, input.roots);
      if (id === null || declared.has(id)) continue;
      findings.push(undeclaredFinding(file, id));
    }
    findings.push(...unhandledButImplemented(input));
    return findings;
  },
};

/**
 * `unhandled:`(A4 の免除宣言。「まだ action_spec を作らない」)で名指しされた操作の
 * operation 実装が、すでに置かれていないかを見る。
 *
 * A11 の本体(上のループ)は「仕様のどこにも無い操作」だけを咎めるが、`unhandled` に
 * 挙がっている操作は**仕様には実在する**(state_spec / access_spec の宣言はある)ため、
 * 本体の判定だけでは通り抜けてしまう。しかし `unhandled` は「入口(Server Action)を
 * まだ作らない」という宣言であり、その裏付けとなる operation の書き込み経路が先に
 * 実装されているなら、宣言と実態が食い違っている——Server Action を経ずに実行できる書き込み
 * 経路が、免除の陰で静かに存在することになる(宣言のレビューだけでは気付けない)。
 */
function unhandledButImplemented(input: TraceInput): Finding[] {
  const unhandled = new Map(input.actions.unhandled.map((decl) => [decl.event, decl]));
  if (unhandled.size === 0) return [];
  const findings: Finding[] = [];

  for (const file of input.tests.operationFiles) {
    const id = operationIdOf(file, input.layout, input.roots);
    if (id === null) continue;
    const decl = unhandled.get(id);
    if (decl === undefined) continue;
    findings.push(
      traceFinding('A11', {
        message:
          `${file} は README.md の unhandled で「まだ作らない」と宣言された ${id} の実装ですが、` +
          'すでに operation が置かれています',
        location: { file },
        suggestion:
          `unhandled の宣言と実装が食い違っている。action_spec を作って Server Action を用意し ` +
          `unhandled から ${id} を消すか、まだ公開しないなら operation の実装を削除する` +
          '(unhandled は「入口を持たない」ことの宣言であり、書き込み経路が先に存在してはならない)',
        counterexample: { file, operation: id, unhandled_reason: decl.reason },
      }),
    );
  }
  return findings;
}

/**
 * 仕様に宣言された操作 ID の集合を作る。
 *
 * - state_spec の全イベント(`{machine}.{event}`。system 専用も含む — 走査の実体が
 *   operation に同居するため。A10 の `scans` が指す先はここに必ず入る)
 * - access_spec の予約 ID(`{entity}.create` / `{entity}.delete` / `{entity}.update`)。
 *   集約ディレクトリ名とエンティティ名が食い違う場合に備え、どちらの綴りも許す
 *   (domain-index の findAccessOp / S10 の canonical 化と同じ規則)
 */
function declaredOperationIds(model: SpecModel): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of listEvents(model)) {
    ids.add(entry.id);
    ids.add(`${entry.aggregate}.${entry.event.id}`);
  }
  const accessOps = [
    [CREATE_EVENT, listCreates(model)],
    [DELETE_EVENT, listDeletes(model)],
    [UPDATE_EVENT, listUpdates(model)],
  ] as const;
  for (const [op, entries] of accessOps) {
    for (const entry of entries) {
      ids.add(entry.id);
      ids.add(`${entry.aggregate}.${op}`);
    }
  }
  return ids;
}

/** 仕様に無い実装ファイルの Finding。 */
function undeclaredFinding(file: string, id: string): Finding {
  return traceFinding('A11', {
    message: `${file} に対応する操作が仕様に宣言されていません(${id} は state_spec のイベントにも access_spec の予約 ID にもありません)`,
    location: { file },
    suggestion:
      `この操作を体系に載せるなら、まず仕様に宣言する(遷移なら state_spec の events、` +
      `作成/削除/編集なら access_spec の creates / deletes / writes)。` +
      `不要な実装ならファイルを削除する。宣言の無い操作の実装は、どの検査の視界にも入らない`,
    counterexample: { file, operation: id },
  });
}
