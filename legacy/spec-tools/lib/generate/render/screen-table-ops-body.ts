/**
 * 操作を載せる表(`kind: table` の `edit` / `actions`)の**本体の字面**(code-screen-tables.ts が呼ぶ)。
 *
 * 読むだけの表(screen-table-body.ts)と同じ読み・同じ見出し・同じ空の表示に、次の 2 つが乗る。
 *   - `edit`: 列は編集してよい欄(器が `writable` で渡す)で、各セルが入力欄(`FormControl`)になる。行ごとに実行器を持ち、
 *     変わった欄だけを送る(フォームと同じ口 — `startValues` / `resolve` は screen-form-fields.ts を共有)。
 *   - `actions`: 行ごとのボタン。出るかは行の状態と実行者のロールの交差で決まり、実行・確認ダイアログ・拒否の表示は
 *     共有フック `useRowActions` が持つ(screen-row-buttons.ts)。
 *
 * **この表に業務の判断は 1 つも無い。** 出てくる名前はすべて仕様からの導出(引数)で、日本語の既定の語は `lib/messages` を引く。
 * 器(手書き)は行・Server Action・`writable`・(遷移があれば)実行者のロールを渡して置くだけである。
 *
 * testid: `{部品}`(外側)/ `.row` / `.column.{欄}`(見出し)/ `.empty` / `.{欄}`(入力欄)/ `.save` / `.row_error` /
 * `.{イベント | delete}`(ボタン)/ `.error`(ボタンの拒否)。
 */

import { BUTTON_WORDING, TABLE_WORDING } from '../../messages/messages-screen.js';
import { docComment, toCamelCase, tsString } from '../../gen-kit/code-emit.js';
import { RUNTIME_FORM_MODULE, RUNTIME_RESULT_MODULE } from './runtime-modules.js';
import { draftImportLines } from './screen-draft.js';
import { screenLabelsName, screenTestIdsName } from './screen-form-plan.js';
import type { ScreenFormPlan } from './screen-form-plan.js';
import { renderEditRow } from './screen-table-edit-row.js';
import { cellLines, headerLines } from './screen-table-body.js';
import {
  actionsPropLines,
  buttonImportLines,
  buttonWordingLines,
  confirmNotesParam,
  confirmNotesPropLines,
  inputImportLines,
  inputTypeLines,
  needsRole,
  runnerImportLines,
  useRowActionsLines,
  usesOverlayLabels,
} from './screen-row-buttons.js';
import {
  labelExpression,
  readImportLines,
  rowInterfaceLines,
  rowInterfaceName,
  usesTimeZone,
  usesWhen,
  whenLines,
  wordingConstLines,
} from './screen-read-cells.js';
import { COLUMN_LEAF, EMPTY_LEAF, ROW_LEAF } from './screen-read-plan.js';
import type { ScreenReadPlan } from './screen-read-plan.js';
import { hasRowLink, ROW_EXTRA_HEADER_LINES, rowExtraCellLine, rowExtrasPropLines, rowHrefLines, rowLinkConstLines, rowLinkImportLines } from './screen-row-slots.js';
import type { BodyModules } from '../body-modules.js';

/** 編集する表の行を、フォームの欄まわりの字面(`startValues` / `resolve`)に渡すための計画(確認は持たない)。 */
export function editFormPlan(plan: ScreenReadPlan): ScreenFormPlan {
  const edit = plan.edit;
  return {
    screen: plan.screen,
    component: plan.component,
    path: plan.path,
    action: edit?.action ?? '',
    shape: 'update',
    entity: edit?.entity ?? plan.source,
    controls: edit?.controls ?? [],
    supplied: edit?.supplied ?? [],
    hasEnumLabels: edit?.hasEnumLabels ?? false,
    confirmRequired: false,
    file: plan.file,
    exportName: plan.exportName,
  };
}

/** 文字列の配列リテラル(`as const`)。 */
function tuple(items: readonly string[]): string {
  return `[${items.map((item) => tsString(item)).join(', ')}] as const`;
}

/**
 * 操作を載せる表の生成物 1 本(ファイル全体の行)。
 *
 * @param plan 表 1 つの生成の入力(`edit` か `buttons` を持つ)
 * @param screenSpecFile 正となる画面仕様のパス(ヘッダの出どころ)
 * @param modules 本文が import する先の解決(置き場の配置が決める)
 * @returns ソースの行
 */
export function renderScreenTableOpsBody(plan: ScreenReadPlan, screenSpecFile: string, modules: BodyModules): readonly string[] {
  const testIds = screenTestIdsName(plan.screen);
  const labels = screenLabelsName(plan.screen);
  const name = plan.exportName;
  const row = rowInterfaceName(plan);
  const edit = plan.edit;
  const buttons = plan.buttons;
  // 編集する表の行は入力欄の行で、行のリンクを持たない(リンクが要るなら読むだけの表・ボタンだけの表にする)。
  const { rowNav: _nav, rowNavTarget: _target, ...withoutLink } = plan;
  const linkPlan: ScreenReadPlan = edit === undefined ? plan : withoutLink;
  const linked = hasRowLink(linkPlan);
  const form = editFormPlan(plan);
  const entityCamel = toCamelCase(form.entity);
  const timeZone = usesTimeZone(plan);
  const usesLabels = plan.label !== undefined || usesOverlayLabels(plan);
  const first = plan.columns[0]?.path;
  return [
    // フックを呼ぶ生成物(行のボタンの共有フック・編集する行の実行器)は client component。
    "'use client';",
    '',
    ...headerLines(screenSpecFile),
    '',
    ...(edit === undefined ? [] : ["import { useState } from 'react';"]),
    "import type { ReactNode } from 'react';",
    ...rowLinkImportLines(linkPlan, modules),
    ...(edit === undefined ? [] : [`import { ActionErrorView } from '${modules.component('action-error-view')}';`]),
    ...runnerImportLines(plan, edit === undefined ? [] : ['useActionRunner'], modules),
    ...(edit === undefined
      ? []
      : [
          `import { ${edit.controls.some((control) => control.kind === 'checkbox') ? 'CHECKED, ' : ''}FormControl, collectRow } from '${modules.component('form-row')}';`,
          `import type { FormChoice } from '${modules.component('form-row')}';`,
          `import { changedFields, formOf, toFieldIssues } from '${RUNTIME_FORM_MODULE}';`,
          ...draftImportLines(),
          `import { ${entityCamel}FieldLabels${edit.hasEnumLabels ? `, ${entityCamel}EnumLabels` : ''} } from '${modules.generated(`${form.entity}.labels`)}';`,
        ]),
    ...buttonImportLines(plan, modules),
    ...inputImportLines(plan, modules),
    ...readImportLines(plan, modules),
    `import type { ScreenSkin } from '${modules.generated('screens')}';`,
    `import { ${usesLabels ? `${labels}, ` : ''}${testIds} } from '${modules.generated('testids')}';`,
    ...(edit === undefined
      ? [`import type { ActionResult } from '${RUNTIME_RESULT_MODULE}';`]
      : [`import type { ActionResult, FieldIssue } from '${RUNTIME_RESULT_MODULE}';`]),
    ...(edit === undefined ? [] : [`import type { RowActions } from '${modules.component('action-runner')}';`]),
    "import styles from './default.module.css';",
    '',
    ...inputTypeLines(plan),
    docComment(['部品の testid のキー(`testids.ts` のキーと同じ。`skin` のキーでもある)。']),
    `const KEY = ${tsString(plan.path)} as const;`,
    '',
    docComment(['部品の testid(行・見出し・入力欄・ボタン・拒否の表示はこれを接頭辞に持つ葉)。']),
    `const TESTID = ${testIds}[KEY];`,
    '',
    ...rowLinkConstLines(linkPlan),
    docComment(['行が 0 件のときの表示(既定の 1 形。部品の `label` から作る)。']),
    plan.label === undefined
      ? `const EMPTY_MESSAGE = ${tsString(TABLE_WORDING.emptyBare())};`
      : `const EMPTY_MESSAGE = \`\${${labels}[KEY]}${TABLE_WORDING.emptySuffix()}\`;`,
    '',
    docComment(['操作のボタンを並べる列の見出し。']),
    `const OPERATIONS_HEADER = ${tsString(BUTTON_WORDING.header())};`,
    '',
    ...buttonWordingLines(plan),
    ...(edit === undefined
      ? []
      : [
          docComment(['行の保存ボタンの既定の文言。']),
          `const SAVE_LABEL = ${tsString(BUTTON_WORDING.update())};`,
          '',
          docComment(['編集の操作の入力スキーマ(生成 zod)と、入力欄の制約。']),
          `const SCHEMA = operationInputSchemas[${tsString(edit.action)}];`,
          'type Input = z.infer<typeof SCHEMA>;',
          'const FORM = formOf(SCHEMA);',
          '',
          docComment(['行から `initial` に写して送る欄(識別子・参照)。入力欄は出さない。']),
          `const SUPPLIED = ${tuple(edit.supplied)};`,
          '',
          docComment(['文字列・数値・選択で入力する欄(entity_spec の宣言の順)。']),
          `const TEXT_FIELDS = ${tuple(edit.controls.filter((control) => control.kind !== 'checkbox').map((control) => control.field))};`,
          '',
          docComment(['チェックボックスで入力する欄。']),
          `const FLAG_FIELDS = ${tuple(edit.controls.filter((control) => control.kind === 'checkbox').map((control) => control.field))};`,
          '',
        ]),
    ...wordingConstLines(plan),
    ...(usesWhen(plan) ? whenLines() : []),
    ...rowInterfaceLines(plan),
    '',
    docComment([`${name} の props(\`R\` は器が渡す行の型 — 生成物が使う欄より多く持っていてよい)。`]),
    `export interface ${name}Props<R extends ${row} = ${row}> {`,
    '  /** 表に出す行(読み取りの結果)。0 件なら空の表示になる。 */',
    '  readonly rows: readonly R[];',
    ...actionsPropLines(plan),
    ...(edit === undefined
      ? []
      : [
          '  /** 編集してよい欄(`writableFields` の結果)。この欄だけが列になる(編集する表の列は仕様の `writes` で決まる)。 */',
          '  readonly writable: readonly string[];',
          '  /** 欄ごとの選択肢(器が決めて渡す。ある欄は選択欄として描く)。鍵は欄の名前。 */',
          '  readonly choices?: Readonly<Record<string, readonly FormChoice[]>> | undefined;',
        ]),
    ...(timeZone ? ['  /** 日時を表示するタイムゾーン(器が渡す。生成物は env を読まない)。 */', '  readonly timeZone: string;'] : []),
    ...confirmNotesPropLines(plan),
    '  /** 器が `className` を差し替える口(渡さなければ既定のスタイル)。 */',
    `  readonly skin?: ScreenSkin<${tsString(plan.screen)}> | undefined;`,
    ...rowExtrasPropLines(),
    '}',
    '',
    ...(edit === undefined ? [] : renderEditRow(plan, form, buttons !== undefined)),
    docComment([
      `操作を載せる表(画面 ${plan.screen} の部品 ${plan.component})。`,
      '',
      `仕様: ${screenSpecFile}`,
      '',
      '**この表に業務の判断は 1 つも無い。** 列・見出し・空の表示は仕様から、行のボタンは遷移表と実行者のロールの交差から決まる。',
      '',
      '@param props - 表の props',
    ]),
    `export function ${name}<R extends ${row}>({ rows, actions,${needsRole(plan) ? ' role,' : ''}${edit === undefined ? '' : ' writable, choices,'}${timeZone ? ' timeZone,' : ''}${confirmNotesParam(plan)} skin, rowExtras, rowExtraHeader }: ${name}Props<R>) {`,
    ...(buttons === undefined ? [] : useRowActionsLines(plan)),
    ...(edit === undefined ? [] : ['  const shown = (field: string): boolean => writable.includes(field);']),
    '  return (',
    '    <div data-testid={TESTID} className={skin?.[KEY] ?? styles.screenTableWrap}>',
    '      {rows.length === 0 ? (',
    `        <p data-testid={\`\${TESTID}.${EMPTY_LEAF}\`} className={styles.screenTableEmpty}>`,
    '          {EMPTY_MESSAGE}',
    '        </p>',
    '      ) : (',
    '        <table className={styles.screenTable}>',
    '          <thead>',
    '            <tr>',
    ...(edit === undefined ? readHeaders(plan) : editHeaders(plan)),
    // 操作の列は、保存のセル(編集する表)か行のボタン(`actions`)があるときに出る — どちらも見出しを持つ(列ずれを作らない)。
    '              <th className={styles.screenTableHead}>{OPERATIONS_HEADER}</th>',
    ...ROW_EXTRA_HEADER_LINES,
    '            </tr>',
    '          </thead>',
    '          <tbody>',
    ...(edit === undefined ? readRows(plan, first, linked, buttons !== undefined) : editRows(plan, buttons !== undefined)),
    '          </tbody>',
    '        </table>',
    '      )}',
    ...(buttons === undefined ? [] : ['      {rowActions.footer}']),
    '    </div>',
    '  );',
    '}',
    '',
  ];
}

/** 読むだけの列の見出し。 */
function readHeaders(plan: ScreenReadPlan): readonly string[] {
  return plan.columns.flatMap((column) => [
    `              <th data-testid={\`\${TESTID}.${COLUMN_LEAF}.${column.path}\`} className={styles.screenTableHead}>`,
    `                {${labelExpression(column, plan.source)}}`,
    '              </th>',
  ]);
}

/** 編集してよい欄の見出し(器が渡した `writable` に入っている欄だけ)。 */
function editHeaders(plan: ScreenReadPlan): readonly string[] {
  const entity = toCamelCase(plan.edit?.entity ?? plan.source);
  return (plan.edit?.controls ?? []).flatMap((control) => [
    `              {shown(${tsString(control.field)}) ? (`,
    `                <th data-testid={\`\${TESTID}.${COLUMN_LEAF}.${control.field}\`} className={styles.screenTableHead}>`,
    `                  {${entity}FieldLabels.${control.field}}`,
    '                </th>',
    '              ) : null}',
  ]);
}

/** 読むだけの列の行(ボタンの列つき)。 */
function readRows(plan: ScreenReadPlan, first: string | undefined, linked: boolean, buttons: boolean): readonly string[] {
  return [
    '            {rows.map((row) => {',
    ...(linked ? rowHrefLines(plan) : []),
    '              return (',
    // 行を同定する口(`data-row-id`。編集する行と同じ。実ブラウザの検査が、ボタンの属する行を ID で引く)。
    `                <tr key={row.id} data-testid={\`\${TESTID}.${ROW_LEAF}\`} data-row-id={row.id}>`,
    ...plan.columns.flatMap((column) => cellLines(column, column.path === first && linked)),
    ...(buttons
      ? [
          '                  <td className={styles.screenTableCell}>',
          '                    <div className={styles.screenRowActions}>{rowActions.buttons(row)}</div>',
          '                  </td>',
        ]
      : []),
    rowExtraCellLine('row'),
    '                </tr>',
    '              );',
    '            })}',
  ];
}

/** 編集する行(行ごとの実行器を持つ部品に渡す)。 */
function editRows(plan: ScreenReadPlan, buttons: boolean): readonly string[] {
  const name = `${plan.exportName}RowEditor`;
  const action = tsString(plan.edit?.action ?? '');
  return [
    '            {rows.map((row) => (',
    `              <${name}`,
    '                key={row.id}',
    '                item={row}',
    `                update={actions[${action}]}`,
    '                writable={writable}',
    '                choices={choices}',
    ...(buttons ? ['                rowActions={rowActions}'] : []),
    '                extra={rowExtras === undefined ? undefined : (rowExtras[row.id] ?? null)}',
    '              />',
    '            ))}',
  ];
}
