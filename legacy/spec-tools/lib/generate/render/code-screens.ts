/**
 * screen_spec → 画面の配線表(`app/src/domain/generated/screens.ts`)の生成器。
 *
 * testid の生成物(code-testids.ts)が「実装が骨格を**書くため**の表」であるのに対し、
 * こちらは「テストが宣言を**数えるため**の表」である。キー引きの表からは
 * 「宣言された部品が何個あるか」「どれとどれが排他か」「この画面からどこへ出られるか」を
 * 取り出せないので、同じ仕様の別の射影として並べて生成する。
 *
 * これが要るのは screenTest の 2 つの突合のためである。
 * 1. **部品の網羅**: 宣言した部品が全部描画されているか(仕様に部品を足したらテストが落ちる)。
 * 2. **遷移の突合**: 描画結果の `href` の行き先が、宣言した `navigations` の中にあるか。
 * どちらも実装側が表を手で持つと成立しない(実装が答え合わせの答えも書くことになる)。
 *
 * `navigations` には共有クロームから継承した分も、`components` には継承した共有クロームの
 * 部品も入る。画面の描画結果には両者の区別が無く、テストが見るのはその描画結果だからである。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { layoutTree, type SlotNode } from '../../screen/layout-tree.js';
import type { ChromeSpec, ScreenLayout, ScreenSpec, ScreenSpecModel } from '../../model/screen/types.js';
import { declaredActionIds } from '../../model/screen/declared-actions.js';
import { navTestIdEntries } from '../../screen/nav-testids.js';
import { onFailLiteral, preconditionLiteral } from '../../screen/precondition-data.js';
import type { GuardServices } from '../../guard/ast.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';
import { RUNTIME_ENGINE_MODULE } from './runtime-modules.js';
import { screenRouteTypes } from './code-screens-types.js';
import { bodyModulesOf } from '../body-modules.js';
import { CONFLICT_LEAVES } from './screen-draft.js';
import { ERROR_LEAF, SUBMIT_LEAF, buildScreenForms } from './screen-form-plan.js';
import type { ScreenFormPlan } from './screen-form-plan.js';
import { ROW_ERROR_LEAF, SAVE_LEAF } from './screen-operation-plan.js';
import { COLUMN_LEAF, EMPTY_LEAF, ROW_LEAF, buildScreenReads } from './screen-read-plan.js';
import type { ScreenReadPlan } from './screen-read-plan.js';


/**
 * 画面の配線表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/screens.ts`(ファイル全体)。
 */
export const screenRoutesGenerator: DocGenerator = {
  id: 'code-screens',

  generate(domain: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const model = ctx.screens;
    if (model === undefined || !model.available) return [];
    // 出力先は 1 ファイルに全画面ぶん(画面をまたぐ突合をここ 1 つで済ませるため)。
    // 入場判定の純関数の置き場は説明文に載るだけ。実装の木を持たない製品(置き場が無い)は指定を載せない。
    const preflightModule =
      ctx.roots.app === null ? null : bodyModulesOf(ctx, { what: '画面の配線表の説明文', location: model.screens[0]?.location ?? { file: 'screens' } }).preflight();
    const content = renderFile(model, ctx.guards, ctx.roots, buildScreenForms(domain, ctx), buildScreenReads(domain, ctx), preflightModule);
    return [{ file: generatedFile(ctx.roots, 'screens.ts'), content, wholeFile: true }];
  },
};

/** ファイル全体を組み立てる。 */
function renderFile(
  model: ScreenSpecModel,
  guards: GuardServices,
  roots: ProductRoots,
  forms: readonly ScreenFormPlan[],
  reads: readonly ScreenReadPlan[],
  preflightModule: string | null,
): string {
  const specFiles = [
    ...model.chromes.map((chrome) => specPath(roots, `frontend/chrome/${chrome.relPath}`)),
    ...model.screens.map((screen) => specPath(roots, `frontend/screens/${screen.relPath}`)),
  ];
  return [
    generatedHeader(specFiles),
    '',
    `import type { GuardExprData } from '${RUNTIME_ENGINE_MODULE}';`,
    "import type { screenTestIds } from './testids';",
    '',
    screenRouteTypes(preflightModule),
    '',
    // 経路の表は転送・リンクの規則が安全の根とする値なので、値ごと深く凍結する(実行時の書き換えで経路を外の URL にさせない。9 回目 B9-7)。
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      '画面名 → その画面の配線。',
      'screenTest は描画結果から `data-testid` と `href` を集め、この表と突き合わせる。',
    ]),
    renderTable(model, guards, forms, reads),
    '',
  ].join('\n');
}

/** 画面名をキーにした表。0 件でも型の付いた空表を出す(利用側の分岐を増やさないため)。 */
function renderTable(
  model: ScreenSpecModel,
  guards: GuardServices,
  forms: readonly ScreenFormPlan[],
  reads: readonly ScreenReadPlan[],
): string {
  const suffix = ' as const satisfies Record<string, GeneratedScreenRoute>';
  if (model.screens.length === 0) return `export const screenRoutes = ${frozen(`{}${suffix}`)};`;
  const byName = new Map(model.chromes.map((chrome) => [chrome.id, chrome]));
  const table: Record<string, LiteralValue> = {};
  for (const screen of model.screens) table[screen.name] = toLiteral(screen, byName, guards, forms, reads);
  return `export const screenRoutes = ${frozen(`${renderLiteral(table)}${suffix}`)};`;
}

/** 画面 1 枚をリテラル値にする(宣言順を保つ)。 */
function toLiteral(
  screen: ScreenSpec,
  chromes: ReadonlyMap<string, ChromeSpec>,
  guards: GuardServices,
  forms: readonly ScreenFormPlan[],
  reads: readonly ScreenReadPlan[],
): LiteralValue {
  const leaves = new Map<string, LiteralValue>([
    ...forms.filter((form) => form.screen === screen.name).map((form): [string, LiteralValue] => [`${screen.name}.${form.path}`, formLeaves(form)]),
    ...reads.filter((read) => read.screen === screen.name).map((read): [string, LiteralValue] => [`${screen.name}.${read.path}`, readLeaves(read)]),
  ]);
  const chrome = screen.chrome === undefined ? undefined : chromes.get(screen.chrome.id);
  return {
    id: screen.id,
    name: screen.name,
    route: screen.route,
    requiresAuth: screen.requiresAuth,
    forRoles: screen.forRoles,
    slots: [
      ...(chrome === undefined ? [] : slotPaths(chrome.layout, chrome.name)),
      ...slotPaths(screen.layout, screen.name),
    ],
    components: [
      // 共有クロームの部品を先に置く(描画上も外枠が先で、読む順が宣言と揃う)。
      ...(chrome === undefined ? [] : components(chrome.layout, chrome.name, undefined, new Map())),
      ...components(screen.layout, screen.name, undefined, leaves),
    ],
    navComponentTestIds: [
      ...(chrome === undefined ? [] : navTestIdEntries(chrome.navigations, chrome.name)),
      ...navTestIdEntries(screen.navigations, screen.name),
    ].map((entry) => entry.value),
    ...preconditionLiteral(screen, guards),
    ...onFailLiteral(screen),
    navigations: screen.navigations.map((navigation) => ({
      on: navigation.on,
      to: navigation.to,
    })),
    actions: [...declaredActionIds(screen)],
    overlays: screen.overlays.map((overlay) => ({
      id: overlay.id,
      slots: slotPaths(overlay.layout, screen.name, `overlay.${overlay.id}`),
      components: components(overlay.layout, screen.name, `overlay.${overlay.id}`, leaves),
    })),
    requiredStates: [...screen.requiredStates],
  };
}

/**
 * レイアウトからスロット(器)の testid を宣言順に取り出す。
 *
 * 部品の一覧(components)が「居るべきもの」の表であるのに対し、こちらは
 * **「居てもよいもの」の表**である。実装は器に testid を付けても付けなくてもよいが、
 * 付けるなら名前は宣言どおりでなければならない(screen-test.md の葉の命名規則)。
 * この 2 つが揃って初めて「宣言に無い部品が描かれていないか」を数えられる。
 */
function slotPaths(layout: ScreenLayout, namespace: string, prefix?: string): string[] {
  const found: string[] = [];
  const at = (path: string): string => (prefix === undefined ? path : `${prefix}.${path}`);
  const visit = (nodes: readonly SlotNode[]): void => {
    for (const node of nodes) {
      found.push(`${namespace}.${at(node.slot.path)}`);
      for (const child of node.components) visit(child.slots);
    }
  };
  visit(layoutTree(layout));
  return found;
}

/**
 * レイアウトから部品の testid を宣言順に取り出す(スロット自身は含めない)。
 *
 * 排他表示の所属は**入れ子の内側へ受け継ぐ**。`own_entry_panel` が排他表示なら、
 * その内側の `submit_bar` も同じ条件でしか現れないからである。受け継がないと、
 * テストが「常に居るはずの部品」として扱ってしまう。
 */
function components(
  layout: ScreenLayout,
  namespace: string,
  prefix: string | undefined,
  leaves: ReadonlyMap<string, LiteralValue>,
): LiteralValue[] {
  const found: LiteralValue[] = [];
  const at = (path: string): string => (prefix === undefined ? path : `${prefix}.${path}`);
  const visit = (nodes: readonly SlotNode[], inherited: Variant | null): void => {
    for (const node of nodes) {
      for (const child of node.components) {
        const variant = variantOf(node, child.component.variant, inherited);
        const testId = `${namespace}.${at(`${node.slot.path}.${child.component.name}`)}`;
        const own = leaves.get(testId);
        found.push({
          testId,
          ...(variant === null ? {} : { variantGroup: variant.group, variantKey: variant.key }),
          ...(own === undefined ? {} : { leaves: own }),
        });
        visit(child.slots, variant);
      }
    }
  };
  visit(layoutTree(layout), null);
  return found;
}

/**
 * `kind: form` の部品の**葉の表**(部品の testid を接頭辞に持つ葉の名前)。
 *
 * 葉は部品の内側の自由地帯だが、**生成物の部品の葉は生成器が決める**ので表にできる(手書きの部品は
 * 葉を持たない — 表を書けるのは生成物だけ)。screenTest は testid を手で書かず、この表から引く
 * (`declarations.ts` の `leafOf`)。`actions` は操作を起こすボタン、`error` は拒否の表示、
 * `fields` は入力欄(entity_spec の宣言の順)。
 */
function formLeaves(form: ScreenFormPlan): LiteralValue {
  return {
    // 確認の器は重ね表示(`overlay.{id}.…` の部品)で、フォームの葉ではない。
    actions: [SUBMIT_LEAF],
    error: ERROR_LEAF,
    // 編集のフォームは、どの欄が出るかが実行時の `writable`(書き込みの規則 × 対象の状態)で決まるので、
    // 欄は「編集してよいときだけ」の側に載せる(静的に決まらない欄を「必ず描かれる」に載せない)。
    ...(form.shape === 'update'
      ? { fields: [], fieldsIfWritable: form.controls.map((control) => control.field), conflictLeaves: CONFLICT_LEAVES }
      : { fields: form.controls.map((control) => control.field) }),
  };
}

/**
 * `kind: table` / `detail` / `actions` の部品の**葉の表**。表は空の葉・行の葉・列の葉(`column.{欄}`)、詳細は項目の葉(`{欄}`)。
 * 読むだけの表と詳細は操作を起こすボタンも入力欄も持たない(行へのリンクは `nav.{on}` で、葉ではない)。
 *
 * 操作を載せる表・ボタン列は、行のボタン(`rowButtons`。行の状態と実行者のロールの交差で出ることがある)と、ボタンの拒否の表示
 * (`buttonError`)を持つ。編集する表はさらに入力欄(`fieldsIfWritable`)・見出し(`columnsIfWritable`。どちらも
 * 器が渡す `writable` に入っている欄だけ)・保存ボタン(`rowActions`)・行の拒否の表示(`rowError`)を持つ(列は
 * `shows` でなく編集してよい欄で決まるので `columns` は空)。
 */
function readLeaves(read: ScreenReadPlan): LiteralValue {
  if (read.part === 'detail') return { actions: [], fields: read.columns.map((column) => column.path) };
  const buttons = read.buttons?.operations.map((operation) => operation.leaf) ?? [];
  const buttonLeaves = buttons.length === 0 ? {} : { rowButtons: buttons, buttonError: ERROR_LEAF };
  // ボタン列は、出せる操作が 1 つも無いときの案内(空の葉)も持つ(行の状態と実行者のロールの交差が空になる状態がある)。
  if (read.part === 'actions') return { actions: [], fields: [], empty: EMPTY_LEAF, ...buttonLeaves };
  const edit = read.edit;
  return {
    actions: [],
    fields: [],
    empty: EMPTY_LEAF,
    row: ROW_LEAF,
    columns: read.columns.map((column) => `${COLUMN_LEAF}.${column.path}`),
    ...(edit === undefined
      ? {}
      : {
          fieldsIfWritable: edit.controls.map((control) => control.field),
          columnsIfWritable: edit.controls.map((control) => `${COLUMN_LEAF}.${control.field}`),
          conflictLeaves: CONFLICT_LEAVES,
          rowActions: [SAVE_LEAF],
          rowError: ROW_ERROR_LEAF,
        }),
    ...buttonLeaves,
  };
}

/** 排他表示の所属(自分の宣言が優先。無ければ親から受け継ぐ)。 */
interface Variant {
  readonly group: string;
  readonly key: string;
}

/** 部品の排他所属を決める。グループ名はスロットのパスで修飾し、スロットをまたいで衝突させない。 */
function variantOf(
  node: SlotNode,
  own: { readonly group: number; readonly key: string } | undefined,
  inherited: Variant | null,
): Variant | null {
  if (own === undefined) return inherited;
  return { group: `${node.slot.path}#${own.group}`, key: own.key };
}
