/**
 * L2 網羅スイープ — ① 状態遷移 × {成立, 不成立} の行を state_spec から機械的に導出する。
 *
 * 母集合は state_spec の全イベント(`listEvents`)。不成立の内訳(guard 不成立 / 状態違い /
 * 権限無し)は action-spec-writing.md §A7 の必要クラス導出が使う条件と同じものを直接見る —
 * ただし L2 は BACKLOG の構想どおり `invariant` / `conflict` を対象外にする(この 2 つは
 * A7 が宣言の義務として別途見張っており、L2 は「一通り試す」の網羅性だけを台帳にする)。
 *
 * 「どこで確かめているか」は action_spec の `test_cases[].covers` から引く。action_spec が
 * 無い(グラウンディングできない)イベントは 0 件になる — それ自体が正しい読みで、
 * まだ Server Action の入口が無い遷移は当然どのテストとも結び付かない。
 *
 * **追加列「到達」「着地」(S13 / S15 の追加にあわせた拡張)**: この章は判定しない台帳なので、
 * S13(状態×ロールの到達)・S15(遷移後の着地)と同じ探索・同じ判定を再利用して**事実だけ**を
 * 書き出す(合否は書かない ── それは検査の役目)。screen_spec が無い環境ではこの 2 列は
 * 生成しない。
 */

import type { SpecModel } from '../../model/types.js';
import { listEvents } from '../../semantics/domain-index.js';
import type { EventEntry } from '../../semantics/domain-index.js';
import { deniedHumanRoles } from '../../trace/required-coverage-lookup.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import type { CoverageClass } from '../../testcase/types.js';
import { anonymousRoleId, systemRoleId } from '../../model/role-hierarchy.js';
import { gatesBlocked, gatesUnverifiedNote, screenReachabilityOfModels, type StateRoleReach } from '../../relations/screen-reachability/index.js';
import { evaluateLanding } from '../../screen/transition-landing.js';
import { indexScreens, SUCCESS_SUFFIX } from '../../model/screen/lookup.js';
import type { ScreenSpec } from '../../model/screen/types.js';
import type { AuthGateDecl } from '../../model/auth/types.js';
import type { GenerateContext } from '../../gen-kit/generator.js';
import { groundingSummary } from './spec-body.js';
import { groundOperation } from '../../semantics/operation-ground.js';
import { toEvidence, type L2Row } from './l2-sweep-types.js';
import { gateDecls, gatesOf } from './gates-input.js';

/** 不成立の内訳を含む、1 遷移が持ちうる観点。 */
interface TransitionAspect {
  readonly cls: CoverageClass;
  readonly label: string;
}

/**
 * その遷移に適用される観点を返す(成立は常に 1 件。不成立は条件が実際に成り立つものだけ)。
 *
 * @param guard ガード式(無ければ guard_unsatisfied は無い)
 * @param outsideCount from に含まれない状態の数(0 なら invalid_from は無い)
 * @param deniedCount 拒否される人間ロールの数(0 なら forbidden は無い)
 */
function applicableAspects(
  guard: string | undefined,
  outsideCount: number,
  deniedCount: number,
): readonly TransitionAspect[] {
  const aspects: TransitionAspect[] = [{ cls: 'success', label: '成立' }];
  if (guard !== undefined) aspects.push({ cls: 'guard_unsatisfied', label: '不成立(guard 不成立)' });
  if (outsideCount > 0) aspects.push({ cls: 'invalid_from', label: '不成立(状態違い)' });
  if (deniedCount > 0) aspects.push({ cls: 'forbidden', label: '不成立(権限無し)' });
  return aspects;
}

/**
 * 状態遷移 × {成立, 不成立} の行を全件組み立てる。
 *
 * @param model ドメイン仕様全体(state_spec が母集合)
 * @param actions 読み込み済みの action_spec(証拠の出どころ。未読み込みなら全行 0 件になる)
 * @param ctx 読み込み済みの screen_spec / auth_spec / guards(「到達」「着地」列の出どころ)
 */
export function buildTransitionRows(
  model: SpecModel,
  actions: ActionSpecModel | undefined,
  ctx: GenerateContext,
): L2Row[] {
  const extrasOf = transitionExtras(model, ctx);
  const rows: L2Row[] = [];
  for (const entry of listEvents(model)) {
    const detail = groundingSummary(groundOperation(model, entry.id));
    const action = actions?.actions.find((a) => a.handles.raw === entry.id);
    const outside = entry.machine.states.filter((state) => !entry.event.from.includes(state));
    const denied = deniedHumanRoles(model, entry.event.by);
    const extra = extrasOf(entry);
    for (const aspect of applicableAspects(entry.event.guard, outside.length, denied.length)) {
      const matched = (action?.testCases ?? []).filter((tc) => (tc.covers ?? []).includes(aspect.cls));
      rows.push({
        section: '状態遷移',
        subject: entry.id,
        aspect: aspect.label,
        detail,
        evidence: matched.map((tc) => toEvidence(tc)),
        ...(extra === undefined ? {} : { extra }),
      });
    }
  }
  return rows;
}

/**
 * 遷移 1 件の「到達」「着地」列を作る関数を用意する(`screen_spec` が無ければ常に `undefined`)。
 *
 * `ctx.screens` が使えないだけで台帳全体を諦めないよう、生成できない場合は列自体を省く
 * (`sweep-page.ts` はグループ全体で見出しの有無を決めるため、同じグループの全行が
 * `undefined` になるか全行が値を持つかのどちらかにする)。
 */
function transitionExtras(
  model: SpecModel,
  ctx: GenerateContext,
): (entry: EventEntry) => readonly [string, string] | undefined {
  const screens = ctx.screens;
  if (screens === undefined || !screens.available) return () => undefined;
  const gatesInput = gatesOf(ctx);
  // 関門が分からない(採ったのに読めない)とき、空の関門で探索した「到達」「着地」を事実として書かない(入れない画面にも入れると見積もる)。
  if (gatesBlocked(gatesInput)) return () => [gatesUnverifiedNote('到達'), gatesUnverifiedNote('着地')];
  const gates = gateDecls(gatesInput);
  const anonymousRole = anonymousRoleId(model.roles.roles);
  const systemRole = systemRoleId(model.roles.roles);
  const reachability = screenReachabilityOfModels(model, screens, gatesInput);
  const byId = indexScreens(screens);

  return (entry) => {
    const reach = reachability.stateRoleReach(ctx.guards, entry);
    const landings = landingsOf(entry, screens.screens, byId, gates, anonymousRole, systemRole, model, ctx);
    return [reachCell(reach), landingCell(landings)];
  };
}

/** `findStateRoleReach` の結果を 1 セル分の文字列にする(0 件は「対象ロール無し」)。 */
function reachCell(reach: readonly StateRoleReach[]): string {
  if (reach.length === 0) return '対象ロール無し';
  return reach.map((r) => `${r.state}×${r.role}→${r.screen?.name ?? '—'}`).join(', ');
}

/** 着地 1 件(どの画面からどの画面へ・判定結果のメモ)。 */
interface LandingFact {
  readonly fromName: string;
  readonly toName: string;
  readonly admitsState: boolean;
  readonly forbiddenRoles: readonly string[];
}

/** その遷移を `.success` で待ち受ける `navigations` を全画面から集め、それぞれ判定する。 */
function landingsOf(
  entry: EventEntry,
  screens: readonly ScreenSpec[],
  byId: ReadonlyMap<string, ScreenSpec>,
  gates: readonly AuthGateDecl[],
  anonymousRole: string | undefined,
  systemRole: string | undefined,
  model: SpecModel,
  ctx: GenerateContext,
): readonly LandingFact[] {
  const on = `${entry.id}${SUCCESS_SUFFIX}`;
  const facts: LandingFact[] = [];
  for (const screen of screens) {
    for (const navigation of screen.navigations) {
      if (navigation.on !== on) continue;
      const target = byId.get(navigation.to);
      if (target === undefined) continue; // 実在しない遷移先は S2 が指摘済み
      const result = evaluateLanding(ctx.guards, model, screen, target, entry, gates, anonymousRole, systemRole);
      facts.push({
        fromName: screen.name,
        toName: target.name,
        admitsState: result.admitsState,
        forbiddenRoles: result.forbiddenRoles,
      });
    }
  }
  return facts;
}

/** 着地の一覧を 1 セル分の文字列にする(0 件は「—」)。 */
function landingCell(facts: readonly LandingFact[]): string {
  if (facts.length === 0) return '—';
  return facts
    .map((fact) => {
      const notes = [
        fact.admitsState ? null : '状態NG',
        fact.forbiddenRoles.length === 0 ? null : `不可: ${fact.forbiddenRoles.join('/')}`,
      ].filter((note): note is string => note !== null);
      const suffix = notes.length === 0 ? '' : `(${notes.join(', ')})`;
      return `${fact.fromName}→${fact.toName}${suffix}`;
    })
    .join(', ');
}
