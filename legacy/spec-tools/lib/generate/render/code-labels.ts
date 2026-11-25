/**
 * 表示名テーブル(`app/src/domain/generated/{name}.labels.ts`)の生成器。
 *
 * `label`(状態・イベントの日本語名)は検証には使わないが、**画面がそれを持つと仕様と表示が
 * 二重管理になる**(状態を 1 つ足したときに画面の対応表を直し忘れる)。仕様に既にある値なので、
 * 生成物として実装側へ渡し、画面は import するだけにする。
 *
 * label を宣言していない状態・イベントはキーを持たない(生成物は仕様の写像であり、
 * 無い値を発明しない)。`as const` なので、画面側は存在するキーだけを型で知ることになる。
 *
 * **3 種類の表示名を 1 つのファイル名の空間に出す。** state_spec の状態・イベントの `label` と、
 * entity_spec の `enum` の `labels` と、entity_spec の欄の `label`(`{entity}FieldLabels`。**entity_spec を
 * 持つ全エンティティ**。字面は `code-field-labels.ts`)である(状態機械名と集約名が同じとき —— `entry` /
 * `workshop` / `invitation` —— 同じファイルに並ぶ。1 ファイルに 1 つの生成器という
 * 規約を守るため、生成器を分けずにここが書く)。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import { allMachines, type EntitySpec, type SpecModel, type StateMachineSpec } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import {
  generatedFile,
  docComment,
  generatedHeader,
  renderLiteral,
  toCamelCase,
  type LiteralValue,
} from '../../gen-kit/code-emit.js';
import { renderFieldLabels } from './code-field-labels.js';

/**
 * 状態機械と集約から表示名テーブルを生成するジェネレーター。
 * 出力は `app/src/domain/generated/{name}.labels.ts`(名前ごとに 1 ファイル・全体生成)。
 */
export const stateLabelGenerator: DocGenerator = {
  id: 'code-labels',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const machines = new Map<string, StateMachineSpec>();
    for (const { machine } of allMachines(model)) machines.set(machine.machine, machine);
    const entities = new Map<string, EntitySpec>();
    for (const specs of model.aggregates.values()) {
      const entity = specs.entity;
      if (entity !== undefined) entities.set(entity.entity, entity);
    }
    const names = [...new Set([...machines.keys(), ...entities.keys()])].sort((a, b) => a.localeCompare(b));
    return names.map((name) => ({
      file: generatedFile(ctx.roots, `${name}.labels.ts`),
      content: renderLabelsFile(name, machines.get(name), entities.get(name)),
      wholeFile: true,
    }));
  },
};

/** 1 つの名前(状態機械 / 集約)分の表示名ファイル全体を組み立てる。 */
function renderLabelsFile(
  name: string,
  machine: StateMachineSpec | undefined,
  entity: EntitySpec | undefined,
): string {
  const sources = [machine?.location.file, entity?.location.file].filter(
    (file): file is string => file !== undefined,
  );
  return [
    generatedHeader([...new Set(sources)]),
    '',
    ...(machine === undefined ? [] : machineLabels(name, machine)),
    ...(entity === undefined ? [] : [...renderFieldLabels(entity), '']),
    ...(entity === undefined || !entity.fields.some((field) => field.labels !== undefined)
      ? []
      : enumLabels(name, entity)),
  ].join('\n');
}

/** 状態・イベントの表示名(state_spec 由来)。 */
function machineLabels(name: string, machine: StateMachineSpec): readonly string[] {
  const prefix = toCamelCase(name);
  const states: LiteralValue = pickStateLabels(machine);
  const events: LiteralValue = pickEventLabels(machine);
  return [
    docComment([
      `${name} の状態の表示名(state_spec の states[].label)。`,
      '画面はこの表を使い、状態 ID から表示文字列への対応を自前で持たない。',
      `label を宣言していない状態はキーを持たない。仕様: ${machine.location.file}`,
    ]),
    `export const ${prefix}StateLabels = ${renderLiteral(states)} as const;`,
    '',
    docComment([
      `${name} のイベント(操作)の表示名(state_spec の events[].label)。`,
      'ボタン名などに使う。イベント ID はドメインイベント ID の後半と同じもの。',
      `仕様: ${machine.location.file}`,
    ]),
    `export const ${prefix}EventLabels = ${renderLiteral(events)} as const;`,
    '',
  ];
}

/** enum の値の表示名(entity_spec の fields[].labels 由来)。 */
function enumLabels(name: string, entity: EntitySpec): readonly string[] {
  const table: Record<string, Record<string, string>> = {};
  for (const field of entity.fields) {
    if (field.labels === undefined) continue;
    table[field.name] = { ...field.labels };
  }
  return [
    docComment([
      `${name} の enum の値の表示名(entity_spec の fields[].labels)。`,
      '鍵は欄の名前、値は「enum の値 → 人の言葉」。画面(生成フォームの select を含む)は',
      'この表を引き、値から表示名への対応を自前で持たない。',
      '入力に現れる enum は labels 必須なので、人が選ぶ欄は必ずここに載る(V16)。',
      `仕様: ${entity.location.file}`,
    ]),
    `export const ${toCamelCase(name)}EnumLabels = ${renderLiteral(table)} as const;`,
    '',
  ];
}

/** 宣言順に、label を持つ状態だけを集める。 */
function pickStateLabels(machine: StateMachineSpec): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const state of machine.states) {
    const label = machine.stateLabels[state];
    if (label !== undefined) labels[state] = label;
  }
  return labels;
}

/** 宣言順に、label を持つイベントだけを集める。 */
function pickEventLabels(machine: StateMachineSpec): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const event of machine.events) {
    if (event.label !== undefined) labels[event.id] = event.label;
  }
  return labels;
}
