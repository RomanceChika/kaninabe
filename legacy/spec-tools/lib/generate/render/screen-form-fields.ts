/**
 * 画面の部品のフォーム(`kind: form`)の**欄まわりの字面**(初期値・送信前の写し・入力欄 1 つ)。
 *
 * 本体の字面(screen-form-body.ts)が呼ぶ部品で、欄まわりだけを持つ。ここもアプリの語彙を 1 語も持たない —
 * 出てくる名前はすべて引数(仕様からの導出)である。
 *
 * 作成と編集で `initial` の型が違う。
 *   - 作成: 器が決める**参照の欄**だけ(文字列。入力欄を出さない)と、選択欄の既定値。
 *   - 編集: **操作の入力と同じ型**(`Partial<Input>`)で、編集の対象の識別子といまの値を受ける。入力欄の文字列への
 *     写し(数値の文字列化・値が無い欄の空欄化・日時の表記・真偽値の目盛り)は**生成物がフォームの口
 *     (`FORM.toInputValue`)で行う** —— 器が文字列にすると、送信側(`parseField`)と食い違う写し方が
 *     器ごとに書かれる(日時では往復が壊れる)。
 */

import { tsString } from '../../gen-kit/code-emit.js';
import type { ScreenFormControl, ScreenFormPlan } from './screen-form-plan.js';
import { toCamelCase } from '../../gen-kit/code-emit.js';

/**
 * 器が渡す `initial` を読むか(参照・識別子の欄を持つ / 編集 / 選択欄の既定値)。
 * 読まないフォームは引数を持たない(使わない引数を生成物に残さない)。
 *
 * @param plan フォーム 1 つの生成の入力
 * @returns 読むなら true
 */
export function usesInitial(plan: ScreenFormPlan): boolean {
  return plan.supplied.length > 0 || plan.shape === 'update' || plan.controls.some((control) => control.kind === 'select');
}

/** 参照の欄の選択肢を作る関数の名前(`{camel(欄)}Choices`)。 */
export function refChoicesName(field: string): string {
  return `${toCamelCase(field)}Choices`;
}

/** 編集の欄 1 つの初期値の式(操作の入力の型のまま受けて、入力欄の文字列に写す)。 */
function updateStart(control: { readonly field: string; readonly kind: string }): string {
  const key = tsString(control.field);
  if (control.kind === 'checkbox') return `${key}: initial.${control.field} === true ? CHECKED : ''`;
  const current = `FORM.toInputValue(${key}, initial.${control.field})`;
  if (control.kind === 'select') return `${key}: ${current} || FORM.fields.${control.field}.options?.[0] || ''`;
  return `${key}: ${current}`;
}

/**
 * 初期値の関数。
 *
 * @param plan フォーム 1 つの生成の入力
 * @returns ソースの行
 */
export function renderStart(plan: ScreenFormPlan): readonly string[] {
  const update = plan.shape === 'update';
  const pairs = [
    ...plan.supplied.map((field) =>
      update ? `${tsString(field)}: initial.${field} ?? ''` : `${tsString(field)}: initial[${tsString(field)}] ?? ''`,
    ),
    ...plan.controls.map((control) => {
      if (update) return updateStart(control);
      const key = tsString(control.field);
      if (control.kind === 'select') {
        return `${key}: initial[${tsString(control.field)}] ?? FORM.fields.${control.field}.options?.[0] ?? ''`;
      }
      return `${key}: ''`;
    }),
  ];
  const param = update ? 'Readonly<Partial<Input>>' : 'Readonly<Record<string, string>>';
  return [
    usesInitial(plan)
      ? `function startValues(initial: ${param}): Record<string, string> {`
      : 'function startValues(): Record<string, string> {',
    `  return { ${pairs.join(', ')} };`,
    '}',
  ];
}

/**
 * 送信前の写し(欄の値 → 操作の入力)。
 *
 * @param plan フォーム 1 つの生成の入力
 * @returns ソースの行
 */
export function renderResolve(plan: ScreenFormPlan): readonly string[] {
  const update = plan.shape === 'update';
  const head = [
    '  /** 入力欄の値を操作の入力に写す(検証の正は生成 zod。送信前の検証は関門ではなく UX)。 */',
    '  function resolve(): { ok: true; value: Input } | { ok: false; issues: readonly FieldIssue[] } {',
  ];
  const tail = [
    '    if (!row.ok) return { ok: false, issues: row.error.issues };',
    '    const parsed = SCHEMA.safeParse(row.value);',
    '    if (!parsed.success) return { ok: false, issues: toFieldIssues(parsed.error) };',
    '    return { ok: true, value: parsed.data };',
    '  }',
  ];
  if (!update) return [...head, '    const row = collectRow(FORM, [...SUPPLIED, ...TEXT_FIELDS], FLAG_FIELDS, values);', ...tail];
  return [
    ...head,
    // 送るのは**実際に値が変わった欄だけ**(部分更新)。変更が無いとき・競合が残っているときはボタンが押せないので通常は来ない。
    '    if (changed.length === 0 || view.conflicts.length > 0) return { ok: false, issues: [] };',
    '    const row = collectRow(',
    '      FORM,',
    '      [...SUPPLIED, ...TEXT_FIELDS.filter((field) => changed.includes(field))],',
    '      FLAG_FIELDS.filter((field) => changed.includes(field)),',
    '      values,',
    '    );',
    ...tail,
  ];
}

/**
 * 入力欄 1 つ(編集では `writable` に入っているものだけ出す)。
 *
 * @param plan フォーム 1 つの生成の入力
 * @param control 欄の名前と入力の種類(参照の欄は選択肢の読みを持つ)
 * @param update 編集のフォームか
 * @returns ソースの行
 */
export function renderRow(plan: ScreenFormPlan, control: ScreenFormControl, update: boolean): readonly string[] {
  const field = tsString(control.field);
  const entityCamel = toCamelCase(plan.entity);
  const label = `${entityCamel}FieldLabels.${control.field}`;
  const row = [
    '<FormRow',
    `  testId={\`\${TESTID}.${control.field}\`}`,
    `  label={${label}}`,
    `  kind=${tsString(control.kind)}`,
    `  attributes={FORM.fields.${control.field}}`,
    ...(control.kind === 'select' && control.ref === undefined
      ? [`  optionLabels={${entityCamel}EnumLabels.${control.field}}`]
      : []),
    ...(control.kind === 'checkbox'
      ? []
      : [control.ref === undefined ? `  choices={choices?.[${field}]}` : `  choices={${refChoicesName(control.field)}(options, emptyOptionLabel?.[${field}])}`]),
    `  value={values[${field}] ?? ''}`,
    // 編集では、最新を取り込んだ入力(`view`)を土台に積む(`edit`)。作成は入力欄の値だけを持つ。
    update ? `  onChange={(next) => edit(${field}, next)}` : `  onChange={(next) => setValues({ ...values, [${field}]: next })}`,
    '/>',
  ];
  if (!update) return row.map((line) => `            ${line}`);
  return [
    `            {shown(${field}) ? (`,
    '              <>',
    ...row.map((line) => `                ${line}`),
    `                {conflictView(${field}, phase === 'pending')}`,
    '              </>',
    '            ) : null}',
  ];
}
