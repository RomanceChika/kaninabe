/**
 * 遷移 RPC(`shape: transition`)が**どの状態機械のどの状態列を動かすか**を決める(推測しない)。
 *
 * 決め手は関数名の形 `apply_{機械}_transition` だけである —— 実行計画の側も同じ形で RPC の名前を組む
 * (`usecase/step-plan-rpc.ts`)ので、名前が宣言を運ぶ。かつてはここが決まらないときに 2 つの既定を選んでいた:
 *
 * | 選んでいた既定 | 何が起きたか |
 * |---|---|
 * | 名前が形に合わなければ、その集約の**最初の**状態機械 | 2 本の機械を持つ集約で、別の機械の遷移(by・from → to・ガード)が本文と述語に写る |
 * | 状態列が引けなければ、名前が `state` の列 | 別の軸の状態で楽観的並行制御を掛け、別の軸の状態を書き換える |
 *
 * どちらも verify は緑のまま、宣言と違う機械を動かす本文が生成される形である。だから名前から決まらなければ
 * 理由つきで失敗させ、T6 が名指して止める(生成器も同じ関数を通るので、検査を通った入力では必ず決まる)。
 *
 * 決まる条件は 3 つ:
 *   1. 名前が `apply_{X}_transition` の形である
 *   2. `{X}` が**その表の集約の**状態機械の名前である(別の集約の同じ名前の機械を拾わない)。または `{X}` が集約の名前で、
 *      その集約の状態機械が**ちょうど 1 本**である(機械の名前が集約の名前と違う集約の、唯一の機械。2 本以上あれば
 *      どれの遷移かが名前から決まらないので断る)
 *   3. その集約の entity_spec に `state({機械})` の列が**ちょうど 1 本**ある
 *
 * 実行計画が呼ぶ RPC の名前の候補(`usecase/step-plan-rpc.ts` の `rpcNameCandidates`)も同じ規則で組む。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef, SpecModel, StateMachineSpec } from '../model/types.js';
import { findEntityFields } from '../semantics/domain-index.js';
import { findStateMachines } from '../semantics/domain-lookup.js';
import type { RpcBodyProblem } from './rpc-params.js';

/** 遷移 RPC の名前の形(`apply_{機械}_transition`)。 */
const TRANSITION_NAME = /^apply_(.+)_transition$/;

/** 遷移 RPC が動かす機械と状態列。 */
export interface TransitionTarget {
  readonly machine: StateMachineSpec;
  readonly field: FieldDef;
}

/** 決めた結果(決まらなければ理由)。 */
export type TransitionTargetResult =
  | { readonly ok: true; readonly target: TransitionTarget }
  | { readonly ok: false; readonly problem: RpcBodyProblem };

/**
 * 遷移 RPC の名前と表の集約から、動かす機械と状態列を決める。
 *
 * @param fn 関数名
 * @param entity 表の集約(エンティティ名)
 * @param domain ドメイン仕様
 * @returns 機械と状態列。名前・集約・列から 1 つに決まらなければ理由
 */
export function transitionTargetOf(fn: string, entity: string, domain: SpecModel): TransitionTargetResult {
  const machines = findStateMachines(domain, entity);
  const known = machines.map((machine) => machine.machine).join(' / ') || '(無し)';
  const name = TRANSITION_NAME.exec(fn)?.[1];
  if (name === undefined) {
    return fail(
      `遷移 RPC ${fn} の名前が apply_{状態機械}_transition の形ではないので、動かす状態機械が決まりません`,
      `関数名を apply_{状態機械}_transition に直す(集約 ${entity} の状態機械: ${known})。` +
        '実行計画も同じ形で RPC の名前を組むので、名前が「どの機械の遷移か」の唯一の宣言である',
      { function: fn, entity, machines: known },
    );
  }
  const machine = machines.find((candidate) => candidate.machine === name) ?? soleMachineNamedBy(domain, entity, name, machines);
  if (machine === undefined) {
    return fail(
      `遷移 RPC ${fn} が名指す状態機械 ${name} は、表の集約 ${entity} の状態機械にありません`,
      `関数名の {状態機械} を集約 ${entity} の状態機械(${known})に直すか、関数を ${name} の集約の表へ移す` +
        '(別の集約の機械を動かす遷移 RPC は、宣言と違う表を書き換える。集約の名前で書けるのは、その集約の状態機械が 1 本だけのとき)',
      { function: fn, entity, machine: name, machines: known },
    );
  }
  const fields = (findEntityFields(domain, entity) ?? []).filter(
    (field) => field.type.kind === 'state' && field.type.machine === machine.machine,
  );
  const [field] = fields;
  if (field === undefined || fields.length !== 1) {
    return fail(
      `集約 ${entity} に state(${machine.machine}) の列が ${fields.length} 本あるので、遷移 RPC ${fn} が動かす状態列が決まりません`,
      `entity_spec ${entity} に state(${machine.machine}) の列をちょうど 1 本宣言する` +
        '(列が無ければ遷移の書き先が無く、2 本あればどちらを書き換えるかを仕組みは選ばない)',
      { function: fn, entity, machine: machine.machine, columns: fields.map((candidate) => candidate.name).join(', ') },
    );
  }
  return { ok: true, target: { machine, field } };
}

/**
 * 名前が集約の名前を指し、その集約の状態機械がちょうど 1 本なら、その機械(そうでなければ undefined)。
 *
 * @param domain ドメイン仕様
 * @param entity 表の集約(エンティティ名)
 * @param name 関数名から取った `{X}`
 * @param machines その集約の状態機械
 * @returns 唯一の機械、または undefined
 */
function soleMachineNamedBy(
  domain: SpecModel,
  entity: string,
  name: string,
  machines: readonly StateMachineSpec[],
): StateMachineSpec | undefined {
  if (!namesAggregate(domain, entity, name) || machines.length !== 1) return undefined;
  return machines[0];
}

/** `name` がその集約を指すか(エンティティ名か集約のディレクトリ名)。 */
function namesAggregate(domain: SpecModel, entity: string, name: string): boolean {
  if (name === entity) return true;
  for (const [aggregate, specs] of domain.aggregates) {
    if (specs.entity?.entity === entity && aggregate === name) return true;
  }
  return false;
}

/** 決まらなかった理由 1 件。 */
function fail(message: string, suggestion: string, counterexample: Readonly<Record<string, string>>): TransitionTargetResult {
  return { ok: false, problem: { message, suggestion, counterexample } };
}
