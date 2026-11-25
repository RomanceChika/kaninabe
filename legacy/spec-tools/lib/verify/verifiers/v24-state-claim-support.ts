/**
 * V24 状態の `claim` の対応範囲 — 実行時のロール解決とオラクルが追随するまで、黙って誤らせない。
 *
 * `claim` が state / enum の値の集合を指す形(と、`kind: authenticated_default` との併記。ADR-0018)は、
 * 語彙と DB の述語(定型 RPC・RLS)に加えて、**先読み(実行時のロール解決。`RoleTables` の
 * `authenticatedWhen` / `gates`)・実行計画(`values` / `roleGates`)・オラクル(world。条件を満たす人 /
 * 満たさない人)も値の集合で読む**(束 3・4。追随済み)。追随前にこの形で宣言した仕様を通すと、world が
 * 状態の欄に `true` を置き、先読みが値を見ないまま、生成物と挙動テストが**黙って誤った世界**で緑になった。
 *
 * だから追随が済むまでは error で止めていた。生成器は throw しない(検証器が先に止める)。
 * 追随が済んだ今は `STATE_CLAIM_SUPPORTED` が `true` で、この検査は何も言わない(切り替えはここ 1 か所。
 * 追随していない対象(新しい生成物・新しい world)を足すときは `false` に戻して止めてから足す)。
 */

import type { RoleDef, SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { Verifier } from '../../check-api/contract.js';
import { claimText } from '../../model/role-claim.js';

/** この検証器の ID。 */
const VERIFIER_ID = 'V24';

/** 実行時のロール解決とオラクルが状態の `claim` に追随したか(**唯一のスイッチ**)。 */
export const STATE_CLAIM_SUPPORTED = true;

/** 追随していない形(値の集合を持つ `claim`、または `kind` との併記)。 */
function isPending(role: RoleDef): boolean {
  return role.claim !== undefined && (role.claimValues !== undefined || role.kind !== undefined);
}

/**
 * 検証器を作る(対応済みかを引数に取る。登録するのは `STATE_CLAIM_SUPPORTED` で作った 1 つだけ)。
 *
 * @param supported 追随が済んでいるか
 * @returns V24 の検証器
 */
export function createStateClaimSupportVerifier(supported: boolean): Verifier {
  return {
    id: VERIFIER_ID,
    title: '状態の claim の対応範囲 — 実行時のロール解決とオラクルが追随するまで止める',

    verify(model: SpecModel): Finding[] {
      if (supported) return [];
      return model.roles.roles.filter(isPending).map((role) => ({
        verifier: VERIFIER_ID,
        severity: 'error' as const,
        message:
          `ロール ${role.id} の claim(${claimText(role)})は未対応です` +
          '(状態の claim は実行時のロール解決とオラクルの追随(束 3・4)が済むまで使えません)',
        location: role.location,
        suggestion:
          'DB の述語(定型 RPC・RLS)は対応済みだが、先読みと world は claim を boolean の欄としてしか読まず、' +
          '宣言を通すと挙動テストが誤った世界で緑になる。追随の束が入るまでは、このロールの claim を書かない' +
          '(状態の条件は各 when に書くか、追随を待つ)',
        counterexample: { role: role.id, claim: claimText(role) },
      }));
    },
  };
}

/** V24: 状態の `claim`(と `kind` との併記)は追随が済むまで error で止める。 */
export const stateClaimSupportVerifier: Verifier = createStateClaimSupportVerifier(STATE_CLAIM_SUPPORTED);
