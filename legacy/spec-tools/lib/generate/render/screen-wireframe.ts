/**
 * ワイヤーフレーム(specs/frontend/screens/README.md の `screen-wireframes` ブロック)の生成器。
 *
 * 画面仕様の layout は「どのスロットに何が載るか」を宣言するが、YAML を 1 枚ずつ開いて
 * 頭の中で組み立てないと**画面の形**が見えない。共有クロームを継承していればなおさらで、
 * 外枠は別のファイルに書いてある。ここはその組み立てを機械にやらせ、人間が「この画面は
 * これでいいか」を目で判断する材料にする(遷移図・状態遷移図と同じ分担)。
 *
 * 絵としての凝りより**正確さ**を採る: スロットの語彙・入れ子・排他表示・重ね表示を
 * 宣言どおりに写し、宣言していないスロットは「無い」と書く。位置・大きさ・余白は仕様が
 * 持たないので描かない(描くと、仕様が持たない情報を持っているように見えてしまう)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { layoutTree, type SlotNode } from '../../screen/layout-tree.js';
import type {
  ChromeSpec,
  ScreenLayout,
  ScreenOverlay,
  ScreenSpec,
  ScreenSpecModel,
} from '../../model/screen/types.js';
import { specPath } from '../../model/product/paths.js';
import { fencedBlock } from './fenced.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 差し込み先。図は一覧・遷移図と同じディレクトリガイドに置く。 */
function screensReadme(roots: ProductRoots): string {
  return specPath(roots, 'frontend/screens/README.md');
}

/** 置き場はあるが 0 件のときの表記。 */
const EMPTY =
  'まだ screen_spec はありません(画面を仕様化すると、ここにワイヤーフレームが生成されます)。';

/** そもそも specs/frontend/screens を読めなかったときの表記。 */
const UNAVAILABLE =
  'specs/frontend/screens を読み込めなかったため、ワイヤーフレームを生成していません(ディレクトリの有無を確認すること)。';

/** スロットの表示順(値域)。宣言が無くても行として出し、3×3 の骨格を毎回同じ形で見せる。 */
const SLOT_ORDER: readonly string[] = ['header', 'body.left', 'body.center', 'body.right', 'footer'];

/** 宣言の無いスロットの表記。 */
const NONE = '—';

/** 図の読み方(生成ブロックの先頭に置く。図と凡例が離れると読めないため一緒に生成する)。 */
export const WIREFRAME_LEGEND =
  '凡例: `[排他{n} {状態}]` は同時には出ない部品(どの状態でどちらが出るかは実装の自由)。' +
  '**同じ番号の中から 1 つだけ**が描かれ、番号が違うグループは互いに独立している' +
  '(番号が 2 つあれば、各グループから 1 つずつ = 同時に 2 つ描かれる)。' +
  '`└` は部品の内側の入れ子スロット。`—` は宣言の無いスロット。' +
  'chrome の枠は外枠で、画面の枠はその内側に入る。';

/**
 * 画面仕様からワイヤーフレームを生成するジェネレーター。
 * 出力は screens/README.md の `screen-wireframes` マーカー 1 か所。
 */
export const screenWireframeGenerator: DocGenerator = {
  id: 'screen-wireframes',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const model = ctx.screens;
    if (model === undefined || !model.available) {
      return [{ file: screensReadme(ctx.roots), marker: 'screen-wireframes', content: UNAVAILABLE }];
    }
    const content = model.screens.length === 0 ? EMPTY : renderAll(model);
    return [{ file: screensReadme(ctx.roots), marker: 'screen-wireframes', content }];
  },
};

/**
 * 全画面のワイヤーフレームを組み立てる。
 *
 * @param model 読み込み済みの画面仕様
 * @returns Markdown 断片(末尾に改行を含まない)
 */
export function renderAll(model: ScreenSpecModel): string {
  const byId = new Map(model.chromes.map((chrome) => [chrome.id, chrome]));
  const blocks = model.screens.map((screen) =>
    renderScreen(screen, screen.chrome === undefined ? undefined : byId.get(screen.chrome.id)),
  );
  return [WIREFRAME_LEGEND, '', ...blocks].join('\n').trimEnd();
}

/**
 * 画面 1 枚の枠の中身(テキスト図の行)を作る。
 *
 * README の一覧(このモジュール)と、screen_spec 個別ファイルの本文ブロック(screen-body)が
 * 同じ図を出すため、行の組み立てをここに 1 つだけ置く。
 *
 * @param screen 対象の画面
 * @param chrome 継承する共有クローム(継承していなければ undefined)
 * @returns code fence の中に置く行(fence 自体は含まない)
 */
export function screenFrameLines(screen: ScreenSpec, chrome: ChromeSpec | undefined): string[] {
  const lines: string[] = [];
  if (chrome !== undefined) lines.push(...chromeFrameLines(chrome));
  lines.push(`+-- screen: ${screen.name}`, ...frame(screen.layout, true));
  for (const overlay of screen.overlays) {
    lines.push(`+-- overlay: ${overlay.id}${openedBy(overlay)}`, ...frame(overlay.layout, false));
  }
  return lines;
}

/**
 * 共有クロームの枠の行を作る(chrome_spec 個別ファイルの本文ブロックも使う)。
 *
 * @param chrome 対象のクローム
 * @returns code fence の中に置く行(fence 自体は含まない)
 */
export function chromeFrameLines(chrome: ChromeSpec): string[] {
  return [`+-- chrome: ${chrome.name}`, ...frame(chrome.layout, false)];
}

/** 画面 1 枚(chrome の外枠 + 画面の内枠 + 重ね表示)。 */
function renderScreen(screen: ScreenSpec, chrome: ChromeSpec | undefined): string {
  return [`**${screen.name}** — \`${screen.route}\``, '', fencedBlock('text', screenFrameLines(screen, chrome)), ''].join('\n');
}

/** 重ね表示を開く部品の注記。 */
function openedBy(overlay: ScreenOverlay): string {
  return overlay.openedBy === undefined ? '' : ` (opened_by: ${overlay.openedBy})`;
}

/**
 * 1 つのレイアウトの中身を枠の中の行にする。
 *
 * @param layout 平坦化済みのレイアウト
 * @param full 値域のスロットをすべて出すか(画面本体は 3×3 の骨格を毎回見せる。
 *   chrome と重ね表示は部分的な枠なので、宣言したスロットだけを出す)
 */
function frame(layout: ScreenLayout, full: boolean): string[] {
  const nodes = layoutTree(layout);
  const shown = full ? withMissingSlots(nodes) : nodes.map((node) => ({ node, name: node.slot.slot }));
  const width = Math.max(0, ...shown.map((row) => row.name.length));
  return shown.flatMap((row) => slotLines(row.name.padEnd(width), row.node));
}

/** 値域のスロットを宣言の有無にかかわらず並べ、語彙外のスロットは後ろに足す。 */
function withMissingSlots(
  nodes: readonly SlotNode[],
): readonly { node: SlotNode | undefined; name: string }[] {
  const declared = new Map(nodes.map((node) => [node.slot.slot, node]));
  const ordered = SLOT_ORDER.map((name) => ({ node: declared.get(name), name }));
  const extra = nodes
    .filter((node) => !SLOT_ORDER.includes(node.slot.slot))
    .map((node) => ({ node, name: node.slot.slot }));
  return [...ordered, ...extra];
}

/** スロット 1 行(と、そこに載る部品の続き行)。 */
function slotLines(label: string, node: SlotNode | undefined): string[] {
  if (node === undefined || node.components.length === 0) return [`|   ${label} : ${NONE}`];
  const lines: string[] = [];
  node.components.forEach((child, index) => {
    const head = index === 0 ? `|   ${label} : ` : `|   ${' '.repeat(label.length)}   `;
    lines.push(`${head}${componentText(child.component)}`);
    lines.push(...nestedLines(child.slots, `|   ${' '.repeat(label.length)}     `));
  });
  return lines;
}

/**
 * 部品 1 つの表記(排他表示ならグループ番号と状態名を前置きする)。
 *
 * 番号を必ず出すのは、1 つのスロットに排他グループが 2 つ以上あるとき
 * 「どれとどれが排他か」が図から読めなくなるためである(番号が無いと、独立した 2 グループが
 * 「全部で 1 つだけ出る」と誤読される)。グループが 1 つしかない画面でも同じ形で出す
 * — 表記が画面によって変わるほうが読み手の負担になる。
 */
function componentText(component: SlotNode['components'][number]['component']): string {
  const variant = component.variant;
  return variant === undefined
    ? component.name
    : `[排他${variant.group + 1} ${variant.key}] ${component.name}`;
}

/** 部品の内側の入れ子スロット(親の直下にぶら下げる。入れ子は 3 段までなので再帰は浅い)。 */
function nestedLines(nodes: readonly SlotNode[], indent: string): string[] {
  const width = Math.max(0, ...nodes.map((node) => node.slot.slot.length));
  const lines: string[] = [];
  for (const node of nodes) {
    const label = node.slot.slot.padEnd(width);
    if (node.components.length === 0) {
      lines.push(`${indent}└ ${label} : ${NONE}`);
      continue;
    }
    node.components.forEach((child, index) => {
      const head = index === 0 ? `└ ${label} : ` : `  ${' '.repeat(width)}   `;
      lines.push(`${indent}${head}${componentText(child.component)}`);
      lines.push(...nestedLines(child.slots, `${indent}  `));
    });
  }
  return lines;
}
