/**
 * **どの RPC を呼ぶか**の引き当てと、手順の付随情報(RPC 名の命名規約・data_table の `functions`
 * への問い合わせ・手順の効果の読み出し)。
 *
 * 使い手は 2 系統ある。保存点の手順の列を組む `step-plan.ts` と、受信の行を「記録と遷移の 2 手順」
 * に接地する `inbound/inbound-plan.ts`(別の導出。手順の列は組まず、RPC 名の引き当てだけを借りる)。
 * 後者は保存点の計画の型を要らないので、引き当てだけを別の部品として置いてある。
 *
 * 関数名は server-actions.md「5 形の定型」が定める命名規約から組み立て、実在は data_table の
 * `functions` に問い合わせる。**アプリの語彙は 1 語も持たない。**
 */

import type { EventDef, SpecModel, StateMachineSpec } from '../model/types.js';
import type { DataFunctionDecl, DataTableSpecModel } from '../model/data/types.js';
import { findEntitySpec, findStateMachines } from '../semantics/domain-lookup.js';
import type { StepKind } from './step-plan.js';
import { rpcNameCandidates as modelRpcNameCandidates } from '../model/data/rpc-names.js';

/**
 * その形の RPC の名前の候補(server-actions.md「5 形の定型」の命名規約)。
 *
 * 規約そのものは前段(`model/data/rpc-names.ts`)にある —— 操作の属性の導出と書き込みの宣言の検査も
 * 同じ規約で RPC を引くので、ここは集約の状態機械の本数を数えて渡すだけにする。
 *
 * @param kind 手順の形
 * @param entity 集約(エンティティ名)
 * @param machine 遷移の状態機械の名前(遷移でなければ null)
 * @param domain ドメイン仕様(集約の状態機械の本数を引く)
 * @returns 名前の候補(先が優先)
 */
export function rpcNameCandidates(kind: StepKind, entity: string, machine: string | null, domain: SpecModel): readonly string[] {
  return modelRpcNameCandidates(kind, entity, machine, findStateMachines(domain, entity).length === 1);
}

/** 命名規約の候補を順に引く(最初に見つかったものが正)。 */
export function findStepRpc(
  model: DataTableSpecModel | undefined,
  kind: StepKind,
  entity: string,
  machine: string | null,
  domain: SpecModel,
): DataFunctionDecl | null {
  for (const name of rpcNameCandidates(kind, entity, machine, domain)) {
    const fn = findRpc(model, name);
    if (fn !== null) return fn;
  }
  return null;
}

/**
 * その操作の label(フォームの節の見出しの既定値)。
 *
 * 遷移はイベントの label、作成は集約の label を使う —— どちらも任意のキーなので、
 * 無ければ操作 ID そのものを出す(**無い値を発明しない**。表示名の表を持たない欄を
 * 欄名そのもので出すのと同じ流儀である)。
 */
export function operationLabel(domain: SpecModel, op: string, entity: string, event: EventDef | null): string {
  if (event !== null) return event.label ?? op;
  return findEntitySpec(domain, entity)?.label ?? op;
}

/** その遷移が積む副作用 ID(state_spec の `effects[].do`)。 */
export function effectsOf(machine: StateMachineSpec, event: EventDef): readonly string[] {
  return machine.effects.find((effect) => effect.on === event.id)?.do ?? [];
}

/** 全 data_table を横断して `kind: rpc` の関数宣言を引く(帰属は T1 が 1 意にしている)。 */
function findRpc(model: DataTableSpecModel | undefined, name: string): DataFunctionDecl | null {
  for (const table of model?.tables ?? []) {
    for (const fn of table.functions) {
      if (fn.name === name && fn.kind === 'rpc') return fn;
    }
  }
  return null;
}
