/**
 * S15 遷移後の着地検査。
 *
 * `navigations` の `on: {イベント ID}.success` は「その操作が成立した**結果**、行き先の画面へ
 * 送る」という宣言だが、これまで検証しているのは行き先が実在すること(S2)だけで、
 * **送った先で実際に迎えられるか**は見ていなかった。遷移が成立すれば対象は必ず `to` の状態に
 * なっているので、行き先画面 `P2` について次の 2 つを検証する。
 *
 * - `T` の `to` 状態で `P2` の `precondition` が成り立つ(S13 と同じ記号評価 `admitsState`)
 * - `T` の `by` のうち、**この画面(`P1`)から実際に実行しうる人間ロール**が `P2` に入れる
 *   (`roleCanEnter`。S13 と同じ規則)
 *
 * `by` を丸ごと見ないのは、同じ遷移を複数のロールが別々の画面から起こせる場合があるためである
 * (実例: `membership.suspend` は `by: [account_owner, staff]` だが、`account_owner`(本人)の
 * 経路はまだ無く、`staff` だけが `member_admin` から実行する。`P1` の `for` と交差しないロールは
 * そもそも `P1` にいない = この `navigations` を辿って着くことがないので対象外にする ──
 * S4 の `checkActions` が「実行し得るか」を見るのと同じ絞り込み)。
 *
 * 判定そのもの(2 つの検証)は lib/screen/transition-landing.ts の `evaluateLanding` が持つ
 * (L2 網羅台帳の「着地」列と同じ判定を共有する)。ここは判定結果を Finding に変換するだけである。
 *
 * 満たさなければエラー(「成功したのに not found へ飛ぶ」という壊れた遷移であり、
 * 「まだ画面が無い」という正当な未着手はあり得ない ── 遷移は画面自身が `actions` に
 * 宣言している以上、行き先も画面自身が選んでいる。免除の器は無い)。
 */

import type { Finding, ScreenContext, ScreenVerifier } from '../verifier.js';
import { authGateBlocked, screenFinding } from '../verifier.js';
import type { ScreenInput, ScreenNavigation, ScreenSpec } from '../../model/screen/types.js';
import type { EventEntry } from '../../semantics/domain-index.js';
import { findEvent } from '../../semantics/domain-index.js';
import { anonymousRoleId, systemRoleId } from '../../model/role-hierarchy.js';
import { evaluateLanding } from '../transition-landing.js';
import { indexScreens, SUCCESS_SUFFIX } from '../../model/screen/lookup.js';

/** S15: success の行き先で、遷移後の状態を弾かず、by のロールが入れるかを検証する。 */
export const transitionLandingVerifier: ScreenVerifier = {
  id: 'S15',
  title: '遷移後の着地 — success の行き先で、遷移後の状態を弾かず、by のロールが入れる',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    if (!input.screens.available) return [];
    const domain = input.domain;
    const byId = indexScreens(input.screens);
    const systemRole = systemRoleId(domain.roles.roles);
    const anonymousRole = anonymousRoleId(domain.roles.roles);
    const gates = input.auth.flow?.gates ?? [];
    const gatesBlocked = authGateBlocked(ctx);

    const findings: Finding[] = [];
    for (const screen of input.screens.screens) {
      for (const navigation of screen.navigations) {
        if (!navigation.on.endsWith(SUCCESS_SUFFIX)) continue;
        const eventId = navigation.on.slice(0, -SUCCESS_SUFFIX.length);
        const event = findEvent(domain, eventId);
        if (event === null) continue; // 接地しない on は S2 が指摘済み
        const target = byId.get(navigation.to);
        if (target === undefined) continue; // 実在しない遷移先は S2 が指摘済み

        const result = evaluateLanding(ctx.guards, domain, screen, target, event, gates, anonymousRole, systemRole);
        if (!result.admitsState) findings.push(rejectedLanding(screen, navigation, event, target));
        // 入れるロールの判定は関門に依る。関門が分からないとき(阻害)は出さない(状態を弾くかは関門に依らないので出す。行は呼び手が言う)。
        for (const role of gatesBlocked ? [] : result.forbiddenRoles) {
          findings.push(forbiddenLanding(screen, navigation, event, target, role));
        }
      }
    }
    return findings;
  },
};

/** 遷移後の状態で行き先画面の precondition が成り立たない。 */
function rejectedLanding(
  screen: ScreenSpec,
  navigation: ScreenNavigation,
  event: EventEntry,
  target: ScreenSpec,
): Finding {
  return screenFinding('S15', {
    message:
      `${screen.name} の navigations(on: ${navigation.on})の行き先 ${target.name} は、` +
      `${event.id} が成立した後の状態(${event.event.to})で precondition が成立しません`,
    location: navigation.location,
    suggestion:
      `${target.name} の precondition が状態 ${event.event.to} を弾かないように直すか、` +
      `${navigation.on} の行き先(to)を、遷移後の状態でも入れる画面に変える`,
    counterexample: { screen: screen.name, on: navigation.on, to: target.name, state: event.event.to },
  });
}

/** 遷移の by のロールが行き先画面に入れない。 */
function forbiddenLanding(
  screen: ScreenSpec,
  navigation: ScreenNavigation,
  event: EventEntry,
  target: ScreenSpec,
  role: string,
): Finding {
  return screenFinding('S15', {
    message:
      `${screen.name} の navigations(on: ${navigation.on})の行き先 ${target.name} に、` +
      `${event.id} を実行できる ${role} が入れません`,
    location: navigation.location,
    suggestion:
      `${target.name} の for に ${role}(または ${role} を含意するロール)を足すか、` +
      `${event.id} の by から ${role} を外す`,
    counterexample: { screen: screen.name, on: navigation.on, to: target.name, role },
  });
}
