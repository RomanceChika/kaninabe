/**
 * 定型 RPC の**名前の規約**(server-actions.md「5 形の定型」)。
 *
 * 計画(`usecase/step-plan-rpc.ts`。どの RPC を呼ぶか)と、操作の属性の導出(`semantics/operation-facts.ts`。
 * 遷移が通る RPC の書き込み)と、書き込みの宣言の検査(T22。どのイベントがその RPC を通るか)が、
 * 同じ 1 つの規約で RPC を引く。導出を 2 か所に書かないため前段(model)に置く。
 *
 * 純関数であり、アプリの語彙は 1 語も持たない。
 */

/** RPC の形(計画の手順の種別と同じ 4 つ)。 */
export type RpcNameKind = 'create' | 'transition' | 'delete' | 'update';

/** 作成 RPC の名前の前置。 */
const CREATE_RPC_PREFIX = 'insert_';

/** 遷移 RPC の名前の前後。 */
const TRANSITION_RPC_PREFIX = 'apply_';
const TRANSITION_RPC_SUFFIX = '_transition';

/** 削除・編集 RPC の名前の前置。 */
const DELETE_RPC_PREFIX = 'delete_';
const UPDATE_RPC_PREFIX = 'update_';

/**
 * その形の RPC の名前の候補(最初に見つかったものが正)。
 *
 * 遷移は**状態機械の名前**で引く(`apply_{機械}_transition`)。状態機械の名前が集約の名前と違う
 * (副次状態機械・別名の機械)とき、集約名の RPC(`apply_{集約}_transition`)を候補に足すのは、**その集約の
 * 状態機械がちょうど 1 本のときだけ**である —— SQL の側(`sql/rpc-transition-machine.ts`)は集約名の RPC を
 * その唯一の機械の遷移として組むので、機械が 2 本以上の集約で別の機械のイベントを集約名の RPC に渡すと、宣言と
 * 違う機械の遷移表で判定され、別の軸の状態列を書き換える。候補に無ければ呼び手が「無い」と名指して止める。
 *
 * @param kind 形
 * @param entity 集約名
 * @param machine 状態機械の名前(遷移以外は null)
 * @param soleMachine その集約の状態機械がちょうど 1 本か(呼び手がドメイン仕様から数える)
 * @returns 名前の候補(優先順)
 */
export function rpcNameCandidates(kind: RpcNameKind, entity: string, machine: string | null, soleMachine: boolean): readonly string[] {
  switch (kind) {
    case 'create':
      return [`${CREATE_RPC_PREFIX}${entity}`];
    case 'delete':
      return [`${DELETE_RPC_PREFIX}${entity}`];
    case 'update':
      return [`${UPDATE_RPC_PREFIX}${entity}`];
    default: {
      const byEntity = `${TRANSITION_RPC_PREFIX}${entity}${TRANSITION_RPC_SUFFIX}`;
      if (machine === null || machine === entity) return [byEntity];
      const byMachine = `${TRANSITION_RPC_PREFIX}${machine}${TRANSITION_RPC_SUFFIX}`;
      return soleMachine ? [byMachine, byEntity] : [byMachine];
    }
  }
}
