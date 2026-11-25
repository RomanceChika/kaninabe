/**
 * 1 画面フォーム(code-usecase-form.ts)の**本体の字面**。
 *
 * 状態・送信前の写し・入力欄の字面は usecase-form-fields.ts が持つ。
 * ここもアプリの語彙を 1 語も持たない —— 出てくる名前はすべて引数(仕様からの導出)である。
 */

import type { BuiltSave } from '../../usecase/plan-build.js';
import { docComment, toCamelCase, tsString } from '../../gen-kit/code-emit.js';
import { renderResolve, renderState, renderStepFields } from './usecase-form-fields.js';
import { fieldsComponentName, schemaName, slug } from './usecase-form-names.js';
import { formExportName, saveBase, savePascal } from './usecase-app-names.js';
import { FORM_WORDING } from '../../messages/messages-screen.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import { RUNTIME_FORM_MODULE, RUNTIME_RESULT_MODULE } from './runtime-modules.js';
import type { BodyModules } from '../body-modules.js';

/** 入力欄の見た目の種類(値域)。 */
export type FormControlKind = 'text' | 'multiline' | 'checkbox' | 'select';

/** 手順 1 つぶんの欄の割り当て。 */
export interface FormStep {
  /** 入力の鍵(usecase_spec の `as`。書かなければ操作 ID)。識別子・testid の断片にもなる。 */
  readonly alias: string;
  /** 節の見出し(usecase_spec の `label`。書かなければ操作の label)。 */
  readonly label: string;
  readonly op: string;
  readonly entity: string;
  readonly repeat: boolean;
  /** 入力欄を出す欄。 */
  readonly controls: readonly { readonly field: string; readonly kind: FormControlKind }[];
  /** 入力欄を出さず、画面が `initial` で渡す欄(参照・識別子)。 */
  readonly supplied: readonly string[];
  /** 選択欄(`enum`)を持つか。持つなら enum の値の表示名の表(`{entity}.labels.ts`)を引く。 */
  readonly hasEnumLabels: boolean;
}

/** 画面が `initial` で渡す欄の全部(手順をまたいで重複なし・名前順。送信の意図を名指す欄)。 */
function suppliedOf(steps: readonly FormStep[]): readonly string[] {
  return [...new Set(steps.flatMap((step) => step.supplied))].sort((a, b) => a.localeCompare(b));
}

/** その手順を人が読む形で示す(コメント用。別名を書いた手順だけ別名を添える)。 */
function stepTitle(step: FormStep): string {
  return step.alias === step.op ? step.op : `${step.op}(as ${step.alias})`;
}

/** 欄の表示名の表(`{entity}.labels.ts`)を引く集約(重複なし・名前順)。 */
function labelled(steps: readonly FormStep[]): readonly string[] {
  const entities = steps.map((step) => step.entity);
  return [...new Set(entities)].sort((a, b) => a.localeCompare(b));
}

/** enum の値の表示名の表(`{entity}.labels.ts`)を引く集約(重複なし・名前順)。 */
function withEnumLabels(steps: readonly FormStep[]): readonly string[] {
  const entities = steps.filter((step) => step.hasEnumLabels).map((step) => step.entity);
  return [...new Set(entities)].sort((a, b) => a.localeCompare(b));
}

/** その欄の表示名の式。 */
function labelExpression(step: FormStep, field: string): string {
  return `{${toCamelCase(step.entity)}FieldLabels.${field}}`;
}

/** その手順の欄の名前の配列リテラル(真偽値かどうかで分ける)。 */
function fieldList(step: FormStep, flags: boolean): string {
  const fields = flags
    ? step.controls.filter((control) => control.kind === 'checkbox').map((control) => control.field)
    : [...step.supplied, ...step.controls.filter((control) => control.kind !== 'checkbox').map((control) => control.field)];
  return `[${fields.map((field) => tsString(field)).join(', ')}]`;
}

/**
 * フォーム 1 枚の本体(import から export まで)。
 *
 * @param save 組み立て済みの保存点
 * @param steps 手順ごとの欄の割り当て
 * @param roots 製品の根
 * @param modules 本文が import する先の解決(置き場の配置が決める)
 * @returns ソースの行
 */
export function renderFormBody(
  save: BuiltSave,
  steps: readonly FormStep[],
  roots: ProductRoots,
  modules: BodyModules,
): readonly string[] {
  const base = saveBase(save);
  const hasControls = steps.some((step) => step.controls.length > 0);
  const hasState = steps.some((step) => step.repeat || step.controls.length > 0);
  // 欄を 1 つも持たない保存点(入力が空の操作だけ)では、手順ごとのスキーマも写しも出ない。
  const hasFields = steps.length > 0;
  return [
    ...(hasState ? ["import { useState } from 'react';"] : []),
    `import { ActionForm${suppliedOf(steps).length > 0 ? ', intentOfFields' : ''} } from '${modules.component('action-runner')}';`,
    `import type { InitialPhase } from '${modules.component('action-runner')}';`,
    // 欄を 1 つも持たない保存点(入力が空の操作だけの保存点)では、写しの口もスキーマの口も
    // 使わない —— 未使用の import を出さないために、ここで並べる行そのものを落とす。
    ...(hasControls ? [`import { FormRow, collectRow } from '${modules.component('form-row')}';`] : []),
    ...(!hasControls && hasFields ? [`import { collectRow } from '${modules.component('form-row')}';`] : []),
    hasFields ? `import { formOf, toFieldIssues } from '${RUNTIME_FORM_MODULE}';` : `import { toFieldIssues } from '${RUNTIME_FORM_MODULE}';`,
    ...labelled(steps).map(
      (entity) => `import { ${toCamelCase(entity)}FieldLabels } from '${modules.generated(`${entity}.labels`)}';`,
    ),
    ...withEnumLabels(steps).map(
      (entity) => `import { ${toCamelCase(entity)}EnumLabels } from '${modules.generated(`${entity}.labels`)}';`,
    ),
    hasFields
      ? `import { ${base}InputSchema, ${base}StepSchemas } from '${modules.generated('usecase-inputs')}';`
      : `import { ${base}InputSchema } from '${modules.generated('usecase-inputs')}';`,
    `import type { ${savePascal(save)}Input } from '${modules.generated('usecase-inputs')}';`,
    `import type { ActionResult, FieldIssue } from '${RUNTIME_RESULT_MODULE}';`,
    '',
    ...steps.flatMap((step) => [
      docComment([`手順 ${stepTitle(step)} の欄の制約(生成 zod からの導出)。`]),
      `const ${schemaName(step)} = formOf(${base}StepSchemas[${tsString(step.alias)}]);`,
      '',
      docComment([`手順 ${stepTitle(step)} の欄のうち、フォームの口に通すもの(真偽値以外)。`]),
      `const ${slug(step.alias).toUpperCase()}_SCALARS = ${fieldList(step, false)} as const;`,
      '',
      docComment([`手順 ${stepTitle(step)} の欄のうち、チェックボックスのもの。`]),
      `const ${slug(step.alias).toUpperCase()}_FLAGS = ${fieldList(step, true)} as const;`,
      '',
    ]),
    docComment(['入力欄の表示名(拒否の表示に使う。`{entity}FieldLabels` の和)。']),
    `const FIELD_LABELS = { ${labelled(steps).map((entity) => `...${toCamelCase(entity)}FieldLabels`).join(', ')} };`,
    '',
    docComment([`${formExportName(save)} の props。`]),
    `export interface ${formExportName(save)}Props {`,
    '  /** 呼び出す Server Action(生成物)。 */',
    `  readonly action: (input: ${savePascal(save)}Input) => Promise<ActionResult<unknown>>;`,
    '  /** 画面が決める値(参照の欄)。鍵は欄の名前。 */',
    '  readonly initial: Readonly<Record<string, string>>;',
    '  /** この部品の testid(画面が宣言した部品のもの)。 */',
    '  readonly testId: string;',
    '  /** 成功したときの追加の副作用(遷移はここで書かない)。 */',
    '  readonly onSuccess?: (() => void) | undefined;',
    '  /** **プレビュー専用**。本番の呼び側は渡さない。 */',
    '  readonly initialPhase?: InitialPhase | undefined;',
    '}',
    '',
    ...(hasControls ? [...STEP_FIELDS_PROPS, ''] : []),
    ...steps.flatMap((step) => (step.controls.length === 0 ? [] : [...renderStepComponent(step), ''])),
    ...renderComponent(save, steps, roots),
  ];
}

/** 手順ごとの入力欄の部品が受け取るもの(全手順で同じ形)。 */
const STEP_FIELDS_PROPS = [
  '/** 手順ごとの入力欄の部品が受け取るもの。 */',
  'interface StepFieldsProps {',
  '  /** この部品の testid(画面が宣言した部品のもの)。 */',
  '  readonly testId: string;',
  '  /** その手順の欄の現在値。 */',
  '  readonly values: Readonly<Record<string, string>>;',
  '  /** 欄の値が変わったときに呼ぶ。 */',
  '  readonly onChange: (field: string, value: string) => void;',
  '}',
];

/** 手順 1 つぶんの入力欄の部品(1 手順 1 関数にして、フォーム本体を小さく保つ)。 */
function renderStepComponent(step: FormStep): readonly string[] {
  return [
    docComment([`手順 ${stepTitle(step)} の入力欄。`, '', '@param props - 入力欄の props', '@returns 並んだ入力欄']),
    `function ${fieldsComponentName(step)}({ testId, values, onChange }: StepFieldsProps) {`,
    '  return (',
    '    <>',
    ...step.controls.flatMap((control) => [
      '      <FormRow',
      `        testId={\`\${testId}.${slug(step.alias)}.${control.field}\`}`,
      `        label=${labelExpression(step, control.field)}`,
      `        kind=${tsString(control.kind)}`,
      `        attributes={${schemaName(step)}.fields.${control.field}}`,
      ...(control.kind === 'select'
        ? [`        optionLabels={${toCamelCase(step.entity)}EnumLabels.${control.field}}`]
        : []),
      `        value={values[${tsString(control.field)}] ?? ''}`,
      `        onChange={(next) => onChange(${tsString(control.field)}, next)}`,
      '      />',
    ]),
    '    </>',
    '  );',
    '}',
  ];
}

/** フォームの本体(コンポーネント関数)。 */
function renderComponent(
  save: BuiltSave,
  steps: readonly FormStep[],
  roots: ProductRoots,
): readonly string[] {
  const name = formExportName(save);
  const event = `usecase.${save.usecase.name}.${save.plan.save.id}`;
  return [
    docComment([
      `${save.usecase.goal} —— 保存点「${save.plan.save.label}」を 1 枚で入力して 1 回で送る。`,
      '',
      `仕様: ${specPath(roots, 'frontend/usecases', save.usecase.relPath)}`,
      '',
      '**このフォームに業務の判断は 1 つも無い。** 並ぶ欄は保存点の手順の入力そのもので、',
      '制約は生成 zod から、表示名は生成の表から来る。可否の判断は operation の実行器が持つ。',
      '',
      '@param props - フォームの props',
      '@param props.action - 呼び出す Server Action',
      '@param props.initial - 画面が決める値(参照の欄)',
      '@param props.testId - この部品の testid',
      '@param props.onSuccess - 成功したときの追加の副作用',
      '@param props.initialPhase - プレビュー専用の初期状態',
      '@returns 保存点の入力欄と送信ボタン',
    ]),
    `export function ${name}({ action,${steps.some((step) => step.supplied.length > 0) ? ' initial,' : ''} testId, onSuccess, initialPhase }: ${name}Props) {`,
    ...steps.flatMap((step) => renderState(step)),
    '',
    ...renderResolve(save, steps),
    '',
    '  return (',
    '    <ActionForm',
    '      action={action}',
    `      event={${tsString(event)}}`,
    '      errorTestId={`${testId}.error`}',
    '      fieldLabels={FIELD_LABELS}',
    '      resolve={resolve}',
    // 送信の意図を名指すのは画面が `initial` で渡す欄だけ(点検 22 回目 B22-1。利用者が入れる欄を直した押し直しは同じ鍵)。
    ...(suppliedOf(steps).length > 0
      ? [`      intentOf={() => intentOfFields(initial, [${suppliedOf(steps).map(tsString).join(', ')}])}`]
      : []),
    '      onSuccess={() => onSuccess?.()}',
    '      {...(initialPhase === undefined ? {} : { initialPhase })}',
    '    >',
    '      {({ phase }) => (',
    '        <>',
    ...steps.flatMap((step) => renderStepFields(step)),
    "          <button data-testid={`${testId}.submit`} type=\"submit\" disabled={phase === 'pending'}>",
    `            {phase === 'pending' ? ${tsString(FORM_WORDING.pending())} : ${tsString(save.plan.save.label)}}`,
    '          </button>',
    '        </>',
    '      )}',
    '    </ActionForm>',
    '  );',
    '}',
    '',
  ];
}

// 状態・送信前の写し・入力欄の字面は usecase-form-fields.ts が持つ。
