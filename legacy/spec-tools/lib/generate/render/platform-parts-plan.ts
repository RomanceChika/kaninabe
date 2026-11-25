/**
 * 画面の部品 `kind: platform_read` / `platform_actions` と、`kind: table` の `row_actions`(ADR-0019)→ **画面の部品の生成の入力**。
 *
 * 部品は 3 つの形:
 *   - `read` … `platform_read`: 認証基盤の読み(例: 自分のセッションの一覧)を表にし、`row_actions` の行ごとのボタンを持つ(表・ボタン・確認・拒否の表示が 1 本)
 *   - `bar` … `platform_actions`: 行に依らない操作のボタン列(確認・拒否の表示を持つ)
 *   - `rows` … `table` の `row_actions`: 既存の表(`kind: table`)の行ごとの手書きの差し込み列に置く、行のボタンと、確認・拒否の表示を持つ提供者
 *
 * 画面の部品の生成器(`code-platform-parts.ts`)と、部品を描く生成テストが同じ導出を見る。アプリの語彙は 1 語も持たない(W1)。純関数で throw しない。
 */

import type { GenerateContext } from '../../gen-kit/generator.js';
import { toCamelCase, toPascalCase } from '../../gen-kit/code-emit.js';
import type { LayoutComponent, ScreenLayout, ScreenSpec } from '../../model/screen/types.js';
import { buildPlatformPlan } from './platform-ops-plan.js';
import type { PlatformFieldPlan, PlatformOpPlan, PlatformPlan, PlatformShapePlan } from './platform-ops-plan.js';
import { screenFormFile } from './screen-form-plan.js';

/** 部品の形。 */
export type PlatformPartKind = 'read' | 'bar' | 'rows';

/** 確認の器(重ね表示)。キーは testid のキー(`overlay.{id}.body.center` ほか)。 */
export interface PlatformPartConfirm {
  readonly dialogKey: string;
  readonly barKey: string;
  /** 見出しを `{画面}Labels` から引くキー(重ね表示の `label` があるときだけ。無ければ操作の表示名)。 */
  readonly labelKey?: string;
}

/** ボタン 1 つ。 */
export interface PlatformPartButton {
  readonly op: PlatformOpPlan;
  /** ボタンの testid の葉(操作 ID の名前の部分。`session.end_mine` → `end_mine`)。 */
  readonly leaf: string;
  readonly confirm?: PlatformPartConfirm;
  /** 入力の組み立て(`{ sessionId: row.id, keepSelf: true }` の各 `プロパティ: 式`)。 */
  readonly inputEntries: readonly string[];
  /** 行のこの真偽値の欄が true なら、ボタンを出さない(行の型のプロパティ)。 */
  readonly skipProp?: string;
}

/** 部品 1 つの生成の入力。 */
export interface PlatformPartPlan {
  readonly kind: PlatformPartKind;
  readonly screen: string;
  readonly component: string;
  /** testid のキー(`body.center.session_table`)。 */
  readonly path: string;
  readonly label?: string;
  /** 生成物のファイル名。 */
  readonly file: string;
  readonly exportName: string;
  /** `read`: 表にする読みの操作と、返す欄の集合。 */
  readonly read?: PlatformOpPlan;
  readonly shape?: PlatformShapePlan;
  /** 表に出す欄(`shows` の宣言順。`read` のとき)。 */
  readonly shows: readonly PlatformFieldPlan[];
  readonly buttons: readonly PlatformPartButton[];
  /** 日時の整形を使うか(表示のタイムゾーンを器から受ける)。 */
  readonly usesDatetime: boolean;
  /** `rows`: 行の型が持つべき識別子のプロパティ(`from: row` の欄)。 */
  readonly rowProps: readonly string[];
}

/** 部品を拾う場所(画面本体と重ね表示の部品)。 */
interface Found {
  readonly component: LayoutComponent;
  readonly path: string;
}

/** レイアウトの部品(プラットフォーム操作に関わるもの)。 */
function foundIn(layout: ScreenLayout, prefix: string): readonly Found[] {
  return layout.slots.flatMap((slot) =>
    slot.components
      .filter((component) => component.kind === 'platform_read' || component.kind === 'platform_actions' || (component.kind === 'table' && (component.rowActionRefs?.length ?? 0) > 0))
      .map((component) => ({ component, path: `${prefix}${slot.path}.${component.name}` })),
  );
}

/** 重ね表示から確認の器を引く。 */
function confirmOf(screen: ScreenSpec, component: LayoutComponent, op: string): PlatformPartConfirm | undefined {
  const overlay = screen.overlays.find((candidate) => candidate.openedBy === component.name && candidate.platformOps.some((ref) => ref.id === op));
  if (overlay === undefined) return undefined;
  return {
    dialogKey: `overlay.${overlay.id}.body.center`,
    barKey: `overlay.${overlay.id}.body.center.confirm_bar`,
    ...(overlay.label === undefined ? {} : { labelKey: `overlay.${overlay.id}` }),
  };
}

/** ボタン 1 つ(行から受ける引数は行の型のプロパティから・型つきの引数は既定の値で渡す)。 */
function buttonOf(screen: ScreenSpec, component: LayoutComponent, op: PlatformOpPlan, plan: PlatformPlan, rowPropOf: (field: string, of: string) => string): PlatformPartButton {
  const entries = op.inputs.map((input) => {
    if (input.row) return `${input.prop}: row.${rowPropOf(input.source?.field ?? '', input.source?.of ?? '')}`;
    const declared = op.op.args.find((arg) => arg.name === input.arg);
    const fallback = declared?.kind === 'typed' && declared.default !== undefined ? declared.default : input.type === 'boolean' ? false : input.type === 'number' ? 0 : '';
    return `${input.prop}: ${JSON.stringify(fallback)}`;
  });
  const skipField = op.inputs.find((input) => input.row)?.source?.skipIf;
  const source = op.inputs.find((input) => input.row)?.source?.of;
  const skipProp = skipField === undefined ? undefined : plan.shapes.flatMap((shape) => shape.fields).find((field) => field.field === skipField && source !== undefined)?.prop;
  const confirm = op.op.confirm === true ? confirmOf(screen, component, op.id) : undefined;
  return { op, leaf: op.id.split('.')[1] ?? op.id, ...(confirm === undefined ? {} : { confirm }), inputEntries: entries, ...(skipProp === undefined ? {} : { skipProp }) };
}

/**
 * 全画面のプラットフォーム操作の部品から、生成の入力を導く。
 *
 * @param ctx 生成の文脈(画面仕様・auth_spec)
 * @returns 生成の入力(画面の宣言順 → 画面本体の部品 → 重ね表示の部品)
 */
export function buildPlatformParts(ctx: GenerateContext): readonly PlatformPartPlan[] {
  const screens = ctx.screens;
  const plan = buildPlatformPlan(ctx.auth);
  if (screens === undefined || !screens.available || plan.ops.length === 0) return [];
  const parts: PlatformPartPlan[] = [];
  for (const screen of screens.screens) {
    const found = [...foundIn(screen.layout, ''), ...screen.overlays.flatMap((overlay) => foundIn(overlay.layout, `overlay.${overlay.id}.`))];
    for (const { component, path } of found) {
      const part = partOf(screen, component, path, plan);
      if (part !== null) parts.push(part);
    }
  }
  return parts;
}

/** 部品 1 つ。 */
function partOf(screen: ScreenSpec, component: LayoutComponent, path: string, plan: PlatformPlan): PlatformPartPlan | null {
  const pascal = `${toPascalCase(screen.name)}${toPascalCase(component.name)}`;
  const find = (id: string): PlatformOpPlan | undefined => plan.ops.find((candidate) => candidate.id === id);
  const base = { screen: screen.name, component: component.name, path, ...(component.label === undefined ? {} : { label: component.label }) };
  if (component.kind === 'platform_read') {
    const read = component.platformOpRef === undefined ? undefined : find(component.platformOpRef.id);
    const shape = read?.shape;
    if (read === undefined || shape === undefined) return null;
    const shows = (component.showRefs?.map((show) => show.id) ?? shape.fields.map((field) => field.field)).flatMap((name) => shape.fields.filter((field) => field.field === name));
    const buttons = (component.rowActionRefs ?? []).flatMap((ref) => {
      const op = find(ref.id);
      return op === undefined ? [] : [buttonOf(screen, component, op, plan, (field) => shape.fields.find((candidate) => candidate.field === field)?.prop ?? toCamelCase(field))];
    });
    return {
      ...base,
      kind: 'read',
      file: screenFormFile(screen.name, component.name),
      exportName: pascal,
      read,
      shape,
      shows,
      buttons,
      usesDatetime: shows.some((field) => field.format === 'datetime'),
      rowProps: [],
    };
  }
  if (component.kind === 'platform_actions') {
    const buttons = (component.platformOpRefs ?? []).flatMap((ref) => {
      const op = find(ref.id);
      return op === undefined ? [] : [buttonOf(screen, component, op, plan, (field) => toCamelCase(field))];
    });
    return { ...base, kind: 'bar', file: screenFormFile(screen.name, component.name), exportName: pascal, shows: [], buttons, usesDatetime: false, rowProps: [] };
  }
  const buttons = (component.rowActionRefs ?? []).flatMap((ref) => {
    const op = find(ref.id);
    return op === undefined ? [] : [buttonOf(screen, component, op, plan, (field) => toCamelCase(field))];
  });
  if (buttons.length === 0) return null;
  const rowProps = [...new Set(buttons.flatMap((button) => button.op.inputs.filter((input) => input.row).map((input) => toCamelCase(input.source?.field ?? ''))))];
  return {
    ...base,
    kind: 'rows',
    file: `${screen.name}.${component.name}.platform.tsx`,
    // 主 export は提供者(行ごとのボタンは `{名前}Buttons`。名前は提供者から導く)。
    exportName: `${pascal}PlatformProvider`,
    shows: [],
    buttons,
    usesDatetime: false,
    rowProps,
  };
}
