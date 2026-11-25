/**
 * S19 **操作を載せる部品の宣言**(`kind: table` の `edit` / `actions`・`kind: actions`・確認の器)の検査。
 *
 * ADR-0015 の改訂 2 の要求: 部品に `edit`(行をその場で編集する操作)や `actions`(行ごとのボタン)を書くと、その部品は
 * 操作を起こす生成物になる。書いてよいのは次の形だけである。
 *   (a) `edit` / `actions` の操作が**その画面の `actions`**(重ね表示の `actions` を含む)に居る
 *   (b) `edit` は編集(update)で、`reads` の source のエンティティの編集である(確認が要る操作・`runner: manual` の操作は載せられない —
 *       前者は行の保存に確認の器が無く、後者は計画の外で入力欄の集合を導けない)
 *   (c) 確認が要る操作(`confirmRequired`。方針の導出)を載せた部品(`actions` の要素・`kind: form` の `action`)は、
 *       その部品を `opened_by` に持つ重ね表示が、その操作を `actions` に含み、確認の器(`body.center` の `confirm_bar`)を持つ
 *   (d) `kind: actions` の `reads` が、その画面の `reads` の要素で、1 行を返す読み(`returns: one`)である
 *   (e) `actions` の要素は、`reads` の source の状態機械のイベントか、source の削除(`delete`)である
 *       (作成はフォーム・編集は `edit` — 行のボタンにしない)
 *   (f) 行のボタンに載せる操作の入力は対象の識別子(`id`)だけである(生成物は全ボタンを `{ id }` で呼ぶ。理由の欄などの追加の
 *       入力が要る操作はボタンにできない — 入力を集める形は `kind: form` の領分)
 *   (g) 確認の重ね表示は 1 つにつき、その部品が載せる確認が要る操作 1 つだけを持つ(2 つ以上を 1 つの重ね表示に束ねると、
 *       確認ダイアログの testid が重複する — 操作ごとに重ね表示を分ける)
 * 加えて chrome の部品には `kind: actions` を書けない(chrome は操作を持たない外枠)。
 *
 * `edit` / `actions` の**形**(語彙・組になっているか・`edit` と `shows` を併せない)はパーサー(S0)が見る。ドメインに
 * 接地しない操作は S2 の領分なのでここでは黙る(1 つの書き間違いに 2 つの指摘を出さない)。判定の文面は
 * `lib/messages/messages-screen-operation.ts` にある。
 */

import { operationComponentProblemWords } from '../../messages/messages-screen-operation.js';
import type { OperationComponentProblem } from '../../messages/messages-screen-operation.js';
import type { QuerySpec } from '../../model/query/types.js';
import { findDelete, findEntityFields, findEvent, findUpdate, isCreateId, isDeleteId, isUpdateId } from '../../semantics/domain-index.js';
import { canonicalActionId } from '../../semantics/action-ground.js';
import { declaredActionIds } from '../../model/screen/declared-actions.js';
import type { LayoutComponent, ScreenInput, ScreenLayout, ScreenRef, ScreenSpec } from '../../model/screen/types.js';
import type { Finding, ScreenContext, ScreenVerifier } from '../verifier.js';
import { foreignBlocked, screenFinding } from '../verifier.js';

/** 行のボタンが渡す入力(対象の識別子)の欄の名前。 */
const ID_FIELD = 'id';

/** 確認の器を置く場所(重ね表示の `layout` の `body.center` の `confirm_bar`)。 */
const CONFIRM_SLOT = 'body.center';
const CONFIRM_COMPONENT = 'confirm_bar';

/** S19 の実装。 */
export const operationComponentVerifier: ScreenVerifier = {
  id: 'S19',
  title: '操作を載せる部品 — edit / actions / kind: actions の操作が画面の actions に居て、確認が要る操作は確認の器を持つ',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    const findings: Finding[] = [];
    for (const chrome of input.screens.chromes) {
      for (const component of components(chrome.layout).filter((candidate) => candidate.kind === 'actions')) {
        findings.push(finding({ kind: 'in_chrome', chrome: chrome.name, component: component.name }, component.location));
      }
    }
    for (const screen of input.screens.screens) findings.push(...checkScreen(screen, input, ctx));
    return findings;
  },
};

/** レイアウトの部品(入れ子を含む。宣言順)。 */
function components(layout: ScreenLayout): readonly LayoutComponent[] {
  return layout.slots.flatMap((slot) => slot.components);
}

/** 画面 1 枚の部品を、宣言順(画面の layout → 重ね表示)に見る。 */
function checkScreen(screen: ScreenSpec, input: ScreenInput, ctx: ScreenContext): Finding[] {
  const known = {
    declared: declaredActionIds(screen),
    canonical: (id: string): string => canonicalActionId(input.domain, id) ?? id,
  };
  return [screen.layout, ...screen.overlays.map((overlay) => overlay.layout)]
    .flatMap(components)
    .flatMap((component) => checkComponent(screen, component, input, ctx, known));
}

/** 画面の宣言の引き当て(書かれたままの ID と正式な ID)。 */
interface Known {
  readonly declared: readonly string[];
  readonly canonical: (id: string) => string;
}

/** 部品 1 つの書き間違い(操作ごとに最初に当たった 1 つ)。 */
function checkComponent(
  screen: ScreenSpec,
  component: LayoutComponent,
  input: ScreenInput,
  ctx: ScreenContext,
  known: Known,
): Finding[] {
  const base = { screen: screen.name, component: component.name };
  const query = readOf(component, input, ctx);
  const findings: Finding[] = [];
  const add = (problem: OperationComponentProblem, ref: ScreenRef | undefined): void => {
    findings.push(finding(problem, ref?.location ?? component.location));
  };
  if (component.kind === 'actions') {
    const problem = checkRead(screen, component, input, ctx);
    if (problem !== null) add(problem, component.readRef);
  }
  const edit = component.editRef;
  if (edit !== undefined) {
    const problem = checkEdit(base, edit, query, input, ctx, known);
    if (problem !== null) add(problem, edit);
  }
  for (const ref of component.buttonRefs ?? []) {
    const problem = checkButton(base, ref, query, input, ctx, known);
    if (problem !== null) add(problem, ref);
  }
  const served = new Map<string, ScreenRef[]>();
  for (const ref of confirmCarried(component)) {
    const problem = checkConfirm(screen, component, ref, ctx, known);
    if (problem !== null) add(problem, ref);
    const overlay = confirmOverlayOf(screen, component, ref, ctx, known);
    const already = served.get(overlay?.id ?? '') ?? [];
    // 同じ操作を 2 度書いても「2 つの操作」ではない。
    if (overlay !== undefined && !already.some((seen) => known.canonical(seen.id) === known.canonical(ref.id))) {
      served.set(overlay.id, [...already, ref]);
    }
  }
  for (const [overlay, refs] of served) {
    const second = refs[1];
    if (second !== undefined) add({ kind: 'overlay_shared', ...base, overlay, operations: refs.map((ref) => ref.id) }, second);
  }
  return findings;
}

/** 部品の `reads` の読み(実在しない・読めない・query_spec が阻害なら undefined — S2 / S18 の領分。行は呼び手が言う)。 */
function readOf(component: LayoutComponent, input: ScreenInput, ctx: ScreenContext): QuerySpec | undefined {
  const id = component.readRef?.id;
  if (id === undefined || !input.queries.available || foreignBlocked(ctx, 'queries')) return undefined;
  return input.queries.queries.find((candidate) => candidate.id === id);
}

/** `kind: actions` の `reads`(画面の reads の要素・returns: one)。 */
function checkRead(screen: ScreenSpec, component: LayoutComponent, input: ScreenInput, ctx: ScreenContext): OperationComponentProblem | null {
  const ref = component.readRef;
  if (ref === undefined) return null;
  const base = { screen: screen.name, component: component.name, read: ref.id };
  const declared = screen.reads.map((read) => read.id);
  if (!declared.includes(ref.id)) return { kind: 'read_not_in_reads', ...base, declared };
  const query = readOf(component, input, ctx);
  if (query !== undefined && query.returns !== 'one') return { kind: 'read_not_one', ...base, returns: query.returns };
  return null;
}

/** `edit`(画面の actions に居る・編集・source の編集・確認が要らない)。 */
function checkEdit(
  base: { readonly screen: string; readonly component: string },
  ref: ScreenRef,
  query: QuerySpec | undefined,
  input: ScreenInput,
  ctx: ScreenContext,
  known: Known,
): OperationComponentProblem | null {
  const operation = known.canonical(ref.id);
  // ドメインに接地しない操作は S2 の領分。
  if (!isGrounded(input, ref.id)) return null;
  if (!known.declared.some((id) => known.canonical(id) === operation)) {
    return { kind: 'not_declared', ...base, attribute: 'edit', operation: ref.id, declared: known.declared };
  }
  const update = isUpdateId(ref.id) ? findUpdate(input.domain, ref.id) : null;
  if (update === null) return { kind: 'edit_not_update', ...base, operation: ref.id };
  if (query !== undefined && update.entity !== query.source) {
    return { kind: 'edit_wrong_source', ...base, operation: ref.id, entity: update.entity, source: query.source };
  }
  if (ctx.manualOperations.has(operation)) return { kind: 'edit_manual', ...base, operation: ref.id };
  if (ctx.confirmRequiredOperations.has(operation)) return { kind: 'edit_confirm', ...base, operation: ref.id };
  return null;
}

/** `actions` の要素 1 つ(画面の actions に居る・遷移か削除・source の操作)。 */
function checkButton(
  base: { readonly screen: string; readonly component: string },
  ref: ScreenRef,
  query: QuerySpec | undefined,
  input: ScreenInput,
  ctx: ScreenContext,
  known: Known,
): OperationComponentProblem | null {
  const operation = known.canonical(ref.id);
  const event = findEvent(input.domain, ref.id);
  // ドメインに接地しない操作は S2 の領分。
  if (!isGrounded(input, ref.id)) return null;
  if (!known.declared.some((id) => known.canonical(id) === operation)) {
    return { kind: 'not_declared', ...base, attribute: 'actions', operation: ref.id, declared: known.declared };
  }
  if (isCreateId(ref.id)) return { kind: 'button_wrong_shape', ...base, operation: ref.id, shape: 'create' };
  if (isUpdateId(ref.id)) return { kind: 'button_wrong_shape', ...base, operation: ref.id, shape: 'update' };
  if (query === undefined) return null;
  const ownsEvent =
    event !== null &&
    (findEntityFields(input.domain, query.source) ?? []).some(
      (field) => field.type.kind === 'state' && field.type.machine === event.machine.machine,
    );
  const ownsDelete = isDeleteId(ref.id) && findDelete(input.domain, ref.id)?.entity === query.source;
  if (!ownsEvent && !ownsDelete) return { kind: 'button_wrong_source', ...base, operation: ref.id, source: query.source };
  // action_spec を読めていない操作の入力は分からない(S2 / A 群の領分)。
  const extra = (ctx.operationInputs.get(operation) ?? ctx.operationInputs.get(ref.id) ?? []).filter((item) => item.field !== ID_FIELD);
  return extra.length === 0
    ? null
    : { kind: 'button_extra_input', ...base, operation: ref.id, fields: extra.map((item) => `${item.entity}.${item.field}`) };
}

/** 操作がドメインに接地するか(遷移のイベントか、実在する予約 ID。接地しない ID は S2 が見る)。 */
function isGrounded(input: ScreenInput, id: string): boolean {
  return canonicalActionId(input.domain, id) !== null;
}

/** 確認を要るかを問う操作(行のボタンと、フォームの `action`)。 */
function confirmCarried(component: LayoutComponent): readonly ScreenRef[] {
  if (component.kind === 'form') return component.actionRefs?.slice(0, 1) ?? [];
  return component.buttonRefs ?? [];
}

/** 確認が要る操作の確認の重ね表示(その部品を `opened_by` に持ち、その操作を `actions` に含むもの。確認が要らなければ undefined)。 */
function confirmOverlayOf(
  screen: ScreenSpec,
  component: LayoutComponent,
  ref: ScreenRef,
  ctx: ScreenContext,
  known: Known,
): ScreenSpec['overlays'][number] | undefined {
  const operation = known.canonical(ref.id);
  if (!ctx.confirmRequiredOperations.has(operation)) return undefined;
  return screen.overlays.find(
    (candidate) =>
      candidate.openedBy === component.name && candidate.actions.some((action) => known.canonical(action.id) === operation),
  );
}

/** 確認が要る操作に、その部品が開く確認の器があるか。 */
function checkConfirm(
  screen: ScreenSpec,
  component: LayoutComponent,
  ref: ScreenRef,
  ctx: ScreenContext,
  known: Known,
): OperationComponentProblem | null {
  if (!ctx.confirmRequiredOperations.has(known.canonical(ref.id))) return null;
  const base = { screen: screen.name, component: component.name, operation: ref.id };
  const overlay = confirmOverlayOf(screen, component, ref, ctx, known);
  if (overlay === undefined) return { kind: 'confirm_without_overlay', ...base };
  const hasBar = overlay.layout.slots.some(
    (slot) => slot.path === CONFIRM_SLOT && slot.components.some((candidate) => candidate.name === CONFIRM_COMPONENT),
  );
  return hasBar ? null : { kind: 'overlay_not_confirm_bar', ...base, overlay: overlay.id };
}

/** 書き間違い 1 つを指摘にする。 */
function finding(problem: OperationComponentProblem, location: Finding['location']): Finding {
  const words = operationComponentProblemWords(problem);
  const facts = Object.entries(problem)
    .filter(([key]) => key !== 'kind')
    .map(([key, value]): [string, string] => [key, Array.isArray(value) ? value.join(', ') : String(value)]);
  return screenFinding('S19', {
    message: words.message,
    location,
    suggestion: words.suggestion,
    counterexample: Object.fromEntries(facts),
  });
}
