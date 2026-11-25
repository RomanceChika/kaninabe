/**
 * `navigations` の `on: {イベント ID}.success` 1 本が、実際に迎えられる行き先かどうかの共通判定。
 *
 * S15(検証。満たさなければエラー)と L2 網羅台帳(生成。判定はせず「どこへ着地するか」を出す)が
 * 同じ判定を共有する。
 */

import type { GuardServices } from '../guard/ast.js';
import type { SpecModel } from '../model/types.js';
import type { AuthGateDecl } from '../model/auth/types.js';
import type { EventEntry } from '../semantics/domain-index.js';
import { entityNameOfAggregate, isHumanRole } from '../semantics/domain-index.js';
import type { ScreenSpec } from '../model/screen/types.js';
import { admitsState, preconditionExpr, stateFieldOf } from '../semantics/state-admit.js';
import { roleCanEnter } from '../relations/screen-reachability/index.js';
import { rolesIntersect } from '../semantics/action-ground.js';

/** 着地 1 件の判定結果。 */
export interface LandingEvaluation {
  /** 遷移後の状態で行き先の precondition が成立するか(状態フィールドを引けなければ N/A = true)。 */
  readonly admitsState: boolean;
  /**
   * `T` の `by` のうち、この画面(`fromScreen`)から実際に実行しうる(`for` と交差する)人間ロールで、
   * かつ行き先に入れないもの。空なら「入れないロールは無い」。
   */
  readonly forbiddenRoles: readonly string[];
}

/**
 * 着地 1 件を判定する。
 *
 * @param guards ガード式の共有サービス
 * @param domain ドメイン仕様全体
 * @param fromScreen `navigations` を宣言している画面(操作の発火元)
 * @param target 行き先の画面
 * @param event 対象の遷移(集約・機械・イベントの組)
 * @param gates auth_spec の `gates`
 * @param anonymousRole 匿名ロールの ID
 * @param systemRole 内部実行ロールの ID
 * @returns 判定結果
 */
export function evaluateLanding(
  guards: GuardServices,
  domain: SpecModel,
  fromScreen: ScreenSpec,
  target: ScreenSpec,
  event: EventEntry,
  gates: readonly AuthGateDecl[],
  anonymousRole: string | undefined,
  systemRole: string | undefined,
): LandingEvaluation {
  const stateField = stateFieldOf(domain, event.aggregate, event.machine.machine);
  const admits =
    stateField === undefined
      ? true
      : admitsState(
          guards,
          domain,
          preconditionExpr(guards, target),
          target.subject?.entity,
          event.aggregate,
          entityNameOfAggregate(domain, event.aggregate),
          stateField,
          event.event.to,
        );

  const forbiddenRoles = event.event.by.filter(
    (role) =>
      isHumanRole(role, systemRole) &&
      rolesIntersect(domain, fromScreen.forRoles, [role]) &&
      !roleCanEnter(domain, gates, target, role, anonymousRole),
  );

  return { admitsState: admits, forbiddenRoles };
}
