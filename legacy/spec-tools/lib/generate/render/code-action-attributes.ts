/**
 * action_spec → 操作の属性(`app/src/domain/generated/action-attributes.ts`)の生成器。
 *
 * 事実 9 属性と方針(confirm_required / variant)の導出そのものは action-attributes-derive.ts
 * が持つ(ハンドブック(book/actions-page.ts)と共有する 1 つの純粋関数)。ここは
 * 「全 action_spec を回して TS リテラルに固める」だけの薄い層である。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { generatedFile, docComment, generatedHeader, renderLiteral, type LiteralValue } from '../../gen-kit/code-emit.js';
import { deriveActionAttributes, type ActionAttributes } from './action-attributes-derive.js';
import { BASIS_NOTES } from '../../messages/messages.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'action-attributes.ts');

/** ActionAttributes を TS リテラルの材料(LiteralValue)へ写す。 */
function toLiteral(attrs: ActionAttributes): LiteralValue {
  return {
    irreversible: attrs.irreversible,
    terminal: attrs.terminal,
    destructive: attrs.destructive,
    affectsOthers: attrs.affectsOthers,
    outbound: attrs.outbound,
    bulk: attrs.bulk,
    scheduled: attrs.scheduled,
    privileged: attrs.privileged,
    touchesPersonal: attrs.touchesPersonal,
    negativeTone: attrs.negativeTone,
    settles: attrs.settles,
    confirmRequired: attrs.confirmRequired,
    variant: attrs.variant,
    overridden: attrs.overridden,
    confirmNotes: [...attrs.confirmNotes],
    basis: [...attrs.basis],
  };
}

const INTERFACE_BODY = [
  'export interface ActionAttributes {',
  '  readonly irreversible: boolean;',
  '  readonly terminal: boolean;',
  '  readonly destructive: boolean;',
  '  readonly affectsOthers: boolean;',
  '  readonly outbound: boolean;',
  '  readonly bulk: boolean;',
  '  readonly scheduled: boolean;',
  '  readonly privileged: boolean;',
  '  readonly touchesPersonal: boolean;',
  '  readonly negativeTone: boolean;',
  '  readonly settles: boolean;',
  '  readonly confirmRequired: boolean;',
  "  readonly variant: 'default' | 'danger';",
  '  readonly overridden: boolean;',
  '  readonly confirmNotes: readonly string[];',
  '  readonly basis: readonly string[];',
  '}',
].join('\n');

/** 操作が見つからないとき(未知の event ID)に返す、安全側の既定値。 */
const DEFAULT_ATTRIBUTES: LiteralValue = {
  irreversible: false,
  terminal: false,
  destructive: false,
  affectsOthers: false,
  outbound: false,
  bulk: false,
  scheduled: false,
  privileged: false,
  touchesPersonal: false,
  negativeTone: false,
  settles: false,
  confirmRequired: false,
  variant: 'default',
  overridden: false,
  confirmNotes: [],
  basis: [BASIS_NOTES.unknownOperation()],
};

/** ファイル全体を組み立てる。 */
function renderFile(model: SpecModel, ctx: GenerateContext, sourceFiles: readonly string[]): string {
  const actions = ctx.actions?.actions ?? [];
  const table: Record<string, LiteralValue> = {};
  for (const action of actions) {
    table[action.handles.raw] = toLiteral(deriveActionAttributes(model, ctx, action));
  }

  return [
    generatedHeader(sourceFiles),
    '',
    docComment([
      '操作(ドメインイベント ID)ごとの事実 9 属性 + 方針(confirm_required / variant)。',
      '正: action-spec-writing.md「方針の導出（confirm_required / variant）と ux（上書き）」。',
      '`ActionButton` はここから確認ダイアログの要否・見た目・文言を引く(呼び側は書けない)。',
    ]),
    INTERFACE_BODY,
    '',
    docComment(['操作 ID(`{machine}.{event}` / 予約 ID)→ 属性。action_spec の全数が母集合。']),
    `export const actionAttributes: Readonly<Record<string, ActionAttributes>> = ${renderLiteral(table, 0)};`,
    '',
    docComment([
      '未知の操作 ID を渡したときの安全側の既定値(確認なし・danger にしない)。',
      '生成対象(action_spec の handles)に無い ID を渡すのは呼び側の綴り違いのはずだが、',
      '実行時に例外で落とすより「確認を出さない」側に倒す(安全側 = 過剰な確認は誤操作を',
      '誘発しないが、確認漏れは誤操作を誘発しうる——この非対称は逆に倒すべきだが、',
      '綴り違いは verify の A1 が事前にエラーにするため実行時には現れない前提)。',
    ]),
    `const DEFAULT_ATTRIBUTES: ActionAttributes = ${renderLiteral(DEFAULT_ATTRIBUTES, 0)};`,
    '',
    docComment(['操作 ID から属性を引く。生成対象に無い ID には既定値を返す。']),
    'export function actionAttributesFor(event: string): ActionAttributes {',
    '  return actionAttributes[event] ?? DEFAULT_ATTRIBUTES;',
    '}',
    '',
  ].join('\n');
}

/**
 * action_spec から操作の属性を生成するジェネレーター。
 * 出力は `app/src/domain/generated/action-attributes.ts`(全体生成)。action_spec を
 * 読めていない環境(ctx.actions が無い)では空の表を出す(呼び側は既定値だけを引く)。
 */
export const actionAttributesGenerator: DocGenerator = {
  id: 'code-action-attributes',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    if (ctx.actions === undefined) return [];
    const entityFiles = [...model.aggregates.values()]
      .map((specs) => specs.entity)
      .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined)
      .map((entity) => entity.location.file);
    const stateFiles = [...model.aggregates.values()].flatMap((specs) =>
      specs.stateMachines.map((machine) => machine.location.file),
    );
    const accessFiles = [...model.aggregates.values()]
      .map((specs) => specs.access)
      .filter((access): access is NonNullable<typeof access> => access !== undefined)
      .map((access) => access.location.file);
    const actionFiles = ctx.actions.actions.map((action) => action.location.file);
    const dataTableFiles =
      ctx.dataTables?.available === true ? ctx.dataTables.tables.map((table) => table.location.file) : [];
    const jobFile = ctx.jobs?.available === true && ctx.jobs.catalog !== null ? [ctx.jobs.catalog.location.file] : [];
    const notificationFile =
      ctx.notifications?.available === true && ctx.notifications.catalog !== null
        ? [ctx.notifications.catalog.location.file]
        : [];
    const sourceFiles = [
      ...new Set([
        ...entityFiles,
        ...stateFiles,
        ...accessFiles,
        ...actionFiles,
        ...dataTableFiles,
        ...jobFile,
        ...notificationFile,
      ]),
    ].sort((a, b) => a.localeCompare(b));

    return [{ file: outputFile(ctx.roots), content: renderFile(model, ctx, sourceFiles), wholeFile: true }];
  },
};
