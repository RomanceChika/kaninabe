/**
 * 1 行に対する操作のボタン列(`kind: actions`)の**本体の字面**(code-screen-tables.ts が呼ぶ)。
 *
 * 表の行のボタンと同じ部品である(screen-row-buttons.ts): どの操作が出るかは行(`row`)の状態と実行者のロールの交差で決まり、
 * 実行・確認ダイアログ・拒否の表示は共有フック `useRowActions` が持つ。同じ読み(`returns: one`)を `kind: detail` と共有してよい。
 *
 * **このボタン列に業務の判断は 1 つも無い。** 器(手書き)は 1 行・Server Action・実行者のロールを渡して置くだけである。
 *
 * testid: `{部品}`(外側)/ `.{イベント | delete}`(ボタン)/ `.error`(ボタンの拒否)。アプリの語彙は 1 語も持たない(W1)。
 */

import { TABLE_WORDING } from '../../messages/messages-screen.js';
import { docComment, tsString } from '../../gen-kit/code-emit.js';
import { RUNTIME_RESULT_MODULE } from './runtime-modules.js';
import { screenLabelsName, screenTestIdsName } from './screen-form-plan.js';
import {
  actionsPropLines,
  buttonImportLines,
  buttonWordingLines,
  confirmableOperationIds,
  confirmNotesParam,
  confirmNotesPropLines,
  inputImportLines,
  inputTypeLines,
  needsRole,
  runnerImportLines,
  useRowActionsLines,
  usesOverlayLabels,
} from './screen-row-buttons.js';
import { readImportLines, rowInterfaceLines, rowInterfaceName } from './screen-read-cells.js';
import { EMPTY_LEAF } from './screen-read-plan.js';
import type { ScreenReadPlan } from './screen-read-plan.js';
import { headerLines } from './screen-table-body.js';
import type { BodyModules } from '../body-modules.js';

/**
 * ボタン列の生成物 1 本(ファイル全体の行)。
 *
 * @param plan ボタン列 1 つの生成の入力(`buttons` を持つ)
 * @param screenSpecFile 正となる画面仕様のパス(ヘッダの出どころ)
 * @param modules 本文が import する先の解決(置き場の配置が決める)
 * @returns ソースの行
 */
export function renderScreenActionsBody(plan: ScreenReadPlan, screenSpecFile: string, modules: BodyModules): readonly string[] {
  const testIds = screenTestIdsName(plan.screen);
  const labels = screenLabelsName(plan.screen);
  const name = plan.exportName;
  const row = rowInterfaceName(plan);
  return [
    "'use client';",
    '',
    ...headerLines(screenSpecFile),
    '',
    ...(confirmableOperationIds(plan).length === 0 ? [] : ["import type { ReactNode } from 'react';"]),
    ...runnerImportLines(plan, [], modules),
    ...buttonImportLines(plan, modules),
    ...inputImportLines(plan, modules),
    ...readImportLines(plan, modules),
    `import type { ScreenSkin } from '${modules.generated('screens')}';`,
    `import { ${usesOverlayLabels(plan) ? `${labels}, ` : ''}${testIds} } from '${modules.generated('testids')}';`,
    `import type { ActionResult } from '${RUNTIME_RESULT_MODULE}';`,
    "import styles from './default.module.css';",
    '',
    ...inputTypeLines(plan),
    docComment(['部品の testid のキー(`testids.ts` のキーと同じ。`skin` のキーでもある)。']),
    `const KEY = ${tsString(plan.path)} as const;`,
    '',
    docComment(['部品の testid(ボタン・拒否の表示・出せる操作が無いときの案内はこれを接頭辞に持つ葉)。']),
    `const TESTID = ${testIds}[KEY];`,
    '',
    docComment(['出せる操作が 1 つも無いときの表示(行の状態と実行者のロールの交差が空 — 既定の 1 形)。']),
    `const EMPTY_MESSAGE = ${tsString(TABLE_WORDING.emptyActions())};`,
    '',
    ...buttonWordingLines(plan),
    ...rowInterfaceLines(plan),
    '',
    docComment([`${name} の props(\`R\` は器が渡す行の型 — 生成物が使う欄より多く持っていてよい)。`]),
    `export interface ${name}Props<R extends ${row} = ${row}> {`,
    '  /** ボタンの対象の 1 行(読みの結果。状態の欄でどの操作が出るかが決まる)。 */',
    '  readonly row: R;',
    ...actionsPropLines(plan),
    ...confirmNotesPropLines(plan),
    '  /** 器が `className` を差し替える口(渡さなければ既定のスタイル)。 */',
    `  readonly skin?: ScreenSkin<${tsString(plan.screen)}> | undefined;`,
    '}',
    '',
    docComment([
      `1 行に対する操作のボタン列(画面 ${plan.screen} の部品 ${plan.component})。`,
      '',
      `仕様: ${screenSpecFile}`,
      '',
      '**このボタン列に業務の判断は 1 つも無い。** どの操作が出るかは行の状態と実行者のロールの交差で、確認の器は仕様の重ね表示である。',
      '',
      '@param props - ボタン列の props',
      '@returns 押せる操作のボタンと、確認ダイアログ・拒否の表示(押せる操作が 1 つも無いときは案内)',
    ]),
    `export function ${name}<R extends ${row}>({ row, actions,${needsRole(plan) ? ' role,' : ''}${confirmNotesParam(plan)} skin }: ${name}Props<R>) {`,
    ...useRowActionsLines(plan),
    '  return (',
    '    <div data-testid={TESTID} className={skin?.[KEY] ?? styles.screenActions}>',
    '      {rowActions.visibleCount(row) === 0 ? (',
    `        <p data-testid={\`\${TESTID}.${EMPTY_LEAF}\`} className={styles.screenActionsEmpty}>`,
    '          {EMPTY_MESSAGE}',
    '        </p>',
    '      ) : (',
    '        <div className={styles.screenRowActions}>{rowActions.buttons(row)}</div>',
    '      )}',
    '      {rowActions.footer}',
    '    </div>',
    '  );',
    '}',
    '',
  ];
}
