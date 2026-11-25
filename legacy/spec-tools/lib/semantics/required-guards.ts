/**
 * 画面が掛かるはずの関門(`guards`)の導出(意味解析の層)。
 *
 * auth-spec-writing.md の要求:「画面が掛かる関門は screen_spec の宣言から**機械的に**導かれ
 * (`requires_auth: true` → `guards: requires_auth` / `for: [{role}]` → `guards: role_gate`)、
 * その関門が `gates` に宣言されている」。対応は 2 本だけの**閉じた辞書**であり、新しい語彙は増やさない。
 *
 * **H4(関門の宣言の突合)・ナビの可視性の生成・ロールの到達(S13)・ユースケースの手数(Y5)が、
 * 同じこの 1 本の写像を読む。** かつては H4 の検証器のファイルに同居していて、生成側・導出側が
 * 検証器を読む逆向きになっていた(設計メモ scripts-layering.md §1-3)。ロール ID は仕様側の宣言
 * (`gates[].role`)から引き、ここでロール名を決め打ちしない。
 */

import type { AuthGateDecl, GateSubject } from '../model/auth/types.js';
import type { ScreenSpec } from '../model/screen/types.js';

/** `gates` の中から `guards: role_gate` の宣言を引く(高々 1 つ。GATE_SUBJECTS が閉じているため)。 */
export function roleGateOf(gates: readonly AuthGateDecl[]): AuthGateDecl | undefined {
  return gates.find((gate) => gate.guards === 'role_gate');
}

/**
 * 画面の宣言から、その画面が掛かるはずの関門(`guards`)を導く。
 *
 * ここが唯一の写像であり、H4 の他の関数も screenTest 側の走査も、同じ規則を
 * 2 度書かないためにこの関数を経由する(将来この対応が増えても直す場所は 1 つ)。
 * `role_gate` が見るロール ID は `gates[].role`(仕様側の宣言)から引く —— まだ `gates` に
 * `role_gate` の宣言が無い(H0 の必須違反として既に報告済み)場合は掛からないものとして扱う。
 *
 * @param screen 画面仕様
 * @param gates auth_spec の関門の宣言
 * @returns 画面が掛かる関門(宣言順: requires_auth → role_gate)
 */
export function requiredGuardsOf(screen: ScreenSpec, gates: readonly AuthGateDecl[]): readonly GateSubject[] {
  const guards: GateSubject[] = [];
  if (screen.requiresAuth) guards.push('requires_auth');
  const role = roleGateOf(gates)?.role;
  if (role !== undefined && screen.forRoles.includes(role)) guards.push('role_gate');
  return guards;
}
