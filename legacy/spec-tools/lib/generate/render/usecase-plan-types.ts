/**
 * 実行計画の生成物(`usecase-plans.ts` / `operation-plans.ts`)が使う **import 行と手順の字面**。
 *
 * 型そのものは `@kaninabe/runtime/plan`(仕組み側の手書き。ADR-0013)が 1 か所に持つ —— 保存点と単発の
 * 操作は同じ形なので、型を 2 か所に書かない(束 ⑰ 設計 §0)。ここが持つのは「その値を組み立てる
 * ときに要る import の集合」と「1 手順のリテラルの字面」であり、2 つの計画生成器が共有する。
 *
 * **アプリの語彙は 1 語も持たない。** import する定数の名前は、計画に現れた集約名・状態機械名
 * から命名規約どおりに組み立てる。
 */

import type { SaveStepPlan } from '../../usecase/step-plan.js';
import type { UsecaseStepFacts } from '../../usecase/plan-facts.js';
import { runStepData } from '../../usecase/step-plan-data.js';
import { renderLiteral, toCamelCase, tsString } from '../../gen-kit/code-emit.js';
import { RUNTIME_PLAN_MODULE } from './runtime-modules.js';


/** 手順の `roleGates` を、生成物のリテラルに出せる形(読み取り専用の型を外した写し)にする。 */
function roleGatesLiteral(
  gates: Readonly<Record<string, readonly { readonly field: string; readonly values?: readonly string[] }[]>>,
): Record<string, { field: string; values?: string[] }[]> {
  const literal: Record<string, { field: string; values?: string[] }[]> = {};
  for (const [role, conditions] of Object.entries(gates)) {
    literal[role] = conditions.map((condition) =>
      condition.values === undefined ? { field: condition.field } : { field: condition.field, values: [...condition.values] },
    );
  }
  return literal;
}

/**
 * 計画が参照する規則表・状態機械・型の import 行(重複なし・名前順)。
 *
 * @param steps 計画に現れる全手順
 * @param types 型として import する名前(例: `RunPlan`)
 * @returns import 文の行
 */
export function planImports(steps: readonly SaveStepPlan[], types: readonly string[]): readonly string[] {
  const lines = new Set<string>([`import type { ${[...types].sort().join(', ')} } from '${RUNTIME_PLAN_MODULE}';`]);
  for (const step of steps) {
    const table = rulesTable(step);
    if (table !== null) lines.add(`import { ${table.name} } from './${step.entity}.${table.file}';`);
    if (step.machine !== null) {
      const name = step.machine.machine;
      lines.add(`import { ${toCamelCase(name)}Machine } from './${name}.transitions';`);
    }
  }
  return [...lines].sort((a, b) => a.localeCompare(b));
}

/** その手順が参照する規則表(遷移は状態機械なので null)。 */
function rulesTable(step: SaveStepPlan): { readonly name: string; readonly file: string } | null {
  const camel = toCamelCase(step.entity);
  switch (step.kind) {
    case 'create':
      return { name: `${camel}CreateRules`, file: 'creates' };
    case 'delete':
      return { name: `${camel}DeleteRules`, file: 'deletes' };
    case 'update':
      return { name: `${camel}WriteRules`, file: 'writes' };
    default:
      return null;
  }
}

/**
 * 手順 1 つのリテラル(規則表・状態機械だけが識別子で、残りはリテラル)。
 *
 * 値の組み立ては `usecase/step-plan-data.ts` の 1 か所である —— 同じ値を結果表も実行器に
 * 渡すので、ここは**その写しを字面にするだけ**にしてある。
 *
 * @param step 接地済みの手順
 * @param facts その手順の解決済みの事実(無ければ空として出す)
 * @returns インデント済みの行
 */
export function renderStepLiteral(step: SaveStepPlan, facts: UsecaseStepFacts | undefined): string {
  const table = rulesTable(step);
  const identifier = (name: string): string => (table?.name === name ? name : 'null');
  const data = runStepData(step, facts);
  return [
    '      {',
    `        op: ${tsString(data.op)},`,
    `        alias: ${tsString(data.alias)},`,
    `        label: ${tsString(data.label)},`,
    `        kind: ${tsString(data.kind)},`,
    `        aggregate: ${tsString(data.aggregate)},`,
    `        repeat: ${String(data.repeat)},`,
    `        self: ${data.self ? 'true' : 'false'},`,
    `        event: ${data.event === null ? 'null' : tsString(data.event)},`,
    `        createRules: ${identifier(`${toCamelCase(step.entity)}CreateRules`)},`,
    `        deleteRules: ${identifier(`${toCamelCase(step.entity)}DeleteRules`)},`,
    `        writeRules: ${identifier(`${toCamelCase(step.entity)}WriteRules`)},`,
    `        machine: ${step.machine === null ? 'null' : `${toCamelCase(step.machine.machine)}Machine`},`,
    `        stateFrom: ${renderLiteral(data.stateFrom === null ? null : { ...data.stateFrom }, 4)},`,
    `        guardFacts: ${renderLiteral(data.guardFacts.map((fact) => ({ ...fact })), 4)},`,
    `        roleFacts: ${renderLiteral(data.roleFacts.map((fact) => ({ ...fact })), 4)},`,
    `        claimFacts: ${renderLiteral(data.claimFacts.map((fact) => ({ ...fact })), 4)},`,
    // 行の条件を持つロールが無い計画は、この欄ごと出さない(宣言しなければ生成物は変わらない)。
    ...(data.roleGates === undefined ? [] : [`        roleGates: ${renderLiteral(roleGatesLiteral(data.roleGates), 4)},`]),
    `        unresolvableRoles: ${renderLiteral([...data.unresolvableRoles], 4)},`,
    `        inputKeys: ${renderLiteral([...data.inputKeys], 4)},`,
    '      },',
  ].join('\n');
}
