/**
 * 画面の部品の表・詳細(`kind: table` / `detail`)の**生成の入力**(どの部品が・どの読みの・どの欄の表 / 詳細か)。
 *
 * 表・詳細の生成器(code-screen-tables.ts / code-screen-details.ts)・画面の配線表の葉の表(code-screens.ts)・
 * 期待ファイル木(structure-screen-expectations.ts)が同じ導出を見る(フォームの `screen-form-plan.ts` と同じ理由)。
 * 出す欄は `lib/screen/read-shows.ts`(S18 と同じ導出)から取る。
 *
 * **行の型のキーは camelCase**(設計は生成 zod の行の型の `Pick<Row, …>` = snake_case だったが、器が渡す読み取りの結果の型は
 * 手書きの camelCase で、snake に揃えると結果の型を使う全画面・全テストが動く。結果の型を snake に揃える工事は別に切る)。
 * 型そのものは生成 zod の行の型から**索引して**導く(`WorkshopRow['starts_at']`)ので、欄の型の正は Row のまま —
 * **snake への切替はこの導出のキー(`rowKey`)と生成器の `rowKeyOf` 1 か所**を直せば済む。
 *
 * この導出はアプリの語彙を 1 語も持たない(W1)。**決して throw しない** —— 読みを引けない部品は計画を持たない。
 */

import type { FieldDef, SpecModel } from '../../model/types.js';
import { allMachines } from '../../model/types.js';
import { isSystemSupplied } from '../../model/types-entity.js';
import { navTestIdEntries } from '../../screen/nav-testids.js';
import { includeRoleField, shownFields } from '../../screen/read-shows.js';
import type { ShowCandidate } from '../../screen/read-shows.js';
import { dynamicParams } from '../../model/screen/route-syntax.js';
import type { LayoutComponent, ScreenLayout, ScreenSpec } from '../../model/screen/types.js';
import { findField } from '../../semantics/domain-index.js';
import type { GenerateContext } from '../../gen-kit/generator.js';
import { toCamelCase } from '../../gen-kit/code-emit.js';
import { builtOperationsOf, buildScreenForms, screenFormExport, screenFormFile } from './screen-form-plan.js';
import { buildPlatformParts } from './platform-parts-plan.js';
import { operationPartsOf } from './screen-operation-plan.js';
import type { ButtonsPlan, TableEdit } from './screen-operation-plan.js';

/** 表の空の葉の名前(読みが 0 行のときの表示)。葉の名前の正はここ 1 か所(生成物・葉の表・テストが同じ定数を見る)。 */
export const EMPTY_LEAF = 'empty';

/** 表の行の葉の名前。 */
export const ROW_LEAF = 'row';

/** 表の列の葉の名前の接頭辞(`column.{欄}`)。 */
export const COLUMN_LEAF = 'column';

/** セルの整形の種類。 */
export type CellKind = 'datetime' | 'boolean' | 'enum' | 'state' | 'number' | 'text' | 'url' | 'markdown';

/** 表の列・詳細の項目 1 つ。 */
export interface ReadColumn {
  /** `shows` の綴り(`{欄}` か `{併読名}.{欄}`)。葉の名前の材料でもある。 */
  readonly path: string;
  /** 欄を持つエンティティ(読みの source か併読先)。 */
  readonly entity: string;
  /** 欄の名前。 */
  readonly field: string;
  /** 併読名(併読の欄のとき。併読先のエンティティ名)。 */
  readonly include?: string;
  /** 見出しに添える役割の欄(読みの source が併読先を指す ref の欄。`includeRoleField` が付けると決めたときだけ)。 */
  readonly roleField?: string;
  /** 見出し・項目名を `{entity}FieldLabels` から引けるか(entity_spec の `label` がある。無ければ欄の名前を出す)。 */
  readonly labelled: boolean;
  readonly kind: CellKind;
  /** 値が無い(null / 併読が無い)ことがありうるか。 */
  readonly nullable: boolean;
  /** `enum` の値の表示名の表を引くか(`labels` を宣言した欄だけ)。 */
  readonly enumLabels: boolean;
  /** `state` の欄が属する状態機械の名前(`state` のときだけ)。 */
  readonly machine?: string;
  /** その状態機械の全状態に表示名があるか(無ければ引き当てに既定を添える)。 */
  readonly machineComplete?: boolean;
}

/** 表・詳細・ボタン列 1 つの生成の入力(`actions` は 1 行に対するボタン列で、列を持たない)。 */
export interface ScreenReadPlan {
  readonly part: 'table' | 'detail' | 'actions';
  /** 画面名(snake_case)。testid の名前空間。 */
  readonly screen: string;
  /** 部品名(snake_case)。 */
  readonly component: string;
  /** 部品の testid のキー(フォームと同じ。`body.center.{部品}`)。 */
  readonly path: string;
  /** 部品の表示名(`label`。空状態の文の材料)。 */
  readonly label?: string;
  /** 読みの source のエンティティ(行の型の材料)。 */
  readonly source: string;
  readonly columns: readonly ReadColumn[];
  /** 行から遷移する画面があるときの `nav.{on}` の testid のキー(表のときだけ)。 */
  readonly rowNav?: string;
  /**
   * 行の遷移先(`rowNav` があるとき)。生成物が `screenRoutes[画面名].route` と行の `id` から自分で href を組む(器から関数を
   * 渡さない — 生成物が `'use client'` でも server の器から渡せる形にするため)。`dynamic` は遷移先の route が動的セグメントを
   * ちょうど 1 つ持つか(持てば行の `id` で埋める・持たなければ route そのもの)。
   */
  readonly rowNavTarget?: { readonly screen: string; readonly dynamic: boolean };
  /** 行をその場で編集する操作(`edit`。表のときだけ)。 */
  readonly edit?: TableEdit;
  /** 行のボタン(`actions`。表とボタン列)。 */
  readonly buttons?: ButtonsPlan;
  /** 行の型に足す欄(編集の入力欄と状態の欄。source エンティティの欄の名前)。 */
  readonly extraFields: readonly string[];
  readonly file: string;
  readonly exportName: string;
}

/** 部品と、その testid のキー。 */
interface Found {
  readonly component: LayoutComponent;
  readonly path: string;
}

/**
 * 全画面の `kind: table` / `detail` の部品から、生成の入力を導く。
 *
 * @param model ドメイン仕様
 * @param ctx 生成の文脈(画面仕様・query_spec)
 * @returns 生成の入力(画面の宣言順 → 画面本体の部品 → 重ね表示の部品)
 */
export function buildScreenReads(model: SpecModel, ctx: GenerateContext): readonly ScreenReadPlan[] {
  const screens = ctx.screens;
  const queries = ctx.queries;
  if (screens === undefined || !screens.available || queries === undefined || !queries.available) return [];
  const plans: ScreenReadPlan[] = [];
  for (const screen of screens.screens) {
    for (const found of readComponentsOf(screen)) {
      const plan = planOf(model, ctx, screen, found);
      if (plan !== null) plans.push(plan);
    }
  }
  return plans;
}

/**
 * 画面の部品の生成物(フォーム・表・詳細)が 1 つでもあるか(既定のスタイルと期待木の「置き場があるか」の判定)。
 *
 * @param model ドメイン仕様
 * @param ctx 生成の文脈
 * @returns 1 つでもあれば true
 */
export function hasGeneratedParts(model: SpecModel, ctx: GenerateContext): boolean {
  return buildScreenForms(model, ctx).length > 0 || buildScreenReads(model, ctx).length > 0 || buildPlatformParts(ctx).length > 0;
}

/** 画面本体 → 重ね表示の順に `kind: table` / `detail` / `actions` の部品を拾う。 */
function readComponentsOf(screen: ScreenSpec): readonly Found[] {
  return [
    ...foundIn(screen.layout, ''),
    ...screen.overlays.flatMap((overlay) => foundIn(overlay.layout, `overlay.${overlay.id}.`)),
  ];
}

/** レイアウトの `kind: table` / `detail` / `actions` の部品(`prefix` は重ね表示の名前空間)。 */
function foundIn(layout: ScreenLayout, prefix: string): readonly Found[] {
  return layout.slots.flatMap((slot) =>
    slot.components
      .filter((component) => component.kind === 'table' || component.kind === 'detail' || component.kind === 'actions')
      .map((component) => ({ component, path: `${prefix}${slot.path}.${component.name}` })),
  );
}

/** 部品 1 つの計画(読みを引けない部品は null)。 */
function planOf(model: SpecModel, ctx: GenerateContext, screen: ScreenSpec, found: Found): ScreenReadPlan | null {
  const part = found.component.kind;
  const read = found.component.readRef?.id;
  if ((part !== 'table' && part !== 'detail' && part !== 'actions') || read === undefined) return null;
  const query = ctx.queries?.queries.find((candidate) => candidate.id === read);
  if (query === undefined) return null;
  // 編集する表の列は編集してよい欄で決まる(器が `writable` で渡す)ので、`shows` の列は持たない。ボタン列も列を持たない。
  const columns =
    part === 'actions' || found.component.editRef !== undefined
      ? []
      : shownFields(
          query,
          model,
          found.component.showRefs?.map((show) => show.id),
        ).map((candidate) => columnOf(model, candidate, query.source));
  const nav = part === 'table' ? rowNavOf(screen, ctx) : undefined;
  const operations =
    part === 'detail'
      ? { extraFields: [] }
      : operationPartsOf(
          model,
          ctx,
          screen,
          found.component,
          query.source,
          query.projection.map((field) => field.name),
          builtOperationsOf(model, ctx),
        );
  return {
    ...operations,
    part,
    screen: screen.name,
    component: found.component.name,
    path: found.path,
    ...(found.component.label === undefined ? {} : { label: found.component.label }),
    source: query.source,
    columns,
    ...(nav === undefined ? {} : { rowNav: nav.path, rowNavTarget: nav.target }),
    file: screenFormFile(screen.name, found.component.name),
    exportName: screenFormExport(screen.name, found.component.name),
  };
}

/**
 * 行から遷移する先(testid のキーと、遷移先の画面)。**画面自身の** `navigations`(`on` にドットが無く、共有クロームから
 * 継承していないもの)が**ちょうど 1 本**のときだけ(0 本は遷移なし・2 本以上はどの行の遷移か決まらない)。
 * 遷移先の画面が実在しない・route の動的セグメントが 2 つ以上(行の `id` 1 つでは埋まらない)なら、リンクは出さない
 * (生成物が `screenPath` で throw しない — 実在は S2 が見る)。
 */
function rowNavOf(screen: ScreenSpec, ctx: GenerateContext): { readonly path: string; readonly target: NonNullable<ScreenReadPlan['rowNavTarget']> } | undefined {
  const entries = navTestIdEntries(screen.navigations, screen.name);
  const own = screen.navigations.filter((nav) => nav.viaChrome === undefined && !nav.on.includes('.'));
  const entry = entries[0];
  const navigation = own[0];
  if (entries.length !== 1 || navigation === undefined || entry === undefined) return undefined;
  const target = ctx.screens?.screens.find((candidate) => candidate.id === navigation.to);
  const segments = target === undefined ? 0 : dynamicParams(target.route).length;
  if (target === undefined || segments > 1) return undefined;
  return { path: entry.path, target: { screen: target.name, dynamic: segments === 1 } };
}

/** 欄 1 つのセルの整形の種類。 */
function cellKindOf(field: FieldDef | null): CellKind {
  if (field === null) return 'text';
  // 書式 url の欄は、画面の `href` に出してよい URL だけをリンクにする(自由な文字列を `href` に置かない)。
  if (field.format === 'url') return 'url';
  // 書式 markdown の欄は、許可リストで無害化する描画の部品(`MarkdownView`)だけで描く(生の HTML を画面に載せない)。
  if (field.format === 'markdown') return 'markdown';
  switch (field.type.kind) {
    case 'datetime':
      return 'datetime';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return field.labels === undefined ? 'text' : 'enum';
    case 'state':
      return 'state';
    case 'integer':
    case 'decimal':
      return 'number';
    default:
      return 'text';
  }
}

/** 欄 1 つを列にする。 */
function columnOf(model: SpecModel, candidate: ShowCandidate, source: string): ReadColumn {
  const field = findField(model, candidate.entity, candidate.field);
  const roleField = candidate.include === undefined ? undefined : includeRoleField(model, source, candidate.include);
  const kind = cellKindOf(field);
  const machine = field?.type.kind === 'state' ? field.type.machine : undefined;
  const spec = machine === undefined ? undefined : allMachines(model).find((ref) => ref.machine.machine === machine)?.machine;
  return {
    path: candidate.path,
    entity: candidate.entity,
    field: candidate.field,
    ...(candidate.include === undefined ? {} : { include: candidate.include }),
    ...(roleField === undefined ? {} : { roleField }),
    labelled: field?.label !== undefined,
    kind,
    // 併読の欄は併読が無い行(会場未定など)で値が無い。自分の欄は行の型(Row)の nullable に従う。
    nullable: candidate.include !== undefined || field === null || !(field.required || isSystemSupplied(field)),
    enumLabels: kind === 'enum',
    ...(machine === undefined ? {} : { machine }),
    ...(spec === undefined ? {} : { machineComplete: spec.states.every((state) => spec.stateLabels[state] !== undefined) }),
  };
}

/**
 * 行の型の中での欄のキー(camelCase。**snake_case への切替はここ**)。
 *
 * @param name 欄の名前(snake_case)または併読名
 * @returns 行の型のキー
 */
export function rowKeyOf(name: string): string {
  return toCamelCase(name);
}
