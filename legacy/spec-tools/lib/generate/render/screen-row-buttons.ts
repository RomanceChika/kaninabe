/**
 * 操作を載せる表・ボタン列(`kind: table` の `edit` / `actions`・`kind: actions`)の生成物が共有する**字面**
 * (import・入力の型・`actions` の props・行のボタンの配列)。
 *
 * 行のボタンの実行・確認ダイアログ・拒否の表示は共有フック `useRowActions`(`components/action-runner`)が持つ。
 * 生成物は**どの操作が出るか**(遷移は状態機械の表と実行者のロールの交差・削除は常に)と、確認の器(重ね表示の
 * testid と見出し)だけを渡す。**この字面に業務の判断は 1 つも無い** — 出てくる名前はすべて引数(仕様からの導出)で、
 * 日本語の既定の語は `lib/messages` の `BUTTON_WORDING` を引く。アプリの語彙は 1 語も持たない(W1)。
 */

import { BUTTON_WORDING } from '../../messages/messages-screen.js';
import { docComment, toCamelCase, tsString } from '../../gen-kit/code-emit.js';
import { rowKeyOf } from './screen-read-plan.js';
import type { ScreenReadPlan } from './screen-read-plan.js';
import { screenLabelsName, screenTestIdsName } from './screen-form-plan.js';
import type { ButtonOperation } from './screen-operation-plan.js';
import type { BodyModules } from '../body-modules.js';

/** ボタンの操作の一覧(無ければ空)。 */
function buttonsOf(plan: ScreenReadPlan): readonly ButtonOperation[] {
  return plan.buttons?.operations ?? [];
}

/** 操作(編集 + ボタン)の ID の一覧(`actions` の props の鍵。編集が先)。 */
export function operationIds(plan: ScreenReadPlan): readonly string[] {
  return [...(plan.edit === undefined ? [] : [plan.edit.action]), ...buttonsOf(plan).map((operation) => operation.op)];
}

/** 実行者のロールを器から受けるか(遷移のボタンがあるとき)。 */
export function needsRole(plan: ScreenReadPlan): boolean {
  return plan.buttons?.needsRole === true;
}

/** 確認の器(重ね表示)を持つ操作の ID(確認ダイアログの本文に注記を添えられる操作。宣言順)。 */
export function confirmableOperationIds(plan: ScreenReadPlan): readonly string[] {
  return buttonsOf(plan).flatMap((operation) => (operation.overlay === undefined ? [] : [operation.op]));
}

/**
 * 確認ダイアログの本文に添える注記の props(`confirmNotes`)の interface のメンバーの行。確認の器を持つ操作が無ければ空。
 *
 * 鍵は確認の器を持つ操作の ID・値は器が描いた node(関数ではなく node で受けるのは、生成物が `'use client'` でも
 * server の器から渡せるため — `rowExtras` と同じ形)。製品固有の注記(例: 終了の確認に残りの件数)を、生成の確認文に
 * 語彙を足さずに差し込む口である。
 *
 * @param plan 生成の入力
 * @returns interface のメンバーの行
 */
export function confirmNotesPropLines(plan: ScreenReadPlan): readonly string[] {
  const ids = confirmableOperationIds(plan);
  if (ids.length === 0) return [];
  return [
    '  /** 確認ダイアログの本文に添える製品固有の注記(層 (c))。鍵は確認の器を持つ操作 ID・値は器が描いた node。 */',
    `  readonly confirmNotes?: Readonly<Partial<Record<${ids.map((id) => tsString(id)).join(' | ')}, ReactNode>>> | undefined;`,
  ];
}

/** 分割代入に足す `confirmNotes`(確認の器を持つ操作があるときだけ。前に空白を付ける)。 */
export function confirmNotesParam(plan: ScreenReadPlan): string {
  return confirmableOperationIds(plan).length === 0 ? '' : ' confirmNotes,';
}

/** 確認の見出しを `{画面}Labels` から引くか(重ね表示の `label` があるボタンがあるか)。 */
export function usesOverlayLabels(plan: ScreenReadPlan): boolean {
  return buttonsOf(plan).some((operation) => operation.overlay?.labelKey !== undefined);
}

/**
 * 実行器まわりの import の 1 行(同じモジュールから 2 行に割らない)。
 *
 * @param plan 生成の入力
 * @param extra 表側が足す名前(編集する行の `useActionRunner` など)
 * @param modules 本文が import する先の解決(置き場の配置が決める)
 * @returns import 文(使う名前が無ければ空配列)
 */
export function runnerImportLines(plan: ScreenReadPlan, extra: readonly string[], modules: BodyModules): readonly string[] {
  const names = [...extra, ...(needsRole(plan) ? ['transitionAllows'] : []), ...(plan.buttons === undefined ? [] : ['useRowActions'])].sort();
  return names.length === 0 ? [] : [`import { ${names.join(', ')} } from '${modules.component('action-runner')}';`];
}

/**
 * ボタンの import の行(遷移表・イベントの表示名)。
 *
 * @param plan 生成の入力
 * @param modules 本文が import する先の解決(置き場の配置が決める)
 * @returns import 文の行
 */
export function buttonImportLines(plan: ScreenReadPlan, modules: BodyModules): readonly string[] {
  const operations = buttonsOf(plan);
  const machines = [...new Set(operations.flatMap((operation) => (operation.machine === undefined ? [] : [operation.machine])))];
  const labelled = [
    ...new Set(operations.flatMap((operation) => (operation.machine !== undefined && operation.labelled === true ? [operation.machine] : []))),
  ];
  return [
    ...machines.map((machine) => `import { ${toCamelCase(machine)}Machine } from '${modules.generated(`${machine}.transitions`)}';`),
    ...labelled.map((machine) => `import { ${toCamelCase(machine)}EventLabels } from '${modules.generated(`${machine}.labels`)}';`),
  ];
}

/** ボタンの文言の式(遷移はイベントの表示名・削除は既定の語の定数)。 */
function labelExpression(operation: ButtonOperation): string {
  if (operation.kind === 'delete') return 'DELETE_LABEL';
  const machine = toCamelCase(operation.machine ?? '');
  return operation.labelled === true ? `${machine}EventLabels.${operation.event ?? ''}` : tsString(operation.event ?? '');
}

/**
 * 既定の語の定数(削除のボタンがあるときだけ)。
 *
 * @param plan 生成の入力
 * @returns 定数の宣言(doc コメント付き)の行
 */
export function buttonWordingLines(plan: ScreenReadPlan): readonly string[] {
  return buttonsOf(plan).some((operation) => operation.kind === 'delete')
    ? [docComment(['削除のボタンの既定の文言(重ね表示の `label` があれば確認の見出しはそちら)。']), `const DELETE_LABEL = ${tsString(BUTTON_WORDING.delete())};`, '']
    : [];
}

/** 生成 zod の入力の型を使うか(編集の操作か、実行計画で走るボタンがあるとき。`runner: manual` のボタンだけなら使わない)。 */
export function usesInputSchemas(plan: ScreenReadPlan): boolean {
  return plan.edit !== undefined || buttonsOf(plan).some((operation) => operation.typed);
}

/**
 * 入力の型の import(`z` と `operationInputSchemas`)。編集の操作は値として引く(`SCHEMA`)ので値の import・ボタンだけなら型の import。
 *
 * @param plan 生成の入力
 * @param modules 本文が import する先の解決(置き場の配置が決める)
 * @returns import 文の行(使わなければ空)
 */
export function inputImportLines(plan: ScreenReadPlan, modules: BodyModules): readonly string[] {
  if (!usesInputSchemas(plan)) return [];
  return [
    `import ${plan.edit === undefined ? 'type ' : ''}{ operationInputSchemas } from '${modules.generated('operation-inputs')}';`,
    "import type { z } from 'zod';",
  ];
}

/** 操作 1 つの入力の型の式(計画で走る操作は生成 zod から・`runner: manual` の操作は対象の識別子だけ)。 */
function inputTypeExpression(plan: ScreenReadPlan, id: string): string {
  const manual = buttonsOf(plan).some((operation) => operation.op === id && !operation.typed);
  return manual ? '{ readonly id: string }' : `z.infer<(typeof operationInputSchemas)[${tsString(id)}]>`;
}

/**
 * 載せる操作の入力の型(`Inputs`。生成 zod からの導出 — サーバー側の検証と同じもの。`runner: manual` の操作は識別子だけ)。
 *
 * @param plan 生成の入力
 * @returns 型の宣言の行(`z` と `operationInputSchemas` の import は `inputImportLines`)
 */
export function inputTypeLines(plan: ScreenReadPlan): readonly string[] {
  return [
    docComment(['載せる操作の入力(生成 zod。サーバー側の検証と同じもの。`runner: manual` の操作は対象の識別子だけ)。']),
    'interface Inputs {',
    ...operationIds(plan).map((id) => `  readonly ${tsString(id)}: ${inputTypeExpression(plan, id)};`),
    '}',
    '',
  ];
}

/**
 * props の `actions`(操作ごとの Server Action)と `role` の行。
 *
 * @param plan 生成の入力
 * @returns interface のメンバーの行
 */
export function actionsPropLines(plan: ScreenReadPlan): readonly string[] {
  return [
    '  /** 操作ごとの Server Action(生成物。器が渡す — 画面の部品の生成物は `_actions` を import しない)。鍵は操作 ID。 */',
    '  readonly actions: {',
    ...operationIds(plan).map((id) => `    readonly ${tsString(id)}: (input: Inputs[${tsString(id)}]) => Promise<ActionResult<unknown>>;`),
    '  };',
    ...(needsRole(plan)
      ? ['  /** 実行者のロール(遷移のボタンを出すかを、遷移の `by` との交差で決める。器が渡す)。 */', '  readonly role: string;']
      : []),
  ];
}

/**
 * `useRowActions` の呼び出し(行のボタンの配列。`R` は行の型・`actions` / `role` は props)。
 *
 * @param plan 生成の入力
 * @returns 文の行(`const rowActions = useRowActions<R>({ … });`)
 */
export function useRowActionsLines(plan: ScreenReadPlan): readonly string[] {
  const testIds = screenTestIdsName(plan.screen);
  const labels = screenLabelsName(plan.screen);
  const operations = buttonsOf(plan).flatMap((operation) => {
    const overlay = operation.overlay;
    const confirmLabel = overlay?.labelKey === undefined ? labelExpression(operation) : `${labels}[${tsString(overlay.labelKey)}]`;
    return [
      '      {',
      `        op: ${tsString(operation.op)},`,
      `        leaf: ${tsString(operation.leaf)},`,
      `        label: ${labelExpression(operation)},`,
      ...(operation.kind === 'transition'
        ? [
            `        available: (target) => transitionAllows(${toCamelCase(operation.machine ?? '')}Machine, ${tsString(operation.event ?? '')}, target.${rowKeyOf(operation.stateField ?? '')}, role),`,
          ]
        : []),
      `        run: (target) => actions[${tsString(operation.op)}]({ id: target.id }),`,
      ...(overlay === undefined
        ? []
        : [
            '        confirm: {',
            `          dialogTestId: ${testIds}[${tsString(overlay.dialog)}],`,
            `          confirmBarTestId: ${testIds}[${tsString(overlay.bar)}],`,
            `          label: ${confirmLabel},`,
            '        },',
          ]),
      '      },',
    ];
  });
  const subjectField = plan.buttons?.subjectField;
  return [
    '  const rowActions = useRowActions<R>({',
    '    testId: TESTID,',
    // 確認の本文に出す行の名前(集約の `display_field`)。client 側で行から引くので、器は関数を渡さない。
    ...(subjectField === undefined ? [] : [`    subject: (target) => target.${rowKeyOf(subjectField)},`]),
    ...(confirmableOperationIds(plan).length === 0 ? [] : ['    confirmNotes,']),
    '    operations: [',
    ...operations,
    '    ],',
    '  });',
  ];
}
