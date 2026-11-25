/**
 * 画面の章(`screens-chapter.ts`)の下段(導出)の HTML 版: 動線の遷移の表・画面ごとの構造と状態ごとの見え方と testid・遷移・テストの表。
 *
 * 表の行と折りたたみの見出しは 共有のもの(`screens-lower.ts`)を使う。実物の SSR プレビューは出力の口の `previewFragment` で置き、
 * 図(mermaid・CSS の入れ子ボックス)は同じ事実を表と箇条で示す(`screens-chapter.ts` の冒頭を参照)。
 */

import type { GenerateContext } from '../../../../gen-kit/generator.js';
import type { ProductRoots } from '../../../../model/product/types.js';
import type { ChromeSpec, ScreenSpec, ScreenSpecModel } from '../../../../model/screen/types.js';
import { layoutTree, type SlotNode } from '../../../../screen/layout-tree.js';
import { stateKeyOf } from '../../../../gen-kit/book-inputs.js';
import { headingSlug } from '../../html.js';
import { collectNavEdges, screenGroup, type NavEdge } from '../../screen-nav-graph.js';
import { screenGroups } from '../../screen-flow-graphs.js';
import { relativeHref } from '../chapters.js';
import { STATE_MEANINGS } from '../screens-page-states.js';
import { KIND_WORDS } from '../screens-upper.js';
import { screenDerivedRows, screenFoldHead, SCREEN_ELEMENTS } from '../screens-lower.js';
import { NO_OVERLAY, PREVIEW_MISSING, splitDialogs } from '../screen-previews.js';
import { dash, fold, inline, mono, pts } from './face-parts.js';
import { el, join, previewFragment, text, url, type Child, type Html } from './markup.js';
import { previewRefused } from './preview-refusal.js';

/** 状態別のプレビューが無いときの表記。 */
const STATE_PREVIEW_MISSING = 'プレビュー未生成 — `cd app && npm run book:previews` で断片を書き出す。';
import { table } from './chapter-parts.js';

/** 参照の並び(等幅。読点でつなぐ)。 */
export function monos(ids: readonly string[]): Html {
  return join(
    ids.map((id) => mono(id)),
    text('、'),
  );
}

/** 画面の名前(上段のその画面の行へのリンク。節に画面が無ければ字だけ)。 */
function screenLink(screen: ScreenSpec, current: ScreenSpec | null): Child {
  const label = current !== null && screenGroup(current) !== screenGroup(screen) ? join([mono(screen.name), ` (${screenGroup(screen)})`]) : mono(screen.name);
  return el('a', { href: url(`#${headingSlug(screen.name)}`) }, label);
}

/** 遷移の辺の表(動線の図の代わり)。 */
function edgeTable(edges: readonly NavEdge[], group: string | null): Html {
  if (edges.length === 0) return pts(['この範囲に遷移は無い']);
  return table(
    ['遷移元', 'きっかけ', '遷移先', '種類'],
    edges.map((edge) => {
      const current = group === null ? null : edge.from.relPath.startsWith(`${group}/`) ? edge.from : edge.to;
      return [
        screenLink(edge.from, current),
        edge.kind === 'navigation' ? mono(edge.on) : edge.on,
        screenLink(edge.to, current),
        edge.kind === 'navigation' ? '遷移' : '入場条件の逃げ道',
      ];
    }),
  );
}

/** 動線の折りたたみ(グループごと + 全体の 2 枚)。 */
function flowFolds(model: ScreenSpecModel): Child[] {
  const edges = collectNavEdges(model);
  const group = (name: string): Html | null => {
    const members = new Set(model.screens.filter((screen) => screenGroup(screen) === name).map((screen) => screen.id));
    return fold({ kind: 'detail', title: `動線 — ${name}`, hint: 'この仕様ディレクトリの画面の出入り。共有クロームの遷移は除く', element: 'screen.navigation' }, [
      edgeTable(
        edges.filter((edge) => !edge.viaChrome && (members.has(edge.from.id) || members.has(edge.to.id))),
        name,
      ),
    ]);
  };
  return [
    el('p', { class: 'bf-group' }, '動線', el('small', null, '図の代わりに遷移の表で示す。画面の名前をたどると、上段の画面の行へ飛ぶ')),
    screenGroups(model).map(group),
    fold({ kind: 'detail', title: '全体 — 画面固有の遷移', hint: '共有クローム由来を除く', element: 'screen.navigation' }, [
      edgeTable(
        edges.filter((edge) => !edge.viaChrome),
        null,
      ),
    ]),
    fold({ kind: 'detail', title: '全体 — 全遷移', hint: '共有クロームのリンク・ログアウトを含む', element: 'screen.navigation' }, [edgeTable(edges, null)]),
  ];
}

/** スロットと部品の入れ子の箇条(構造の図の代わり)。 */
function slotList(nodes: readonly SlotNode[]): Html | null {
  if (nodes.length === 0) return null;
  return el(
    'ul',
    { class: 'bf-pts' },
    nodes.map((node) =>
      el(
        'li',
        null,
        mono(node.slot.path),
        node.components.length === 0
          ? [' ', dash()]
          : el(
              'ul',
              { class: 'bf-pts' },
              node.components.map((entry) =>
                el(
                  'li',
                  null,
                  mono(entry.component.name),
                  ` ${entry.component.kind === undefined ? '手書きの部品' : KIND_WORDS[entry.component.kind]}`,
                  entry.component.variant === undefined ? null : ` (排他${entry.component.variant.group + 1}: ${entry.component.variant.key})`,
                  slotList(entry.slots),
                ),
              ),
            ),
      ),
    ),
  );
}

/** 構造の欄(共有クローム・画面のスロット・重ね表示)。 */
function structure(screen: ScreenSpec, chrome: ChromeSpec | undefined): Child[] {
  return [
    el('p', { class: 'bf-group' }, '構造', el('small', null, 'スロットと部品の入れ子。薄い枠(宣言の無いスロット)は出さない')),
    pts([
      ...(chrome === undefined ? [] : [join(['共有クローム ', mono(chrome.name)])]),
      ...(screen.overlays.length === 0 ? [] : [join(['重ね表示 ', monos(screen.overlays.map((overlay) => overlay.id))])]),
    ]),
    slotList(layoutTree(screen.layout)) ?? pts(['レイアウトの宣言なし']),
  ];
}

/** プレビューの舞台(断片が許可表を通らなければ生成を止める)。 */
function stage(fragment: string, data: Readonly<Record<`data-${string}`, string>>, roots: ProductRoots, className?: string): Html {
  const html = previewFragment(fragment) ?? previewRefused(fragment, data['data-preview-screen'] ?? data['data-preview-overlay'] ?? '', roots);
  return el('div', { class: ['bf-preview-stage', className] }, el('div', { class: 'screen-preview', inert: true, ...data }, html));
}

/** 実物の欄と重ね表示の欄(実装を偽データで描いた SSR プレビュー)。 */
function previews(screen: ScreenSpec, ctx: GenerateContext): Child[] {
  const preview = ctx.book?.previews?.get(screen.name);
  if (preview === undefined) return [el('p', { class: 'bf-group' }, '実物'), el('p', { class: 'bf-note' }, inline(PREVIEW_MISSING))];
  const { base, overlays } = splitDialogs(preview);
  return [
    el('p', { class: 'bf-group' }, '実物', el('small', null, '実装を偽データで描いた SSR プレビュー')),
    stage(base, { 'data-preview-screen': screen.name }, ctx.roots),
    el('p', { class: 'bf-group' }, '重ね表示', el('small', null, '開いた状態')),
    overlays.length === 0
      ? el('p', { class: 'bf-note' }, NO_OVERLAY)
      : el(
          'div',
          { class: 'bf-preview-row' },
          overlays.map((overlay) =>
            el(
              'figure',
              { class: 'bf-preview-card' },
              stage(overlay.html, { 'data-preview-overlay': overlay.id }, ctx.roots, 'bf-preview-stage--overlay'),
              el('figcaption', null, overlay.id),
            ),
          ),
        ),
  ];
}

/** 状態ごとの見え方(状態ごとの小さな SSR プレビュー、または出せない理由)。 */
function stateItems(screen: ScreenSpec, ctx: GenerateContext): Child[] {
  if (screen.requiredStates.length === 0) return [];
  const gaps = new Map((ctx.book?.stateGaps ?? []).filter((gap) => gap.screen === screen.name).map((gap) => [gap.state, gap.reason] as const));
  return [
    el('p', { class: 'bf-group' }, '状態ごとの見え方', el('small', null, 'states.requires')),
    el(
      'div',
      { class: 'bf-preview-row' },
      screen.requiredStates.map((state) => {
        const gap = gaps.get(state);
        const fragment = ctx.book?.statePreviews?.get(stateKeyOf(screen.name, state));
        const body =
          gap !== undefined
            ? // 実装(画面のプレビューの登録)が書いた理由の写し。生成器の定型文ではないので、印を付けて文体の検査から外す
              el('p', { class: 'bf-note', 'data-quoted': 'app' }, gap)
            : fragment === undefined
              ? el('p', { class: 'bf-note' }, inline(STATE_PREVIEW_MISSING))
              : stage(fragment, { 'data-preview-screen': screen.name, 'data-preview-state': state }, ctx.roots, 'bf-preview-stage--state');
        return el('figure', { class: 'bf-preview-card' }, body, el('figcaption', null, `${state} — ${STATE_MEANINGS[state]}`));
      }),
    ),
  ];
}

/** 画面 1 枚の折りたたみ(構造・状態ごとの見え方 + testid・遷移・テストの表)。 */
function screenFold(model: ScreenSpecModel, screen: ScreenSpec, ctx: GenerateContext, file: string): Html | null {
  const chrome = screen.chrome === undefined ? undefined : model.chromes.find((candidate) => candidate.id === screen.chrome?.id);
  return fold({ kind: 'table', ...screenFoldHead(screen), element: SCREEN_ELEMENTS }, [
    el('p', null, 'ルート ', mono(screen.route), ' — 仕様: ', el('a', { href: url(relativeHref(file, screen.location.file)) }, screen.relPath)),
    previews(screen, ctx),
    structure(screen, chrome),
    stateItems(screen, ctx),
    table(
      ['種類', '名前', '中身'],
      screenDerivedRows(screen).map((row) => row.map(inline)),
    ),
  ]);
}

/** 下段の本体(導入・動線の表・画面ごとの折りたたみ)。 */
export function lowerBlocks(model: ScreenSpecModel, ctx: GenerateContext, file: string): Child[] {
  return [
    pts(
      [
        '実物の SSR プレビューは、実装の画面部品を偽データで描き、実装の CSS を当てたもの',
        '重ね表示は開いた姿で並べる',
        '構造は、宣言したスロットと部品の入れ子を箇条で示す。動線は遷移の表で示す',
        '仕様が表示の義務を宣言した状態は、状態ごとの見え方として画面の折りたたみに並ぶ',
      ],
      true,
    ),
    flowFolds(model),
    el('p', { class: 'bf-group' }, '画面ごとの構造と表', el('small', null, `${model.screens.length} 枚`)),
    model.screens.map((screen) => screenFold(model, screen, ctx, file)),
  ];
}
