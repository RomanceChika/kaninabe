/**
 * entity_spec → zod スキーマ(`app/src/domain/generated/{aggregate}.schema.ts`)の生成器。
 *
 * ADR-0004 / ADR-0006: フォームと Server Action が共用する入力検証は仕様から生成し、
 * 実装側はスキーマを手で持たない。集約ごとに 2 つのスキーマを出す:
 * - `{entity}RowSchema` — 永続化された 1 行(全フィールド。**閉世界** = strictObject。
 *   仕様に無い列は剥がさずエラーにし、未宣言の DB 列を row-parity で検出できるようにする)
 * - `{entity}InputSchema` — 作成入力(auto フィールドと state 型フィールドを除く)
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import {
  allMachines,
  isInputAbsent,
  isSystemSupplied,
  type EntitySpec,
  type FieldDef,
  type SpecModel,
} from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { generatedFile, docComment, generatedHeader, toCamelCase, toPascalCase } from '../../gen-kit/code-emit.js';
import { fieldSchemaExpr, hasTextField, type Absence, type StatesByMachine } from './code-zod-field.js';

/**
 * 各集約の entity_spec から zod スキーマファイルを生成するジェネレーター。
 * 出力は `app/src/domain/generated/{aggregate}.schema.ts`(1 集約 1 ファイル・全体生成)。
 */
export const zodSchemaGenerator: DocGenerator = {
  id: 'code-zod',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const states = statesByMachine(model);
    const sections: GeneratedSection[] = [];
    for (const [name, aggregate] of model.aggregates) {
      const entity = aggregate.entity;
      if (entity === undefined) continue;
      sections.push({
        file: generatedFile(ctx.roots, `${name}.schema.ts`),
        content: renderSchemaFile(entity, states),
        wholeFile: true,
      });
    }
    return sections;
  },
};

/**
 * state 型フィールドを z.enum に展開するための、機械名 → 状態一覧のマップを作る。
 * 状態機械は別集約に属することがある(モデル横断参照)ため、モデル全体から引く。
 */
function statesByMachine(model: SpecModel): StatesByMachine {
  const map = new Map<string, readonly string[]>();
  for (const { machine } of allMachines(model)) map.set(machine.machine, machine.states);
  return map;
}

/** 1 集約分のスキーマファイル全体を組み立てる。 */
function renderSchemaFile(entity: EntitySpec, states: StatesByMachine): string {
  const rowSchema = `${toCamelCase(entity.entity)}RowSchema`;
  const inputSchema = `${toCamelCase(entity.entity)}InputSchema`;
  const rowType = `${toPascalCase(entity.entity)}Row`;
  const inputType = `${toPascalCase(entity.entity)}Input`;
  const inputFields = entity.fields.filter((field) => !isInputAbsent(field));

  return [
    generatedHeader([entity.location.file]),
    '',
    "import { z } from 'zod';",
    ...(hasTextField(entity.fields) ? ["import { textInput } from '@kaninabe/runtime/text-input';"] : []),
    '',
    docComment([
      `${entity.entity} の 1 行(永続化された全フィールド)のスキーマ。`,
      '任意のフィールドは .nullable() になる(行は全列を持ち、値が無い列は null で返る)。',
      'auto: true と state 型は「入力に現れない」だけで行には必ず値があるので、ここでは必須である。',
      '閉世界(strictObject): 仕様に無い列が行に現れたら通らない。未宣言の DB 列を黙って',
      '剥がすと「行の形」の宣言が嘘になるため、row-parity の突合がここで失敗するようにする。',
      `仕様: ${entity.location.file}`,
    ]),
    ...objectSchema(rowSchema, entity.fields, states, absenceInRow, 'closed'),
    '',
    docComment([`${entity.entity} の 1 行の型(${rowSchema} から導出)。`]),
    `export type ${rowType} = z.infer<typeof ${rowSchema}>;`,
    '',
    docComment([
      `${entity.entity} の作成入力のスキーマ。`,
      'auto: true のフィールド(システム採番)・state 型のフィールド(初期状態は状態機械が決める)・',
      'supplied_by: db のフィールド(列の既定値かトリガが決める)は含まない。',
      `仕様: ${entity.location.file}`,
    ]),
    ...objectSchema(inputSchema, inputFields, states, absenceInInput, 'open'),
    '',
    docComment([`${entity.entity} の作成入力の型(${inputSchema} から導出)。`]),
    `export type ${inputType} = z.infer<typeof ${inputSchema}>;`,
    '',
  ].join('\n');
}

/**
 * 行(row)で「値が無い」ときの形。
 *
 * 2 点で入力スキーマと違う。
 * ① **システムが供給するフィールド(auto / state 型)は必ずある** — 「入力に現れない」だけであり、
 *    任意にすると row スキーマが「id や state が無い行もある」と言うことになる。
 * ② 任意の列は「キーが無い」のではなく **null で返ってくる** — 行は全列を持つので、
 *    `.optional()` にすると実在の行が自分の row スキーマを通らない。
 */
function absenceInRow(field: FieldDef): Absence {
  return field.required || isSystemSupplied(field) ? 'none' : 'nullable';
}

/**
 * 作成入力で「値が無い」ときの形。
 *
 * こちらはシステムが供給するフィールドを**丸ごと除外した後**の判断なので `required` だけで決まり、
 * 無いものは「キーごと渡さない」(`.optional()`)。null を渡す形にはしない
 * (「入力していない」と「空で入力した」を入口で区別するため。domain/form.ts の変換規則)。
 */
function absenceInInput(field: FieldDef): Absence {
  return field.required ? 'none' : 'optional';
}

/**
 * スキーマの世界の開閉。
 *
 * - `closed`(行) — `z.strictObject`。宣言に無いキーは剥がさず**エラーにする**。
 *   行スキーマは「永続化された 1 行の形」を表すので、DB にあって仕様に無い列が
 *   黙って消える(= 未宣言の列に誰も気づかない)ことを許さない。
 * - `open`(入力) — `z.object`。入力は境界の写像であり、行の閉世界とは別の判断。
 */
type World = 'closed' | 'open';

/**
 * `export const {name} = z.object({ ... });`(または strictObject)を行の配列として組み立てる。
 *
 * @param name スキーマの変数名
 * @param fields 並べるフィールド(順序は仕様の宣言順)
 * @param states state 型の展開に使う機械名 → 状態一覧
 * @param absenceOf 値が無いときの形の判断(row と input で違う)
 * @param world 閉世界(strictObject)か開世界(object)か
 */
function objectSchema(
  name: string,
  fields: readonly FieldDef[],
  states: StatesByMachine,
  absenceOf: (field: FieldDef) => Absence,
  world: World,
): string[] {
  const ctor = world === 'closed' ? 'z.strictObject' : 'z.object';
  if (fields.length === 0) return [`export const ${name} = ${ctor}({});`];
  return [
    `export const ${name} = ${ctor}({`,
    ...fields.map((field) => `  ${field.name}: ${fieldSchemaExpr(field, states, absenceOf(field))},`),
    '});',
  ];
}
