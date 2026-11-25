/**
 * S20 **プラットフォーム操作を露出する画面**(`platform_ops` と部品 `platform_read` / `platform_actions`)の検査。
 *
 * 画面は `usecases:` と並ぶ第 3 の露出口 `platform_ops:` で、auth_spec の `platform_ops`(ドメインイベントでない認証基盤の操作)を参照する
 * (ADR-0019・設計 設計メモ「セッションの管理の画面」)。書いてよいのは次の形だけである。
 *   (a) 参照した操作が auth_spec に実在する
 *   (b) 露出する画面は `requires_auth: true`(操作はセッションの実行者に対して働く)。実行者がロールの操作は、画面の `for` の全ロールがそのロールを持つ(同じか含意する。実行できない人も見る画面に置かない)
 *   (c) `navigations` / `closes_on` の `platform_op.{id}.success` の操作は、この画面が露出する `kind: do` の操作である
 *   (d) 部品の `op` は `kind: read`、`ops` / `row_actions` は `kind: do` で、どれもこの画面(重ね表示を含む)の `platform_ops` に居る。
 *       `shows` は操作の返す欄の部分集合
 *   (e) 引数が `from: row` の操作は行を持つ部品(`row_actions`)にだけ載り、その出どころ(`of`)は部品が表にする読み(`platform_read` の `op` /
 *       `table` の `reads`)に一致する。行のボタンは行から受ける引数を 1 つ以上持つ
 *   (f) `confirm: true` の操作を載せた部品は、それを `opened_by` に持つ重ね表示が操作を `platform_ops` に含み、確認の器(`body.center` の `confirm_bar`)を持つ
 *   (g) chrome の部品には書けない(chrome は操作を持たない外枠)
 * 網羅(宣言した操作がどこかの画面に出ているか)は S21。判定は auth_spec が使えるときだけ出す(阻害は索引が null)。
 */

import type { PlatformOpDecl } from '../../model/auth/platform-ops.js';
import { PLATFORM_OP_PREFIX } from '../../model/auth/platform-ops.js';
import { declaredPlatformOpRefs } from '../../model/screen/declared-actions.js';
import { SUCCESS_SUFFIX } from '../../model/screen/lookup.js';
import type { LayoutComponent, ScreenInput, ScreenLayout, ScreenRef, ScreenSpec } from '../../model/screen/types.js';
import type { SourceLocation } from '../../model/types.js';
import { impliedRoles } from '../../model/role-hierarchy.js';
import { type PlatformOpIndex, platformOpIndex } from '../platform-ops.js';
import type { Finding, ScreenContext, ScreenVerifier } from '../verifier.js';
import { authGateBlocked, screenFinding } from '../verifier.js';

/** 確認の器を置く場所(重ね表示の `layout` の `body.center` の `confirm_bar`)。 */
const CONFIRM_SLOT = 'body.center';
const CONFIRM_COMPONENT = 'confirm_bar';

/** S20 の実装。 */
export const platformOpVerifier: ScreenVerifier = {
  id: 'S20',
  title: 'プラットフォーム操作 — platform_ops の参照が実在しロールと噛み合い、部品・遷移・確認の器が宣言と合う',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    const index = platformOpIndex(input, authGateBlocked(ctx));
    const findings: Finding[] = [];
    for (const chrome of input.screens.chromes) {
      for (const component of components(chrome.layout).filter(isPlatformComponent)) {
        findings.push(
          f(`chrome ${chrome.name} の部品 ${component.name} は kind: ${component.kind ?? ''} です。chrome にはプラットフォーム操作の部品を置けません`, component.location, 'プラットフォーム操作の部品は画面(screen_spec)に置く(chrome は操作を持たない外枠)', { chrome: chrome.name, component: component.name }),
        );
      }
    }
    if (index === null) return findings;
    for (const screen of input.screens.screens) findings.push(...checkScreen(screen, input, index));
    return findings;
  },
};

/** 指摘を組み立てる。 */
function f(message: string, location: SourceLocation, suggestion: string, counterexample: Record<string, string>): Finding {
  return screenFinding('S20', { message, location, suggestion, counterexample });
}

/** レイアウトの部品(入れ子を含む。宣言順)。 */
function components(layout: ScreenLayout): readonly LayoutComponent[] {
  return layout.slots.flatMap((slot) => slot.components);
}

/** プラットフォーム操作の部品か。 */
function isPlatformComponent(component: LayoutComponent): boolean {
  return component.kind === 'platform_read' || component.kind === 'platform_actions';
}

/** 画面 1 枚。 */
function checkScreen(screen: ScreenSpec, input: ScreenInput, index: PlatformOpIndex): Finding[] {
  const declared = declaredPlatformOpRefs(screen);
  return [
    ...checkRefs(screen, declared, input, index),
    ...checkTriggers(screen, declared, index),
    ...[screen.layout, ...screen.overlays.map((overlay) => overlay.layout)]
      .flatMap(components)
      .flatMap((component) => checkComponent(screen, component, declared, index)),
  ];
}

/** (a)(b): 参照の実在・認証・ロール。 */
function checkRefs(screen: ScreenSpec, declared: readonly ScreenRef[], input: ScreenInput, index: PlatformOpIndex): Finding[] {
  return declared.flatMap((ref) => {
    const op = index.ops.get(ref.id);
    const base = { screen: screen.name, op: ref.id };
    if (op === undefined) {
      return [f(`platform_ops の ${ref.id} に対応する auth_spec の操作がありません`, ref.location, 'auth_spec(認証フロー仕様)の platform_ops に宣言した操作の id に直す(画面が書けるのは auth_spec が宣言した操作だけ)', base)];
    }
    const findings: Finding[] = [];
    if (!screen.requiresAuth) {
      findings.push(f(`画面 ${screen.name} は ${ref.id} を露出しますが requires_auth ではありません`, ref.location, 'requires_auth: true にする(プラットフォーム操作の実行者はセッションから導く。未ログインの画面には置けない)', base));
    }
    if (op.actor.kind === 'role' && !everyViewerHolds(input, screen, op.actor.role)) {
      findings.push(
        f(`操作 ${ref.id} の実行者(ロール ${op.actor.role})を、この画面を見る全ロール(${screen.forRoles.join(' / ')})は持ちません`, ref.location, `画面の for を ${op.actor.role} か ${op.actor.role} を含意するロールだけにするか、操作を ${op.actor.role} の画面へ移す(管理者の操作を、実行できない人も見る画面に置かない)`, { ...base, role: op.actor.role, for: screen.forRoles.join(', ') }),
      );
    }
    return findings;
  });
}

/** 画面を見る全ロールが、操作の実行者のロールを持つ(同じか、含意する)。 */
function everyViewerHolds(input: ScreenInput, screen: ScreenSpec, role: string): boolean {
  return screen.forRoles.every((viewer) => viewer === role || impliedRoles(input.domain.roles.roles, viewer).has(role));
}

/** (c): `platform_op.{id}.success` のきっかけ(navigations と overlays の closes_on)。 */
function checkTriggers(screen: ScreenSpec, declared: readonly ScreenRef[], index: PlatformOpIndex): Finding[] {
  const triggers = [
    ...screen.navigations.map((navigation) => ({ on: navigation.on, location: navigation.location })),
    ...screen.overlays.flatMap((overlay) => overlay.closesOn.map((on) => ({ on, location: overlay.location }))),
  ].filter((trigger) => trigger.on.startsWith(PLATFORM_OP_PREFIX));
  return triggers.flatMap(({ on, location }) => {
    const id = on.endsWith(SUCCESS_SUFFIX) ? on.slice(PLATFORM_OP_PREFIX.length, -SUCCESS_SUFFIX.length) : null;
    const base = { screen: screen.name, on };
    if (id === null) return []; // ".success" 形でないドット付きのきっかけは S2 が言う
    if (!declared.some((ref) => ref.id === id)) {
      return [f(`きっかけ ${on} が指す操作をこの画面は露出しません`, location, `platform_ops に ${id} を足すか、きっかけを自由語彙に直す(「操作の結果」と書けるのは、その操作を露出している画面だけ)`, base)];
    }
    const op = index.ops.get(id);
    return op !== undefined && op.kind !== 'do'
      ? [f(`きっかけ ${on} の操作 ${id} は kind: read です。結果の遷移を持てるのは kind: do だけです`, location, 'きっかけを kind: do の操作にするか、自由語彙に直す', base)]
      : [];
  });
}

/** 部品 1 つ。 */
function checkComponent(screen: ScreenSpec, component: LayoutComponent, declared: readonly ScreenRef[], index: PlatformOpIndex): Finding[] {
  const base = { screen: screen.name, component: component.name };
  const findings: Finding[] = [];
  const known = (ref: ScreenRef): PlatformOpDecl | undefined => {
    const op = index.ops.get(ref.id);
    if (op === undefined) return undefined; // 実在しない操作は (a) が言う
    if (!declared.some((candidate) => candidate.id === ref.id)) {
      findings.push(f(`部品 ${component.name} の ${ref.id} を、画面の platform_ops が宣言していません`, ref.location, `platform_ops(または overlays[].platform_ops)に ${ref.id} を足す`, { ...base, op: ref.id }));
    }
    return op;
  };
  const readOp = component.platformOpRef === undefined ? undefined : known(component.platformOpRef);
  if (component.platformOpRef !== undefined && readOp !== undefined) findings.push(...checkReadOp(component, component.platformOpRef, readOp, index, base));
  const buttons = [...(component.platformOpRefs ?? []).map((ref) => ({ ref, row: false })), ...(component.rowActionRefs ?? []).map((ref) => ({ ref, row: true }))];
  for (const { ref, row } of buttons) {
    const op = known(ref);
    if (op !== undefined) findings.push(...checkButton(screen, component, { ref, row, op }, index, base));
  }
  return findings;
}

/** `platform_read` の `op`(kind: read・shows が返す欄の部分集合)。 */
function checkReadOp(component: LayoutComponent, ref: ScreenRef, op: PlatformOpDecl, index: PlatformOpIndex, base: Record<string, string>): Finding[] {
  if (op.kind !== 'read') {
    return [f(`部品 ${component.name} の op ${ref.id} は kind: do です。表にできるのは kind: read の操作です`, ref.location, 'op は kind: read の操作にする(kind: do はボタン — ops / row_actions)', { ...base, op: ref.id })];
  }
  const fields = index.shapes.get(op.returns ?? '')?.fields;
  if (fields === undefined) return []; // shapes の欠落は H9 が言う
  return (component.showRefs ?? [])
    .filter((show) => !fields.includes(show.id))
    .map((show) => f(`部品 ${component.name} の shows ${show.id} が、${ref.id} の返す欄にありません`, show.location, `shows は ${op.returns ?? ''} の欄(${fields.join(' / ')})の部分集合で書く`, { ...base, op: ref.id, show: show.id }));
}

/** ボタンにした操作 1 つ(kind: do・行の出どころ・確認の器)。 */
function checkButton(screen: ScreenSpec, component: LayoutComponent, button: { ref: ScreenRef; row: boolean; op: PlatformOpDecl }, index: PlatformOpIndex, base: Record<string, string>): Finding[] {
  const { ref, row, op } = button;
  const facts = { ...base, op: ref.id };
  if (op.kind !== 'do') {
    return [f(`部品 ${component.name} の ${ref.id} は kind: read です。ボタンにできるのは kind: do の操作です`, ref.location, `ボタンは kind: do の操作にする(kind: read は kind: platform_read の op に書く)`, facts)];
  }
  const findings: Finding[] = [];
  const rowArgs = op.args.filter((arg) => arg.kind === 'row');
  if (!row && rowArgs.length > 0) {
    findings.push(f(`操作 ${ref.id} は行から受ける引数(${rowArgs.map((arg) => arg.name).join(', ')})を持ちますが、行を持たない ops に載っています`, ref.location, '行から引数を受ける操作は、表の行ごとのボタン(row_actions)に載せる', facts));
  }
  if (row && rowArgs.length === 0) {
    findings.push(f(`操作 ${ref.id} は行から受ける引数を持たないのに row_actions に載っています`, ref.location, '行に依らない操作は ops(kind: platform_actions)に載せる(行ごとに同じボタンが並んでしまう)', facts));
  }
  if (row) {
    const source = component.kind === 'platform_read' ? component.platformOpRef?.id : component.readRef?.id;
    for (const arg of rowArgs) {
      if (source !== undefined && arg.of !== source) {
        findings.push(f(`操作 ${ref.id} の引数 ${arg.name} の出どころ ${arg.of} が、部品 ${component.name} の表にする読み(${source})と一致しません`, ref.location, `from: row の of を ${source} に合わせるか、操作を ${arg.of} を表にする部品へ載せる`, { ...facts, arg: arg.name, of: arg.of, source }));
      } else if (source !== undefined && !index.ops.has(arg.of) && !screen.reads.some((read) => read.id === arg.of)) {
        findings.push(f(`操作 ${ref.id} の引数 ${arg.name} の出どころ ${arg.of} が、画面の reads にありません`, ref.location, `画面の reads に ${arg.of} を足す(行の出どころは画面が読むものだけ)`, { ...facts, arg: arg.name, of: arg.of }));
      }
    }
  }
  return op.confirm === true ? [...findings, ...checkConfirm(screen, component, ref)] : findings;
}

/** (f): `confirm: true` の操作の確認の器。 */
function checkConfirm(screen: ScreenSpec, component: LayoutComponent, ref: ScreenRef): Finding[] {
  const facts = { screen: screen.name, component: component.name, op: ref.id };
  const overlay = screen.overlays.find((candidate) => candidate.openedBy === component.name && candidate.platformOps.some((op) => op.id === ref.id));
  if (overlay === undefined) {
    return [f(`確認が要る操作 ${ref.id} を載せた部品 ${component.name} に、確認の重ね表示がありません`, ref.location, `overlays に opened_by: ${component.name} と platform_ops: [${ref.id}] を持つ重ね表示を足し、body.center に confirm_bar を置く(確認が要る操作は確認の器を経て実行する)`, facts)];
  }
  const hasBar = overlay.layout.slots.some((slot) => slot.path === CONFIRM_SLOT && slot.components.some((candidate) => candidate.name === CONFIRM_COMPONENT));
  return hasBar ? [] : [f(`${ref.id} の確認の重ね表示 ${overlay.id} に確認の器(${CONFIRM_SLOT} の ${CONFIRM_COMPONENT})がありません`, overlay.location, `${overlay.id} の layout の ${CONFIRM_SLOT} に ${CONFIRM_COMPONENT} を置く`, { ...facts, overlay: overlay.id })];
}
