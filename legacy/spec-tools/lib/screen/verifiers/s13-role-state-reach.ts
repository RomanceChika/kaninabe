/**
 * S13 状態×ロールの到達検査(S10 の全域化)。
 *
 * S10 が問うのは「その操作を発火する画面がどこかにあるか」(存在の向き)だけであり、
 * **どの状態のときに・どのロールが**その画面に実際に届くかは見ていない。人が起こせる遷移
 * `T`(状態機械 `M`、`from` の各状態 `s`、`by` の各人間ロール `r`)について、次の 4 つを
 * 満たす画面 `P` が存在することを要求する。
 *
 * (a) `P` の `actions`(overlays を含む)に `T` がある(S10 と同じ母集合・同じ正規化)
 * (b) `P` に `r` が入れる(`for` / `requires_auth` / `role_gate`。意味解析の層の `requiredGuardsOf`(`semantics/required-guards.ts`)と
 *     同じ規則 — lib/relations/screen-reachability/role-entry.ts の `roleCanEnter`)
 * (c) `P` の `precondition` が状態 `s` の実体を弾かない(記号評価。状態を参照しない式は admit
 *     ── lib/semantics/state-admit.ts の `admitsState`)
 * (d) `P` が `r` の入口画面から `navigations` で届く(`{event}.success` の遷移は経路として
 *     数えない ── 押した**結果**として着く画面であって、押しに行ける画面ではないため。
 *     経路上の各画面にも `r` が入れることを求める ── lib/relations/screen-reachability/reach.ts の
 *     `reachFrom`。起点が `entry_point` 全部のとき)
 *
 * (a)〜(d) の探索そのものは関係の層(lib/relations/screen-reachability/)の `stateRoleReach` が持つ
 * (L2 網羅台帳の「到達」列と同じ探索を共有する)。ここは探索結果を免除宣言と突き合わせ、
 * Finding に変換するだけである。
 *
 * 満たす画面が 1 つも無ければエラー。免除は S10 と同じ方式で、
 * `specs/frontend/screens/README.md` のフロントマター `unreachable_states` に
 * `transition` / `state` / `role` / `reason` を書く(用済みの宣言・存在しない組の宣言は警告)。
 */

import type { Finding, ScreenContext, ScreenVerifier } from '../verifier.js';
import { screenFinding } from '../verifier.js';
import type { RoleStateReachDecl, ScreenInput } from '../../model/screen/types.js';
import type { EventEntry } from '../../semantics/domain-index.js';
import { listHumanEvents } from '../../trace/human-operations.js';
import { loadedGates, screenReachabilityOfModels } from '../../relations/screen-reachability/index.js';

/** S13: 起こせる(遷移, 状態, ロール)の組それぞれに、そこへ届く画面があるかを検証する。 */
export const roleStateReachVerifier: ScreenVerifier = {
  id: 'S13',
  title: '状態×ロールの到達 — 起こせる(遷移, 状態, ロール)の組に、そこへ届く画面がある',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    if (!input.screens.available) return [];
    if (ctx.reachabilityGaps.length > 0) return []; // 画面の到達の入力が使えない(行は呼び手が言う)
    const domain = input.domain;
    const gates = input.auth.flow?.gates ?? [];
    const excused = indexExcuses(input.screens.unreachableStates);
    const reachability = screenReachabilityOfModels(domain, input.screens, loadedGates(gates));
    const exposedBy = reachability.exposedBy;

    const findings: Finding[] = [];
    const checkedKeys = new Set<string>();

    for (const entry of listHumanEvents(domain)) {
      const reach = reachability.stateRoleReach(ctx.guards, entry);
      const hasCandidate = (exposedBy.get(entry.id) ?? []).length > 0;

      for (const { role, state, screen } of reach) {
        const key = excuseKey(entry.id, state, role);
        checkedKeys.add(key);
        const decl = excused.get(key);
        if (screen !== undefined) {
          if (decl !== undefined) findings.push(obsoleteExcuse(decl));
        } else if (decl === undefined) {
          findings.push(missingReach(entry, state, role, hasCandidate));
        }
      }
    }

    for (const [key, decl] of excused) {
      if (!checkedKeys.has(key)) findings.push(unknownExcuse(decl));
    }
    return findings;
  },
};

/** 免除宣言を突合キー(`{transition}/{state}/{role}`)で引けるようにする。 */
function indexExcuses(decls: readonly RoleStateReachDecl[]): ReadonlyMap<string, RoleStateReachDecl> {
  return new Map(decls.map((decl) => [excuseKey(decl.transition, decl.state, decl.role), decl]));
}

/** 突合キーを組み立てる(loader.ts の `identify` と同じ規則)。 */
function excuseKey(transition: string, state: string, role: string): string {
  return `${transition}/${state}/${role}`;
}

/** 満たす画面が 1 つも無い。 */
function missingReach(entry: EventEntry, state: string, role: string, hasCandidate: boolean): Finding {
  const detail = hasCandidate
    ? `${entry.id} を発火する画面はありますが、状態 ${state} のとき ${role} として届く画面がありません`
    : `${entry.id} を発火する画面自体がありません(S10 を先に解消する)`;
  return screenFinding('S13', {
    message: `${entry.id} は状態 ${state} のとき ${role} が実行できますが、そこに届く画面がありません`,
    location: { file: entry.event.location.file, pointer: `events.${entry.event.id}` },
    suggestion:
      `${detail}。${role}(または ${role} を含意するロール)の for を持ち、precondition が状態 ${state} を弾かず、` +
      `entry_point から navigations で届く画面に "actions: - ${entry.id}" を足す。` +
      'まだ作らないなら specs/frontend/screens/README.md のフロントマターに ' +
      `"unreachable_states: - transition: ${entry.id} / state: ${state} / role: ${role} / reason: {理由}" を書く`,
    counterexample: { transition: entry.id, state, role },
  });
}

/** 画面ができて満たされたのに免除宣言が残っている(消し忘れ)。 */
function obsoleteExcuse(decl: RoleStateReachDecl): Finding {
  return screenFinding('S13', {
    severity: 'warning',
    message: `${decl.transition} / ${decl.state} / ${decl.role} は届く画面ができたのに unreachable_states の理由宣言が残っています`,
    location: decl.location,
    suggestion: 'screens/README.md の unreachable_states からこの項目を削除する',
    counterexample: { transition: decl.transition, state: decl.state, role: decl.role },
  });
}

/** 実在しない(遷移, 状態, ロール)の組の免除宣言(綴り違い等)。 */
function unknownExcuse(decl: RoleStateReachDecl): Finding {
  return screenFinding('S13', {
    severity: 'warning',
    message: `unreachable_states の ${decl.transition} / ${decl.state} / ${decl.role} は、人間が起こせる(遷移, 状態, ロール)の組として存在しません`,
    location: decl.location,
    suggestion: '綴りを確認し、実在する遷移 ID・from の状態・by のロールに直すか項目を削除する',
    counterexample: { transition: decl.transition, state: decl.state, role: decl.role },
  });
}
