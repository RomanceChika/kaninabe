/**
 * T6 の続き: **遷移の RPC が受ける列の引数(`p_{列}`)は、その機械の宣言が名指す列だけ**であることの検査
 * (点検 7 回目 A7-1)。
 *
 * 遷移の RPC は機械の全イベントで共用で、列の引数は本文で `coalesce(p_列, t.列)` として書かれる。
 * 引数の値を決めるのは実行計画(param-source-fields.ts の許可表)だが、data_table の `params` に
 * **どの宣言も名指さない列**を足せること自体が「その列を誰が書くか」の宣言の外の口である ——
 * 以前はそこに作成のための自動補完(「必須で入力に無い実行者への参照は実行者」)が効き、
 * `records_actor` を宣言していない全イベントが実行者をその列(binding の根拠)に書いた。
 *
 * 許すのは次のどれかに現れる列だけ(許可表。拒否の列挙ではない):
 *   - その機械のどれかのイベントの `records_actor` / `clears` / `records_time`
 *   - その機械のどれかのイベントを扱う action_spec の `input` / `computes`(自集約の欄)
 *
 * 本文を生成しない関数(手書き・`composite`)は本文の側が正なので、呼び手(T6 の `checkBuildable`)が渡さない。
 */

import type { Finding } from '../../kernel/finding.js';
import type { RpcBodyFacts } from '../../sql/rpc-facts.js';
import type { DataFunctionDecl, DataTableSpec } from '../../model/data/types.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import type { SpecModel } from '../../model/types.js';
import { transitionTargetOf } from '../../sql/rpc-transition-machine.js';

/** この検査の ID(T6 の続き)。 */
const VERIFIER_ID = 'T6';

/**
 * 遷移の RPC の列の引数のうち、その機械の宣言が名指さない列を指摘する。
 *
 * @param fn 関数の宣言(遷移の本文を生成するもの)
 * @param table その関数の持ち場
 * @param facts 本文に要る事実(引数の役目)
 * @param actions action_spec
 * @param domain ドメイン仕様
 * @returns 違反のリスト
 */
export function checkTransitionColumnsDeclared(
  fn: DataFunctionDecl,
  table: DataTableSpec,
  facts: RpcBodyFacts,
  actions: ActionSpecModel,
  domain: SpecModel,
): Finding[] {
  const target = transitionTargetOf(fn.name, facts.entity, domain);
  if (!target.ok) return []; // 機械が決まらない宣言は事実の収集が先に止める(T6)。
  const allowed = declaredColumns(target.target.machine.machine, target.target.machine.events, facts.entity, actions);
  const findings: Finding[] = [];
  for (const param of facts.params) {
    if (param.role.kind !== 'column') continue;
    const column = param.role.field.name;
    if (allowed.has(column)) continue;
    findings.push({
      verifier: VERIFIER_ID,
      severity: 'error',
      message:
        `遷移の RPC ${fn.name} の引数 ${param.name} は、状態機械 ${target.target.machine.machine} のどの宣言も名指さない列 ${column} を受けます` +
        '(どのイベントがこの列を書くのかが仕様に無いまま、全イベントの呼び手がこの列を書ける口になります)',
      location: { ...table.location, pointer: `functions.${fn.name}.params` },
      suggestion:
        `遷移が実行者を ${column} に書き留めるなら、state_spec のそのイベントに "records_actor: [${column}]" を宣言する。` +
        `利用者が選ぶ値なら、その遷移の action_spec の input に ${facts.entity}.${column} を宣言する。` +
        `計算で決まる値なら computes を宣言する。どれでもないなら params / args から ${param.name} を外す`,
      counterexample: {
        function: fn.name,
        param: param.name,
        machine: target.target.machine.machine,
        declared: [...allowed].join(', ') || '(なし)',
      },
    });
  }
  return findings;
}

/** その機械の宣言が名指す、自集約の列(イベントの 3 語と、そのイベントを扱う操作の input / computes)。 */
function declaredColumns(
  machine: string,
  events: readonly { readonly id: string; readonly recordsActor?: readonly string[]; readonly clears?: readonly string[]; readonly recordsTime?: readonly string[] }[],
  entity: string,
  actions: ActionSpecModel,
): ReadonlySet<string> {
  const columns = new Set<string>();
  const handled = new Set(events.map((event) => `${machine}.${event.id}`));
  for (const event of events) {
    for (const column of [...(event.recordsActor ?? []), ...(event.clears ?? []), ...(event.recordsTime ?? [])]) columns.add(column);
  }
  for (const action of actions.actions) {
    if (!handled.has(action.handles.raw)) continue;
    for (const ref of action.input) if (ref.entity === entity) columns.add(ref.field);
    for (const decl of action.computes) if (decl.entity === entity) columns.add(decl.field);
  }
  return columns;
}
