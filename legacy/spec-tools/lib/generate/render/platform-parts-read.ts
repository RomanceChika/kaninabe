/**
 * `kind: platform_read`(認証基盤の読みを表にし、行のボタンを持つ部品)の本体の字面(`code-platform-parts.ts` が呼ぶ)。
 *
 * **この表に業務の判断は 1 つも無い。** 列・見出し・整形は宣言した対応表から、行のボタンは宣言した `skip_if` から決まる。アプリの語彙は 1 語も持たない(W1)。
 */

import { docComment, tsString } from '../../gen-kit/code-emit.js';
import { TABLE_WORDING } from '../../messages/messages-screen.js';
import type { BodyModules } from '../body-modules.js';
import { actionsPropLines, importLines, operationLines } from './platform-parts-common.js';
import type { PlatformPartPlan } from './platform-parts-plan.js';
import { screenTestIdsName } from './screen-form-plan.js';
import { headerLines } from './screen-table-body.js';

/** `read`(表 + 行のボタン)。 */
export function readLines(part: PlatformPartPlan, spec: string, modules: BodyModules): string[] {
  const testIds = screenTestIdsName(part.screen);
  const shape = part.shape;
  const rowType = shape?.typeName ?? 'never';
  const keyProp = part.buttons.flatMap((button) => button.op.inputs.filter((input) => input.row).map((input) => part.shape?.fields.find((field) => field.field === input.source?.field)?.prop ?? '')).find((prop) => prop !== '');
  const hasButtons = part.buttons.length > 0;
  const label = part.label;
  return [
    "'use client';",
    '',
    ...headerLines(spec),
    '',
    ...importLines(part, modules),
    '',
    docComment(['部品の testid のキー(`testids.ts` のキーと同じ。`skin` のキーでもある)。']),
    `const KEY = ${tsString(part.path)} as const;`,
    '',
    docComment(['部品の testid(行・見出し・ボタン・拒否の表示はこれを接頭辞に持つ葉)。']),
    `const TESTID = ${testIds}[KEY];`,
    '',
    docComment(['行が 0 件のときの表示(既定の 1 形。部品の `label` から作る)。']),
    `const EMPTY_MESSAGE = ${tsString(label === undefined ? TABLE_WORDING.emptyBare() : `${label}${TABLE_WORDING.emptySuffix()}`)};`,
    '',
    docComment(['値が無いときの表示と、真偽値の表示(表と詳細で同じ語)。']),
    `const NONE = ${tsString(TABLE_WORDING.none())};`,
    `const YES = ${tsString(TABLE_WORDING.yes())};`,
    `const NO = ${tsString(TABLE_WORDING.no())};`,
    ...(hasButtons ? ['', docComment(['操作のボタンを並べる列の見出し。']), "const OPERATIONS_HEADER = '操作';"] : []),
    '',
    docComment([`${part.exportName} の props。`]),
    `export interface ${part.exportName}Props {`,
    `  /** 表に出す行(認証基盤の読みの結果。宣言した欄だけを持つ)。0 件なら空の表示になる。 */`,
    `  readonly rows: readonly ${rowType}[];`,
    ...(hasButtons ? actionsPropLines(part) : []),
    ...(part.usesDatetime ? ['  /** 日時の表示の基準タイムゾーン(IANA 名。器が設定から解決して渡す)。 */', '  readonly timeZone: string;'] : []),
    '  /** 器が `className` を差し替える口(渡さなければ既定のスタイル)。 */',
    `  readonly skin?: ScreenSkin<${tsString(part.screen)}> | undefined;`,
    '}',
    '',
    docComment([
      `認証基盤の読みの表(画面 ${part.screen} の部品 ${part.component}。読みの操作 ${part.read?.id ?? ''})。`,
      '',
      `仕様: ${spec}`,
      '',
      '**この表に業務の判断は 1 つも無い。** 列・見出し・整形は宣言した対応表から、行のボタンは宣言した `skip_if` から決まる。',
    ]),
    `export function ${part.exportName}({ rows, ${hasButtons ? 'actions, ' : ''}${part.usesDatetime ? 'timeZone, ' : ''}skin }: ${part.exportName}Props) {`,
    ...(hasButtons
      ? [
          `  const rowActions = usePlatformActions<${rowType}>({`,
          '    testId: TESTID,',
          `    rowKey: (row) => ${keyProp === undefined ? "''" : `row.${keyProp}`},`,
          '    operations: [',
          ...part.buttons.flatMap((button) => operationLines(part, button)),
          '    ],',
          '  });',
        ]
      : []),
    '  return (',
    '    <div data-testid={TESTID} className={skin?.[KEY] ?? styles.screenTableWrap}>',
    '      {rows.length === 0 ? (',
    '        <p data-testid={`${TESTID}.empty`} className={styles.screenTableEmpty}>',
    '          {EMPTY_MESSAGE}',
    '        </p>',
    '      ) : (',
    '        <table className={styles.screenTable}>',
    '          <thead>',
    '            <tr>',
    ...part.shows.map((field) => `              <th data-testid={\`\${TESTID}.column.${field.field}\`} className={styles.screenTableHead}>${tsLabel(field.label)}</th>`),
    ...(hasButtons ? ['              <th className={styles.screenTableHead}>{OPERATIONS_HEADER}</th>'] : []),
    '            </tr>',
    '          </thead>',
    '          <tbody>',
    `            {rows.map((${keyProp === undefined ? 'row, index' : 'row'}) => (`,
    `              <tr key={${keyProp === undefined ? 'index' : `row.${keyProp}`}} data-testid={\`\${TESTID}.row\`}${keyProp === undefined ? '' : ` data-row-id={row.${keyProp}}`}>`,
    ...part.shows.map((field) => `                <td className={styles.screenTableCell}>{${cellExpression(field)}}</td>`),
    ...(hasButtons ? ['                <td className={styles.screenTableCell}>', '                  <div className={styles.screenRowActions}>{rowActions.buttons(row)}</div>', '                </td>'] : []),
    '              </tr>',
    '            ))}',
    '          </tbody>',
    '        </table>',
    '      )}',
    ...(hasButtons ? ['      {rowActions.footer}'] : []),
    '    </div>',
    '  );',
    '}',
    '',
  ];
}

/** 見出しの JSX テキスト(`{`, `}`, `<`, `>` を含む文言は式で包む)。 */
function tsLabel(label: string): string {
  return /[{}<>]/u.test(label) ? `{${tsString(label)}}` : label;
}

/** セルの式(整形・null の有無・真偽値)。 */
function cellExpression(field: { readonly prop: string; readonly type: string; readonly nullable: boolean; readonly format: string }): string {
  const value = `row.${field.prop}`;
  if (field.format === 'datetime') return field.nullable ? `${value} === null ? NONE : formatDateTime(${value}, timeZone)` : `formatDateTime(${value}, timeZone)`;
  if (field.format === 'boolean') return field.nullable ? `${value} === null ? NONE : ${value} ? YES : NO` : `${value} ? YES : NO`;
  return field.nullable ? `${value} ?? NONE` : value;
}

