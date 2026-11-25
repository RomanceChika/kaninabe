/**
 * 1 画面フォーム(code-usecase-form.ts)の**状態・送信前の写し・入力欄**の字面。
 *
 * 本体の字面(usecase-form-body.ts)が呼ぶ部品で、欄まわりの字面だけを持つ。
 * ここもアプリの語彙を 1 語も持たない。
 */

import type { BuiltSave } from '../../usecase/plan-build.js';
import { tsString } from '../../gen-kit/code-emit.js';
import type { FormStep } from './usecase-form-body.js';
import { saveBase, savePascal } from './usecase-app-names.js';
import { fieldsComponentName, schemaName, setterName, slug, stateName } from './usecase-form-names.js';

/** 1 行ぶんの初期値の式(選択欄はスキーマの先頭の選択肢、参照は画面が決める値)。 */
function blankRow(step: FormStep): string {
  const pairs = [
    ...step.supplied.map((field) => `${field}: initial[${tsString(field)}] ?? ''`),
    ...step.controls.map((control) =>
      control.kind === 'select'
        ? `${control.field}: ${schemaName(step)}.fields.${control.field}.options?.[0] ?? ''`
        : `${control.field}: ''`,
    ),
  ];
  return `{ ${pairs.join(', ')} }`;
}

/** 手順ごとの状態(繰り返しは行の配列)。 */
export function renderState(step: FormStep): readonly string[] {
  const variable = stateName(step);
  if (!step.repeat && step.controls.length === 0) {
    // 入力欄が 1 つも無い手順(値はすべて画面が決める)は、状態を持たない。
    return [`  const ${variable}: Record<string, string> = ${blankRow(step)};`];
  }
  if (!step.repeat) {
    return [
      `  const [${variable}, ${setterName(step)}] = useState<Record<string, string>>(() => (${blankRow(step)}));`,
    ];
  }
  return [
    `  const ${variable}Blank = (): Record<string, string> => (${blankRow(step)});`,
    // 繰り返す手順は **0 行から始める**(束⑯g)。初期行数は仕様に根拠が無く、1 行から始めると
    // 「その手順を使わない」ために人が削除を押すことになる —— 空の行を残して送れば必須欄で
    // 弾かれるので、要らない人に操作を強いる。足す人が「行を追加する」を押すのが対称である。
    `  const [${variable}, ${setterName(step)}] = useState<readonly Record<string, string>[]>(() => []);`,
  ];
}

/**
 * 送信前の写し(欄の値 → 保存点の入力)。
 *
 * 変換(空文字の落とし方・数値化・日時の表記)の正はフォームの口(`@/domain/form`)にあり、
 * 最後の検証は**サーバーと同じ保存点のスキーマ**で行う ——「フォームと Server Action は
 * 同じ導出スキーマを使う」(server-actions.md)を字面どおりに満たす。1 つでも通らなければ
 * その場で返す(送信前検証は関門ではなく UX であり、指摘の全数はサーバーが返す)。
 */
export function renderResolve(save: BuiltSave, steps: readonly FormStep[]): readonly string[] {
  const base = saveBase(save);
  const lines: string[] = [
    '  /** 入力欄の値を保存点の入力に写す(検証の正は生成 zod)。 */',
    `  function resolve(): { ok: true; value: ${savePascal(save)}Input } | { ok: false; issues: readonly FieldIssue[] } {`,
  ];
  for (const step of steps) {
    const variable = stateName(step);
    const upper = slug(step.alias).toUpperCase();
    if (!step.repeat) {
      lines.push(
        `    const ${variable}Row = collectRow(${schemaName(step)}, ${upper}_SCALARS, ${upper}_FLAGS, ${variable});`,
        `    if (!${variable}Row.ok) return { ok: false, issues: ${variable}Row.error.issues };`,
      );
      continue;
    }
    lines.push(
      `    const ${variable}Rows: Record<string, unknown>[] = [];`,
      `    for (const row of ${variable}) {`,
      `      const collected = collectRow(${schemaName(step)}, ${upper}_SCALARS, ${upper}_FLAGS, row);`,
      '      if (!collected.ok) return { ok: false, issues: collected.error.issues };',
      `      ${variable}Rows.push(collected.value);`,
      '    }',
    );
  }
  lines.push(
    `    const parsed = ${base}InputSchema.safeParse({`,
    ...steps.map((step) =>
      step.repeat
        ? `      ${tsString(step.alias)}: ${stateName(step)}Rows,`
        : `      ${tsString(step.alias)}: ${stateName(step)}Row.value,`,
    ),
    '    });',
    '    if (!parsed.success) return { ok: false, issues: toFieldIssues(parsed.error) };',
    '    return { ok: true, value: parsed.data };',
    '  }',
  );
  return lines;
}

/**
 * 手順 1 つぶんの節(見出し + 入力欄。繰り返しは行の追加・削除つき)。
 *
 * **手順 1 つが 1 つの節である。** 見出しは仕様が宣言した `label`(無ければ操作の label)で
 * あり、同じ操作を 2 回実行する保存点(別名 `as`)では、この見出しだけが 2 つの節を人に区別させる。
 * 見出しの階層(`h3`)は「部品の見出しは `h2`」の 1 段下という位置から決まる。
 */
export function renderStepFields(step: FormStep): readonly string[] {
  if (step.controls.length === 0) return [];
  const variable = stateName(step);
  const setter = setterName(step);
  const component = fieldsComponentName(step);
  const open = ['          <section>', `            <h3>{${tsString(step.label)}}</h3>`];
  if (!step.repeat) {
    return [
      ...open,
      `            <${component}`,
      '              testId={testId}',
      `              values={${variable}}`,
      `              onChange={(field, next) => ${setter}({ ...${variable}, [field]: next })}`,
      '            />',
      '          </section>',
    ];
  }
  return [
    ...open,
    `            {${variable}.map((row, index) => (`,
    '              <div key={index}>',
    `                <${component}`,
    '                  testId={testId}',
    '                  values={row}',
    `                  onChange={(field, next) =>`,
    `                    ${setter}(${variable}.map((item, at) => (at === index ? { ...item, [field]: next } : item)))`,
    '                  }',
    '                />',
    '                <button',
    `                  data-testid={\`\${testId}.${slug(step.alias)}.remove\`}`,
    '                  type="button"',
    `                  onClick={() => ${setter}(${variable}.filter((_, at) => at !== index))}`,
    '                >',
    '                  この行を削除する',
    '                </button>',
    '              </div>',
    '            ))}',
    '            <button',
    `              data-testid={\`\${testId}.${slug(step.alias)}.add\`}`,
    '              type="button"',
    `              onClick={() => ${setter}([...${variable}, ${variable}Blank()])}`,
    '            >',
    '              行を追加する',
    '            </button>',
    '          </section>',
  ];
}
