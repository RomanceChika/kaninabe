/**
 * 編集する表(`kind: table` の `edit`)の**行の部品**の字面(screen-table-ops-body.ts が呼ぶ)。
 *
 * 行は `<tr>` を返すので `<form>` を挟めない(`ActionForm` は使えない)。行ごとに実行器を持ち、入力欄の初期値・送信前の写し
 * (変わった欄だけを送る)はフォームと同じ字面(screen-form-fields.ts の `renderStart` / `renderResolve`)を共有する —
 * 入力欄の文字列への写しは生成物がフォームの口(`FORM.toInputValue`)で行い、器は行の値を操作の入力の型のまま渡す。
 *
 * **入力は 2 層**(`baseline` = 最後に受け入れた保存済みの値 / `values` = 入力欄の現在値)で持ち、`router.refresh()` で届く
 * 最新の行は `reconcileFormDraft` で毎レンダー取り込む(`@kaninabe/runtime/form-refresh`)。送る欄は最新の props との差ではなく
 * `baseline` との差で決める — 最新の props を「初期値」にすると、他の人の更新が届いたとき触っていない欄が「変更あり」になり、
 * 旧い値を再送して他の人の変更を上書きする。
 * アプリの語彙は 1 語も持たない(W1)。
 */

import { FORM_WORDING } from '../../messages/messages-screen.js';
import { docComment, toCamelCase, tsString } from '../../gen-kit/code-emit.js';
import { ACCEPT_SAVED_STATEMENT, renderDraftHandlers, renderDraftLines, renderDraftSupport } from './screen-draft.js';
import { renderResolve, renderStart } from './screen-form-fields.js';
import type { ScreenFormControl, ScreenFormPlan } from './screen-form-plan.js';
import { rowInterfaceName } from './screen-read-cells.js';
import { rowKeyOf } from './screen-read-plan.js';
import type { ScreenReadPlan } from './screen-read-plan.js';
import { ROW_ERROR_LEAF, SAVE_LEAF } from './screen-operation-plan.js';

/** 入力欄のセル 1 つ(編集してよい欄に入っているときだけ描く)。 */
function cellLines(control: ScreenFormControl, entityCamel: string, hasEnumLabels: boolean): readonly string[] {
  const field = tsString(control.field);
  const head = [`        {shown(${field}) ? (`, '          <td className={styles.screenTableCell}>'];
  const tail = ['          </td>', '        ) : null}'];
  if (control.kind === 'checkbox') {
    return [
      ...head,
      '            <input',
      `              data-testid={\`\${TESTID}.${control.field}\`}`,
      '              type="checkbox"',
      `              checked={values[${field}] === CHECKED}`,
      '              disabled={busy}',
      `              onChange={(event) => edit(${field}, event.target.checked ? CHECKED : '')}`,
      '            />',
      `            {conflictView(${field}, busy)}`,
      ...tail,
    ];
  }
  return [
    ...head,
    '            <FormControl',
    `              testId={\`\${TESTID}.${control.field}\`}`,
    `              kind=${tsString(control.kind)}`,
    `              attributes={FORM.fields.${control.field}}`,
    ...(control.kind === 'select' && hasEnumLabels ? [`              optionLabels={${entityCamel}EnumLabels.${control.field}}`] : []),
    `              choices={choices?.[${field}]}`,
    `              value={values[${field}] ?? ''}`,
    '              busy={busy}',
    `              onChange={(next) => edit(${field}, next)}`,
    '            />',
    `            {conflictView(${field}, busy)}`,
    ...tail,
  ];
}

/**
 * 編集する行の部品(`initialOf` / `startValues` / props / 行のコンポーネント)。
 *
 * @param plan 表の生成の入力(`edit` を持つ)
 * @param form 編集の操作を、フォームの欄まわりの字面に渡すための計画
 * @param hasButtons 行のボタン(`actions`)を持つか(持てば保存ボタンの隣に並べ、送信中は入力欄も止める)
 * @returns ソースの行
 */
export function renderEditRow(plan: ScreenReadPlan, form: ScreenFormPlan, hasButtons: boolean): readonly string[] {
  const row = rowInterfaceName(plan);
  const name = `${plan.exportName}RowEditor`;
  const entityCamel = toCamelCase(form.entity);
  const action = tsString(form.action);
  const initialPairs = [...form.supplied, ...form.controls.map((control) => control.field)].map(
    (field) => `${field}: item.${rowKeyOf(field)}`,
  );
  return [
    docComment(['行の値を、編集の操作の入力と同じ型の `initial` に写す(入力欄の文字列への写しは `startValues` が口で行う)。']),
    `function initialOf(item: ${row}): Readonly<Partial<Input>> {`,
    `  return { ${initialPairs.join(', ')} };`,
    '}',
    '',
    docComment(['入力欄の初期値(識別子・参照は行の値、選択欄は行の値か先頭の選択肢、それ以外は行の値の文字列)。']),
    ...renderStart(form),
    '',
    ...renderDraftSupport(),
    docComment([`${name} の props。`]),
    `interface ${name}Props<R extends ${row}> {`,
    '  readonly item: R;',
    `  readonly update: (input: Inputs[${action}]) => Promise<ActionResult<unknown>>;`,
    '  readonly writable: readonly string[];',
    '  readonly choices: Readonly<Record<string, readonly FormChoice[]>> | undefined;',
    ...(hasButtons ? ['  readonly rowActions: RowActions<R>;'] : []),
    '  /** 末尾の列に差し込む node(`undefined` ならその列は無い。`null` は空のセル)。 */',
    '  readonly extra: ReactNode | undefined;',
    '}',
    '',
    docComment([
      '編集する行(行ごとの実行器を持つ。変わった欄だけを送り、拒否は行の中に出す)。',
      '',
      '@param props - 行の props',
    ]),
    `function ${name}<R extends ${row}>({ item, update, writable, choices,${hasButtons ? ' rowActions,' : ''} extra }: ${name}Props<R>) {`,
    '  const shown = (field: string): boolean => writable.includes(field);',
    ...renderDraftLines('initialOf(item)'),
    // 成功のあとは `onSuccess` → `refresh()` の順(runner-core.ts)。送った値を保存済みの値として覚える(`sentValues` の doc)。
    '  const runner = useActionRunner(update, {',
    `    event: ${action},`,
    `    onSuccess: (_, sent) => ${ACCEPT_SAVED_STATEMENT},`,
    '  });',
    `  const busy = runner.phase === 'pending'${hasButtons ? ' || rowActions.pending' : ''};`,
    '',
    ...renderDraftHandlers(),
    '',
    ...renderResolve(form),
    '',
    '  /** 保存。送信前の検証を通らなければ Server Action を呼ばずに `invalid_input` を表示する。 */',
    '  function save(): void {',
    '    const resolution = resolve();',
    '    if (!resolution.ok) {',
    "      runner.reportError({ kind: 'invalid_input', issues: resolution.issues });",
    '      return;',
    '    }',
    '    void runner.run(resolution.value);',
    '  }',
    '',
    '  return (',
    // 行を同定する口(testid と同じ理由 = 実ブラウザの検査が、ボタンの属する行を ID で引く)。見た目には効かない。
    `    <tr data-testid={\`\${TESTID}.row\`} data-row-id={item.${rowKeyOf('id')}}>`,
    ...form.controls.flatMap((control) => cellLines(control, entityCamel, form.hasEnumLabels)),
    '      <td className={styles.screenTableCell}>',
    '        <div className={styles.screenRowActions}>',
    `          <button data-testid={\`\${TESTID}.${SAVE_LEAF}\`} className={styles.screenFormSubmit} type="button" disabled={busy || changed.length === 0 || view.conflicts.length > 0} onClick={save}>`,
    `            {runner.phase === 'pending' ? ${tsString(FORM_WORDING.pending())} : SAVE_LABEL}`,
    '          </button>',
    ...(hasButtons ? ['          {rowActions.buttons(item)}'] : []),
    '        </div>',
    `        <ActionErrorView error={runner.error} testId={\`\${TESTID}.${ROW_ERROR_LEAF}\`} fieldLabels={${entityCamel}FieldLabels} />`,
    '      </td>',
    '      {extra === undefined ? null : <td className={styles.screenTableCell}>{extra}</td>}',
    '    </tr>',
    '  );',
    '}',
    '',
  ];
}
