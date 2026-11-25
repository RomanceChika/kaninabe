/**
 * 表・詳細(`kind: table` / `detail`)の生成物が共有する**字面**(行の型・import・セルの整形)。
 *
 * 表と詳細は「同じ読みの同じ欄を、同じ整形で出す」ので、整形はここ 1 か所に置く(表と詳細で同じ欄の見せ方が
 * ずれない — 設計メモの「一覧と詳細で同じ欄の見出しが同じになる」)。
 *
 * 整形の規則: 日時 → `formatDateTime`(表示のタイムゾーンは器が `timeZone` で渡す。生成物は env を読まない)/
 * 真偽値 → 「はい / いいえ」/ enum → `{entity}EnumLabels` / 状態 → `{machine}StateLabels`(文字だけ。バッジの色は層 (c))/
 * 値無し → 「—」/ 数値・文字列はそのまま。アプリの語彙は 1 語も持たない(W1)。
 */

import { TABLE_WORDING } from '../../messages/messages-screen.js';
import { HEADING_WORDING } from '../../messages/messages-screen-heading.js';
import { toCamelCase, toPascalCase, tsString } from '../../gen-kit/code-emit.js';
import { RUNTIME_DATETIME_MODULE, RUNTIME_MARKDOWN_VIEW_MODULE, RUNTIME_URL_MODULE } from './runtime-modules.js';
import type { ReadColumn, ScreenReadPlan } from './screen-read-plan.js';
import { rowKeyOf } from './screen-read-plan.js';
import type { BodyModules } from '../body-modules.js';

/** 表の行を識別する欄(行の `key`)。どの集約にも `id` があり、読みの projection は `id` を持つ。 */
export const ROW_KEY_FIELD = 'id';

/** `{Entity}Row`(生成 zod の行の型)の名前。 */
function rowTypeName(entity: string): string {
  return `${toPascalCase(entity)}Row`;
}

/** 表・詳細の行の型の名前(`{export 名}Row`)。 */
export function rowInterfaceName(plan: ScreenReadPlan): string {
  return `${plan.exportName}Row`;
}

/** 日時の欄があるか(`timeZone` を受けるか)。 */
export function usesTimeZone(plan: ScreenReadPlan): boolean {
  return plan.columns.some((column) => column.kind === 'datetime');
}

/** 値無しの置き換え(`NONE`)を使うか。 */
function usesNone(plan: ScreenReadPlan): boolean {
  return plan.columns.some((column) => column.nullable || column.kind === 'url');
}

/** 書式 url の欄があるか(安全なリンクの部品を import して使うか)。 */
export function usesUrl(plan: ScreenReadPlan): boolean {
  return plan.columns.some((column) => column.kind === 'url');
}

/** 書式 markdown の欄があるか(本文の描画の部品を import して使うか)。 */
export function usesMarkdown(plan: ScreenReadPlan): boolean {
  return plan.columns.some((column) => column.kind === 'markdown');
}

/**
 * import の行(型の行・表示名の表・日時の整形)。モジュールごとにまとめる。
 *
 * @param plan 生成の入力
 * @param modules 本文が import する先の解決(置き場の配置が決める)
 * @returns import 文の行
 */
export function readImportLines(plan: ScreenReadPlan, modules: BodyModules): readonly string[] {
  const rows = [...new Set([plan.source, ...plan.columns.map((column) => column.entity)])];
  const labels = new Map<string, Set<string>>();
  const add = (module: string, name: string): void => {
    const names = labels.get(module) ?? new Set<string>();
    names.add(name);
    labels.set(module, names);
  };
  for (const column of plan.columns) {
    const entity = toCamelCase(column.entity);
    // 役割を添える見出しは、読みの source の ref の欄の見出しも引く。
    if (column.roleField !== undefined) add(plan.source, `${toCamelCase(plan.source)}FieldLabels`);
    if (column.labelled) add(column.entity, `${entity}FieldLabels`);
    if (column.enumLabels) add(column.entity, `${entity}EnumLabels`);
    if (column.machine !== undefined) add(column.machine, `${toCamelCase(column.machine)}StateLabels`);
  }
  return [
    ...(usesTimeZone(plan) ? [`import { formatDateTime } from '${RUNTIME_DATETIME_MODULE}';`] : []),
    ...(usesUrl(plan) ? [`import { safeHttpUrl } from '${RUNTIME_URL_MODULE}';`] : []),
    ...(usesMarkdown(plan) ? [`import { MarkdownView } from '${RUNTIME_MARKDOWN_VIEW_MODULE}';`] : []),
    ...rows.map((entity) => `import type { ${rowTypeName(entity)} } from '${modules.generated(`${entity}.schema`)}';`),
    ...[...labels.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, names]) => `import { ${[...names].sort().join(', ')} } from '${modules.generated(`${module}.labels`)}';`),
  ];
}

/**
 * 値の定数(値無し・はい・いいえ。使うものだけ)。
 *
 * @param plan 生成の入力
 * @returns 定数の宣言(doc コメント付き)の行
 */
export function wordingConstLines(plan: ScreenReadPlan): readonly string[] {
  const lines: string[] = [];
  if (usesNone(plan)) lines.push('/** 値が無いときの表示。 */', `const NONE = ${tsString(TABLE_WORDING.none())};`, '');
  if (usesUrl(plan)) {
    lines.push(
      '/** 書式 url の欄のセル: 画面の `href` に出してよい URL(絶対 URL の http / https)だけをリンクにし、それ以外は値無しと同じ表示にする。 */',
      'function UrlLink({ value }: { readonly value: string | null | undefined }) {',
      '  const href = safeHttpUrl(value);',
      '  return href === null ? <>{NONE}</> : <a href={href} rel="noopener noreferrer" target="_blank">{href}</a>;',
      '}',
      '',
    );
  }
  if (plan.columns.some((column) => column.kind === 'boolean')) {
    lines.push(
      '/** 真偽値の表示(表と詳細で同じ語)。 */',
      `const YES = ${tsString(TABLE_WORDING.yes())};`,
      `const NO = ${tsString(TABLE_WORDING.no())};`,
      '',
    );
  }
  return lines;
}

/** 値が無いときに `NONE` を返す整形の補助を使うか。 */
export function usesWhen(plan: ScreenReadPlan): boolean {
  return plan.columns.some((column) => column.nullable && column.kind !== 'text' && column.kind !== 'number' && column.kind !== 'url' && column.kind !== 'markdown');
}

/**
 * 値が無いときに表示を `NONE` にする補助関数(`when`)。使うときだけ出す。
 *
 * @returns 関数の行
 */
export function whenLines(): readonly string[] {
  return [
    '/** 値が無い(null / 併読が無い)ときは `NONE`、あれば整形する。 */',
    'function when<T>(value: T | null | undefined, format: (present: T) => string): string {',
    '  return value === null || value === undefined ? NONE : format(value);',
    '}',
    '',
  ];
}

/**
 * 行の型の interface(キーは `rowKeyOf`。型は生成 zod の行の型から索引する)。
 *
 * @param plan 生成の入力
 * @returns ソースの行
 */
export function rowInterfaceLines(plan: ScreenReadPlan): readonly string[] {
  const own = plan.columns.filter((column) => column.include === undefined);
  // 表の行・ボタン列の行は `id` を必須に持つ(React の `key` と操作の対象。`shows` に `id` を足していなければここで足す)。
  const keyed = plan.part !== 'detail' && !own.some((column) => column.field === ROW_KEY_FIELD);
  // 編集の入力欄と状態の欄は、`shows` に無くても行が持つ(`id` は上で足す)。
  const extra = plan.extraFields.filter(
    (field) => field !== ROW_KEY_FIELD && !own.some((column) => column.field === field),
  );
  const includes = [...new Set(plan.columns.flatMap((column) => (column.include === undefined ? [] : [column.include])))];
  return [
    `/** ${plan.exportName} が受ける行(読みの結果の型。値の型の正は生成 zod の行の型)。 */`,
    `export interface ${rowInterfaceName(plan)} {`,
    ...(keyed ? [`  readonly ${rowKeyOf(ROW_KEY_FIELD)}: ${rowTypeName(plan.source)}[${tsString(ROW_KEY_FIELD)}];`] : []),
    ...own.map(
      (column) => `  readonly ${rowKeyOf(column.field)}: ${rowTypeName(column.entity)}[${tsString(column.field)}];`,
    ),
    ...extra.map((field) => `  readonly ${rowKeyOf(field)}: ${rowTypeName(plan.source)}[${tsString(field)}];`),
    ...includes.flatMap((include) => {
      const fields = plan.columns.filter((column) => column.include === include);
      return [
        `  readonly ${rowKeyOf(include)}: {`,
        ...fields.map(
          (column) => `    readonly ${rowKeyOf(column.field)}: ${rowTypeName(include)}[${tsString(column.field)}];`,
        ),
        '  } | null;',
      ];
    }),
    '}',
  ];
}

/** 値を取り出す式(`row.title` / `row.venue?.name`)。 */
export function valueExpression(column: ReadColumn, row: string): string {
  if (column.include === undefined) return `${row}.${rowKeyOf(column.field)}`;
  return `${row}.${rowKeyOf(column.include)}?.${rowKeyOf(column.field)}`;
}

/** 値(null でないもの)の整形の式。`v` は整形する値の式。 */
function formatted(column: ReadColumn, v: string): string {
  switch (column.kind) {
    case 'datetime':
      return `formatDateTime(${v}, timeZone)`;
    case 'boolean':
      return `${v} ? YES : NO`;
    case 'enum':
      return `${toCamelCase(column.entity)}EnumLabels.${column.field}[${v}]`;
    case 'state': {
      const table = `${toCamelCase(column.machine ?? '')}StateLabels`;
      return column.machineComplete === true
        ? `${table}[${v}]`
        : `(${table} as Readonly<Record<string, string | undefined>>)[${v}] ?? ${v}`;
    }
    default:
      return v;
  }
}

/**
 * セルの値の式(JSX の `{…}` の中身)。値が無いときは `NONE`。
 *
 * @param column 列
 * @param row 行の変数名
 * @returns 式
 */
export function cellExpression(column: ReadColumn, row: string): string {
  const value = valueExpression(column, row);
  // 書式 url は部品が値無し(null / 併読が無い)も読むので、`when` を通さない。
  if (column.kind === 'url') return `<UrlLink value={${value}} />`;
  // 書式 markdown は文字列を HTML として載せる唯一の部品に渡す(値無しは値無しの表示)。
  if (column.kind === 'markdown') {
    return column.nullable ? `${value} ? <MarkdownView value={${value}} /> : NONE` : `<MarkdownView value={${value}} />`;
  }
  if (!column.nullable) return formatted(column, value);
  if (column.kind === 'text' || column.kind === 'number') return `${value} ?? NONE`;
  // `when` の整形は値を受ける関数にする(式の中に値の名前を出さない)。
  const fn = `(present) => ${formatted(column, 'present')}`;
  return `when(${value}, ${fn})`;
}

/**
 * 見出し・項目名の式(`{entity}FieldLabels.{欄}`。label が無い欄は欄の名前。併読の欄は役割を添えることがある)。
 *
 * @param column 列
 * @param source 読みの source のエンティティ(役割の欄の見出しを引く)
 * @returns 式
 */
export function labelExpression(column: ReadColumn, source: string): string {
  const own = column.labelled ? `${toCamelCase(column.entity)}FieldLabels.${column.field}` : tsString(column.field);
  if (column.roleField === undefined) return own;
  // 役割の名前を前に添える(`対応者の表示名`)。付けるかどうかは導出(`includeRoleField`)が決めて、ここは書くだけ。
  return `\`\${${toCamelCase(source)}FieldLabels.${column.roleField}}${HEADING_WORDING.roleOf()}\${${own}}\``;
}

/**
 * 状態の欄のセルに付ける `data-state` 属性(JSX の属性 1 つ。状態の欄でなければ空)。
 *
 * 文字(表示名)に加えて**状態の値そのもの**を属性で出す — 意味色(バッジの色)は器の CSS / `skin` が
 * `[data-state=…]` で当てる(層 (c))。生成物は属性だけを持ち、色を知らない。
 *
 * @param column 列
 * @param row 行の変数名
 * @returns 属性(例: `data-state={row.state}`)。状態の欄でなければ空配列
 */
export function stateAttribute(column: ReadColumn, row: string): readonly string[] {
  if (column.kind !== 'state') return [];
  const value = valueExpression(column, row);
  return [`data-state={${column.nullable ? `${value} ?? undefined` : value}}`];
}
