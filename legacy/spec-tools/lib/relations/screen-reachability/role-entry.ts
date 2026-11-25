/**
 * 「あるロールがある画面に入れるか」の判定(3 つの関門)。到達の判定のいちばん下の規則で、
 * 起点からの探索(`reach.ts`)・状態 × ロールの到達(`state-role-reach.ts`)・遷移後の着地(S15)・
 * 状態の可視性(S14)が同じ答えを読む。
 *
 * 判定の正は generate 側の `navigation-visibility.ts` の導出(意味解析の層 `semantics/required-guards.ts` の `requiredGuardsOf`)と
 * 同じ規則である —「この画面に入れるか」の判断を検証器と生成器で 2 度書かない。
 */

import type { SpecModel } from '../../model/types.js';
import type { AuthGateDecl } from '../../model/auth/types.js';
import type { ScreenSpec } from '../../model/screen/types.js';
import { rolesIntersect } from '../../semantics/action-ground.js';
import { requiredGuardsOf } from '../../semantics/required-guards.js';

/**
 * 指定したロールがその画面に入れるか。
 *
 * 3 つの関門をすべて満たすことを求める。
 * - `for`(ロール階層まで見て交差する。S4 の `checkActions` と同じ判定)
 * - `requires_auth`(true の画面には匿名ロールが入れない)
 * - `role_gate`(gates 側の宣言する 1 ロールに一致しないと入れない。H4 と同じ規則)
 *
 * @param domain ドメイン仕様全体(ロール階層の解決に使う)
 * @param gates auth_spec の `gates`(auth_spec が無い環境では空配列を渡す)
 * @param screen 対象の画面
 * @param role 判定するロール ID
 * @param anonymousRole 匿名ロールの ID(role_spec に `kind: anonymous` の宣言が無ければ `undefined`)
 * @returns 入れるなら true
 */
export function roleCanEnter(
  domain: SpecModel,
  gates: readonly AuthGateDecl[],
  screen: ScreenSpec,
  role: string,
  anonymousRole: string | undefined,
): boolean {
  if (!rolesIntersect(domain, screen.forRoles, [role])) return false;
  const required = requiredGuardsOf(screen, gates);
  if (required.includes('requires_auth') && role === anonymousRole) return false;
  if (required.includes('role_gate')) {
    const gateRole = gates.find((gate) => gate.guards === 'role_gate')?.role;
    if (gateRole !== undefined && role !== gateRole) return false;
  }
  return true;
}
