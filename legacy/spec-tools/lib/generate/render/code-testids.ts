/**
 * screen_spec / chrome_spec → testid 定数表(`app/src/domain/generated/testids.ts`)の生成器。
 *
 * testid の骨格は仕様の layout(スロットのフルパス)そのものであり、実装が同じ文字列を
 * 手で書くと**仕様と DOM が静かにずれる**(C-1 の実測: 共有ヘッダが `app.header.…` を名前に使っており、
 * 仕様の名前空間 `member.header.…` とは別物になっていた)。仕様に既にある値なので、
 * 生成物として実装へ渡し、画面は import するだけにする(生成 zod・状態 label と同じ流儀)。
 *
 * 表に載るのは**仕様が宣言した骨格だけ**である。部品の内側(入力欄・行・エラー表示)は
 * 実装の自由地帯なので、実装は `` `${画面の定数}.title` `` のように骨格の定数から派生させる。
 * 骨格が定数由来であることは ESLint(`TESTID_RESTRICTED_SYNTAX`)が執行する。
 *
 * 排他表示(`variants:`)の状態名はパスに現れない。DOM 上はどちらか一方しか存在しないため、
 * 状態名を含めるとテストが「いまどちらが出ているか」を先に知らないと部品を引けなくなる。
 *
 * 重ね表示(`overlays`)は**画面と同じ表に**、`overlay.{overlay id}.` を前置きにして載る
 * (C-6 の初実例で決めた名前空間。testid は `{画面名}.overlay.{overlay id}.{スロットパス}.{部品}`)。
 * 別の定数に分けないのは、実装から見れば「同じ画面が描くもの」であり、画面ごとに 1 つの表を
 * import すれば足りるからである。前置きを付けるのは、画面の layout と overlay の layout が
 * 同じスロット名(`body.center`)を持てるためで、名前空間を分けないとキーが衝突する。
 *
 * `navigations` のうち**操作が伴わない遷移**(`on` がドットを含まない UI 都合の自由語彙。
 * 例: 一覧の行リンク・「もどる」リンク)は、宣言した `layout` の部品と 1 対 1 に対応するとは
 * 限らない(表の行それぞれが遷移元になる、のような形)。骨格が無いと screenTest / walker が
 * その遷移元の DOM 要素を機械で特定できない(2026-09-04 実測: walker のクリック候補列挙は
 * `[data-testid]` を持つ要素しか見ないため、testid の無いリンクは**踏めない**)。
 * そこでこの種の遷移にも `nav.{on}` という骨格を出す(同じ表の中。`nav` はスロット語彙に
 * 無い接頭辞なので衝突しない)。`{event}.success` 形(操作の結果としての遷移)は対象外 —
 * 発火元のボタンは `actions` 経由で既に `layout` に骨格を持つ(二重に生成しない)。
 * 共有クロームから展開された遷移(`viaChrome` を持つ)も対象外 — 骨格は展開元の chrome の表
 * (このファイルの中の別の定数)が持つ。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { layoutTree, type SlotNode } from '../../screen/layout-tree.js';
import type { ChromeSpec, ScreenLayout, ScreenNavigation, ScreenSpec, ScreenSpecModel } from '../../model/screen/types.js';
import { navTestIdEntries } from '../../screen/nav-testids.js';
import { layoutTestIds, screenTestIdEntries, type TestIdEntry } from '../../screen/testid-entries.js';
import { generatedFile, docComment, generatedHeader, toCamelCase, tsString } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';

/** 出力先(1 ファイルに全画面ぶん。画面をまたぐ突合をここ 1 つで済ませるため)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'testids.ts');

/**
 * 画面・共有クロームの testid 定数表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/testids.ts`(ファイル全体)。
 */
export const testIdsGenerator: DocGenerator = {
  id: 'code-testids',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const model = ctx.screens;
    if (model === undefined || !model.available) return [];
    return [{ file: outputFile(ctx.roots), content: renderFile(model, ctx.roots), wholeFile: true }];
  },
};

/** ファイル全体を組み立てる。 */
function renderFile(model: ScreenSpecModel, roots: ProductRoots): string {
  const specFiles = [
    ...model.chromes.map((chrome) => specPath(roots, `frontend/chrome/${chrome.relPath}`)),
    ...model.screens.map((screen) => specPath(roots, `frontend/screens/${screen.relPath}`)),
  ];
  const blocks = [
    ...model.chromes.map((chrome) => renderChrome(chrome, roots)),
    ...model.screens.map((screen) => renderScreen(screen, roots)),
    renderIndex(model),
  ];
  return [generatedHeader(specFiles), '', ...blocks].join('\n');
}

/** 共有クローム 1 件ぶんの定数。 */
function renderChrome(chrome: ChromeSpec, roots: ProductRoots): string {
  return [
    docComment([
      `共有クローム ${chrome.name} の testid。`,
      '画面の layout はこの内側に入るため、名前空間は画面のものと衝突しない。',
      `仕様: ${specPath(roots, `frontend/chrome/${chrome.relPath}`)}`,
    ]),
    renderTable(`${toCamelCase(chrome.name)}ChromeTestIds`, [
      ...layoutTestIds(chrome.layout, chrome.name),
      ...navEntries(chrome.navigations, chrome.name),
    ]),
    ...renderLabels(
      `${toCamelCase(chrome.name)}ChromeLabels`,
      `共有クローム ${chrome.name}`,
      specPath(roots, `frontend/chrome/${chrome.relPath}`),
      [...titleEntry(chrome.label), ...labelEntries(chrome.layout)],
    ),
    '',
  ].join('\n');
}

/** 画面 1 件ぶんの定数(重ね表示は `overlay.{id}.` を前置きにして同じ表に載る)。 */
function renderScreen(screen: ScreenSpec, roots: ProductRoots): string {
  return [
    docComment([
      `画面 ${screen.name}(${screen.route})の testid。`,
      'キーは layout のスロットパスそのもの。部品の内側の testid は、この定数を前置きにして作る。',
      '重ね表示の部品は `overlay.{重ね表示の id}.` を前置きにしたキーで引く。',
      `仕様: ${specPath(roots, `frontend/screens/${screen.relPath}`)}`,
    ]),
    renderTable(`${toCamelCase(screen.name)}TestIds`, screenTestIdEntries(screen)),
    ...renderLabels(
      `${toCamelCase(screen.name)}Labels`,
      `画面 ${screen.name}`,
      specPath(roots, `frontend/screens/${screen.relPath}`),
      [
        ...titleEntry(screen.label),
        ...labelEntries(screen.layout),
        // 重ね表示そのものの表示名(確認の見出し。キーは `overlay.{id}` — 部品のキー `overlay.{id}.…` とは衝突しない)。
        ...screen.overlays.flatMap((overlay) => [
          ...(overlay.label === undefined ? [] : [{ path: `overlay.${overlay.id}`, value: overlay.label }]),
          ...labelEntries(overlay.layout, `overlay.${overlay.id}`),
        ]),
      ],
    ),
    '',
  ].join('\n');
}

/**
 * 部品の表示名の表(`layout` の `label`)。宣言が 1 つも無ければ何も出さない
 * (空の表を常に出すと「表示名という宣言を書けるのに書いていない」ノイズが 9 画面ぶん並ぶ)。
 *
 * キーは testid の表と同じスロットパスであり、実装は同じキーで骨格(testid)と文言(label)を引く。
 */
function renderLabels(
  name: string,
  subject: string,
  specFile: string,
  table: readonly TestIdEntry[],
): string[] {
  if (table.length === 0) return [];
  return [
    docComment([
      `${subject} の表示名(トップレベルの label と layout の label)。`,
      '画面はスロットパス(testid と同じキー)で配線し、見出し・部品名の文字列はこの表から引く。',
      '画面そのものの日本語名は `screenTitle` のキーに載る(スロットパスとは衝突しない camelCase)。',
      `label を宣言していない部品はキーを持たない。仕様: ${specFile}`,
    ]),
    renderTable(name, table),
  ];
}

/**
 * 画面・共有クロームそのものの表示名(トップレベル `label`)の 1 件。
 *
 * キーは `screenTitle` — スロットパスは必ず snake_case の部品名でできているので、
 * camelCase のこの名前が部品のキーと衝突することはない(表を 2 つに割らずに済む)。
 * 宣言が無ければ 0 件で、表にキーは現れない。
 */
function titleEntry(label: string | undefined): readonly TestIdEntry[] {
  return label === undefined ? [] : [{ path: 'screenTitle', value: label }];
}

/** レイアウトから label を持つ部品(スロットパス → 表示名)を宣言順に取り出す。 */
function labelEntries(layout: ScreenLayout, prefix?: string): readonly TestIdEntry[] {
  const found: TestIdEntry[] = [];
  const at = (path: string): string => (prefix === undefined ? path : `${prefix}.${path}`);
  const visit = (nodes: readonly SlotNode[]): void => {
    for (const node of nodes) {
      for (const child of node.components) {
        const label = child.component.label;
        if (label !== undefined) {
          found.push({ path: at(`${node.slot.path}.${child.component.name}`), value: label });
        }
        visit(child.slots);
      }
    }
  };
  visit(layoutTree(layout));
  return found;
}

/** 画面名 → 画面の表、の索引(画面をまたいで引く道具立てのため)。 */
function renderIndex(model: ScreenSpecModel): string {
  const lines = model.screens.map(
    (screen) => `  ${screen.name}: ${toCamelCase(screen.name)}TestIds,`,
  );
  return [
    docComment([
      '画面名から testid 表を引く索引。',
      '画面をまたいで走る道具(将来の screenTest)が、画面名だけを頼りに骨格を引けるようにする。',
    ]),
    lines.length === 0
      ? 'export const screenTestIds = {} as const;'
      : ['export const screenTestIds = {', ...lines, '} as const;'].join('\n'),
    '',
  ].join('\n');
}

/** 1 つの定数表(キーはドットを含むので必ず引用符で囲む)。 */
function renderTable(name: string, table: readonly TestIdEntry[]): string {
  if (table.length === 0) return `export const ${name} = {} as const;`;
  return [
    `export const ${name} = {`,
    ...table.map((entry) => `  ${tsString(entry.path)}: ${tsString(entry.value)},`),
    '} as const;',
  ].join('\n');
}

/**
 * `navigations` から testid の骨格を作る(対象の絞り込みは nav-testids.ts が正)。
 * このモジュールでの役目は `NavTestIdEntry` を `TestIdEntry`(同じ形)に渡すだけ。
 */
function navEntries(navigations: readonly ScreenNavigation[], namespace: string): readonly TestIdEntry[] {
  return navTestIdEntries(navigations, namespace);
}
