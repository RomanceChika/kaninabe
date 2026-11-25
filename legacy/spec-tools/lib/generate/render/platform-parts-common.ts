/**
 * 認証基盤の操作の画面の部品(`code-platform-parts.ts`)が共有する字面(import・ボタンのフックの設定・`actions` の props)。
 *
 * 部品の形ごとの本体は `platform-parts-read.ts`(表 + 行のボタン)と `platform-parts-bar.ts`(ボタン列・表の行の提供者)。
 * アプリの語彙は 1 語も持たない(W1)。
 */

import { tsString } from '../../gen-kit/code-emit.js';
import type { BodyModules } from '../body-modules.js';
import { PLATFORM_OPS_MODULE } from './code-platform-ops-app.js';
import type { PlatformPartButton, PlatformPartPlan } from './platform-parts-plan.js';
import { RUNTIME_DATETIME_MODULE, RUNTIME_PLATFORM_OP_MODULE } from './runtime-modules.js';
import { screenLabelsName, screenTestIdsName } from './screen-form-plan.js';

/** ボタン 1 つのフックの設定(`operations` の 1 要素)。 */
export function operationLines(part: PlatformPartPlan, button: PlatformPartButton): string[] {
  const testIds = screenTestIdsName(part.screen);
  const labels = screenLabelsName(part.screen);
  const id = tsString(button.op.id);
  const input = button.inputEntries.length === 0 ? '{}' : `{ ${button.inputEntries.join(', ')} }`;
  const confirm = button.confirm;
  return [
    '      {',
    `        op: ${id},`,
    `        leaf: ${tsString(button.leaf)},`,
    `        label: platformOpLabels[${id}],`,
    ...(button.skipProp === undefined ? [] : [`        available: (row) => !row.${button.skipProp},`]),
    `        run: (${part.kind === 'bar' ? '' : 'row'}) => actions[${id}](${input}),`,
    ...(confirm === undefined
      ? []
      : [
          '        confirm: {',
          `          dialogTestId: ${testIds}[${tsString(confirm.dialogKey)}],`,
          `          confirmBarTestId: ${testIds}[${tsString(confirm.barKey)}],`,
          `          label: ${confirm.labelKey === undefined ? `platformOpLabels[${id}]` : `${labels}[${tsString(confirm.labelKey)}]`},`,
          '        },',
        ]),
    `        messages: platformOpRefusals[${id}],`,
    '      },',
  ];
}

/** import の行(部品の形ごと)。 */
export function importLines(part: PlatformPartPlan, modules: BodyModules): string[] {
  const generated = modules.generated(PLATFORM_OPS_MODULE);
  const labels = screenLabelsName(part.screen);
  const usesLabels = part.buttons.some((button) => button.confirm?.labelKey !== undefined);
  const inputTypes = part.buttons.map((button) => `${button.op.pascal}Input`);
  const rowType = part.shape === undefined ? [] : [part.shape.typeName];
  return [
    ...(part.kind === 'rows' ? ["import { createContext, useContext } from 'react';", "import type { ReactNode } from 'react';"] : []),
    ...(part.usesDatetime ? [`import { formatDateTime } from '${RUNTIME_DATETIME_MODULE}';`] : []),
    `import type { PlatformOpResult } from '${RUNTIME_PLATFORM_OP_MODULE}';`,
    ...(part.buttons.length === 0 ? [] : [`import { usePlatformActions } from '${modules.component('platform-actions')}';`]),
    ...(part.kind === 'rows' ? [`import type { PlatformActions } from '${modules.component('platform-actions')}';`] : []),
    ...(part.kind === 'rows' ? [] : [`import type { ScreenSkin } from '${modules.generated('screens')}';`]),
    `import { ${usesLabels ? `${labels}, ` : ''}${screenTestIdsName(part.screen)} } from '${modules.generated('testids')}';`,
    ...(part.buttons.length === 0 ? [] : [`import { platformOpLabels, platformOpRefusals } from '${generated}';`]),
    ...(inputTypes.length + rowType.length === 0 ? [] : [`import type { ${[...rowType, ...inputTypes].sort().join(', ')} } from '${generated}';`]),
    ...(part.kind === 'rows' ? [] : ["import styles from './default.module.css';"]),
  ];
}

/** `actions` の props(操作 → Server Action)。 */
export function actionsPropLines(part: PlatformPartPlan): string[] {
  return [
    '  /** 操作ごとの Server Action(生成物。器が渡す — 画面の部品の生成物は `_actions` を import しない)。鍵は操作 ID。 */',
    '  readonly actions: {',
    ...part.buttons.map((button) => `    readonly ${tsString(button.op.id)}: (input: ${button.op.pascal}Input) => Promise<PlatformOpResult<${button.op.outputType}>>;`),
    '  };',
  ];
}

