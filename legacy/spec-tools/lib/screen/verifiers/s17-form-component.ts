/**
 * S17 **`kind: form` の部品の宣言**(部品が載せる操作)の検査。
 *
 * ADR-0015 の要求: `layout` の部品に `kind: form` / `action: {操作 ID}` を書くと、その部品は生成物(フォーム)に
 * なる。書いてよいのは次の形だけである。
 *   (a) `action` が**その画面の `actions`**(重ね表示の `actions` を含む。S2 / S10 と同じ母集合)に居る
 *   (b) 接地先が**作成か編集**(`creates` / `writes`)である — 遷移(状態機械のイベント)と削除は欄を
 *       持たないのでフォームではなくボタンである
 *   (c) 1 部品 1 操作(`action` の一覧に 2 つ以上書かない)
 *   (d) 同じ操作を 2 つの `kind: form` 部品が載せない(生成物が同じ操作の入口を 2 つ持たない)
 *   (e) 載せる操作が**実行計画で走る**(`runner: manual` を宣言していない)— manual の操作は実行計画の外にあり、
 *       フォームを生成する材料(入力欄の集合)が無い。宣言したのに何も起きない状態を作らない
 * 加えて chrome の部品には書けない(chrome は操作を持たない外枠)。
 *
 * `kind` / `action` の**形**(語彙・組になっているか)はパーサー(S0)が見る。ドメインに接地しない
 * `action` は S2 の領分なのでここでは黙る(1 つの書き間違いに 2 つの指摘を出さない)。
 * 判定の文面は `lib/messages/messages-screen-form.ts` にある。
 */

import { formComponentProblemWords } from '../../messages/messages-screen-form.js';
import type { FormComponentProblem } from '../../messages/messages-screen-form.js';
import { isCreateId, isDeleteId, isUpdateId } from '../../semantics/domain-index.js';
import { canonicalActionId } from '../../semantics/action-ground.js';
import { declaredActionIds } from '../../model/screen/declared-actions.js';
import type { LayoutComponent, ScreenInput, ScreenLayout, ScreenSpec } from '../../model/screen/types.js';
import type { Finding, ScreenContext, ScreenVerifier } from '../verifier.js';
import { screenFinding } from '../verifier.js';

/** S17 の実装。 */
export const formComponentVerifier: ScreenVerifier = {
  id: 'S17',
  title: 'フォームの部品 — kind: form が載せる操作が、画面の actions に居る作成か編集で、1 部品 1 操作である',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    const findings: Finding[] = [];
    for (const chrome of input.screens.chromes) {
      for (const component of formComponents(chrome.layout)) {
        findings.push(
          finding(component, { kind: 'in_chrome', chrome: chrome.name, component: component.name }),
        );
      }
    }
    for (const screen of input.screens.screens) findings.push(...checkScreen(screen, input, ctx.manualOperations));
    return findings;
  },
};

/** 画面 1 枚の `kind: form` の部品を、宣言順(画面の layout → 重ね表示)に見る。 */
function checkScreen(screen: ScreenSpec, input: ScreenInput, manual: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  const declared = declaredActionIds(screen);
  const declaredCanonical = new Set(declared.map((id) => canonicalActionId(input.domain, id) ?? id));
  const first = new Map<string, string>();
  const layouts = [screen.layout, ...screen.overlays.map((overlay) => overlay.layout)];
  for (const component of layouts.flatMap(formComponents)) {
    const problem = problemOf(screen, component, input, { declared, declaredCanonical, manual }, first);
    if (problem !== null) findings.push(finding(component, problem));
  }
  return findings;
}

/** レイアウトの `kind: form` の部品(入れ子を含む。宣言順)。 */
function formComponents(layout: ScreenLayout): readonly LayoutComponent[] {
  return layout.slots.flatMap((slot) => slot.components.filter((component) => component.kind === 'form'));
}

/** 部品 1 つの書き間違い(無ければ null)。最初に当たったものを 1 つだけ返す。 */
function problemOf(
  screen: ScreenSpec,
  component: LayoutComponent,
  input: ScreenInput,
  known: { readonly declared: readonly string[]; readonly declaredCanonical: ReadonlySet<string>; readonly manual: ReadonlySet<string> },
  first: Map<string, string>,
): FormComponentProblem | null {
  const ids = (component.actionRefs ?? []).map((ref) => ref.id);
  // 組になっていない宣言(action が無い)は S0 が見た。ここで見るのは読めた宣言だけである。
  const id = ids[0];
  if (id === undefined) return null;
  const base = { screen: screen.name, component: component.name };
  if (ids.length > 1) return { kind: 'not_single', ...base, actions: ids };
  const canonical = canonicalActionId(input.domain, id);
  // ドメインに接地しない操作は S2 の領分(`actions` に書いても同じ指摘が出る)。
  if (canonical === null) return null;
  if (!known.declaredCanonical.has(canonical)) return { kind: 'not_declared', ...base, action: id, declared: known.declared };
  if (!isCreateId(canonical) && !isUpdateId(canonical)) {
    return { kind: 'wrong_shape', ...base, action: id, shape: isDeleteId(canonical) ? 'delete' : 'transition' };
  }
  if (known.manual.has(canonical)) return { kind: 'manual_runner', ...base, action: id };
  const earlier = first.get(canonical);
  if (earlier !== undefined) return { kind: 'duplicate', ...base, action: id, first: earlier };
  first.set(canonical, component.name);
  return null;
}

/** 書き間違い 1 つを指摘にする。 */
function finding(component: LayoutComponent, problem: FormComponentProblem): Finding {
  const words = formComponentProblemWords(problem);
  const action = (component.actionRefs ?? []).map((ref) => ref.id).join(', ');
  return screenFinding('S17', {
    message: words.message,
    location: component.actionRefs?.[0]?.location ?? component.location,
    suggestion: words.suggestion,
    counterexample: { component: component.name, ...(action === '' ? {} : { action }) },
  });
}
