/**
 * T25 **`personal_placeholder` は、その列の制約に収まる**(点検 14 回目 A14-4)。
 *
 * 消去は宣言の置換値をそのまま列へ書く。パーサは「文字列か null か」だけを見るので、列の制約と合わない値は最初の消去の実行まで見えない。
 * 一意の列に固定の値を書くと 1 人目の消去は通り、2 人目から全部の消去が `23505` で止まる(実 DB で実測)。1 人だけを消す見張りテストも緑のままである。
 *
 * 判定(閉じた表。読めない形は error):
 *
 * | 列 | 置換値 |
 * |---|---|
 * | 一意の索引の `on` に入る | `{id}` を含むか `null`(`null` は衝突しない) |
 * | 空にできない(`canBeEmpty` でない) | `null` は書けない |
 * | `string` / `text` | `{id}` を 32 桁で数えて `max_length` 以内・`pattern` に合う。`format: url` の列は `null` だけ(書式の検査を通らない) |
 * | `boolean` | `true` / `false` |
 * | `integer` / `decimal` | 数で、`min` / `max` の間 |
 * | `enum` | 値域の中 |
 * | `date` / `datetime` / `uuid` / `ref` / `state` | `null` だけ(文字列の置換値では型が合うと言えない) |
 *
 * `{id}` は消去の RPC が行の id のハイフン無しの 16 進で書く 32 桁である。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { Finding } from '../../kernel/finding.js';
import { canBeEmpty, type EntitySpec, type FieldDef, type SpecModel } from '../../model/types.js';
import { pluralizeEntity } from '../../model/table-name.js';
import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T25';

/** 行の id の置換の印。 */
const ID_MARK = '{id}';

/** `{id}` の展開の例(ハイフン無しの 16 進の 32 桁)。 */
const ID_SAMPLE = '0123456789abcdef0123456789abcdef';

/** 文字列の置換値が型に合わない理由(合えば null)。 */
function typeProblem(field: FieldDef, value: string): string | null {
  const rendered = value.replaceAll(ID_MARK, ID_SAMPLE);
  const { type } = field;
  switch (type.kind) {
    case 'string':
    case 'text': {
      if (field.format === 'url') return 'format: url の列に文字列の置換値は書けません(null だけ)';
      if (field.maxLength !== undefined && [...rendered].length > field.maxLength) return `${ID_MARK} を 32 桁で数えて ${[...rendered].length} 文字で、max_length ${field.maxLength} を超えます`;
      if (field.pattern !== undefined && !new RegExp(field.pattern, 'u').test(rendered)) return `pattern ${field.pattern} に合いません`;
      return null;
    }
    case 'boolean':
      return value === 'true' || value === 'false' ? null : 'boolean の列には true / false だけを書けます';
    case 'integer':
    case 'decimal': {
      const number = Number(value);
      if (value.trim() === '' || !Number.isFinite(number) || (type.kind === 'integer' && !Number.isInteger(number))) return `${type.kind} の列の値ではありません`;
      if ((field.min !== undefined && number < field.min) || (field.max !== undefined && number > field.max)) return `値の範囲(${field.min ?? ''}〜${field.max ?? ''})の外です`;
      return null;
    }
    case 'enum':
      return type.values.includes(value) ? null : `enum の値域(${type.values.join(' / ')})にありません`;
    default:
      return `${type.kind} の列に文字列の置換値は書けません(null だけ)`;
  }
}

/** 列が一意の索引の鍵に入るか(入るなら索引の名前)。 */
function uniqueIndexOf(table: DataTableSpec | undefined, field: string): string | undefined {
  return table?.indexes.find((index) => index.unique && index.on.includes(field))?.name;
}

/** 1 列ぶんの理由の並び。 */
function problemsOf(field: FieldDef, table: DataTableSpec | undefined): readonly string[] {
  const value = field.personalPlaceholder;
  if (value === undefined) return [];
  if (value === null) return canBeEmpty(field) ? [] : ['空にできない列に null は書けません'];
  const index = uniqueIndexOf(table, field.name);
  const problems: string[] = [];
  if (index !== undefined && !value.includes(ID_MARK)) problems.push(`一意の索引 ${index} の列に固定の値を書くと、2 人目の消去から一意の違反で止まります`);
  const shape = typeProblem(field, value);
  if (shape !== null) problems.push(shape);
  return problems;
}

/** エンティティ 1 つぶんの検査。 */
function checkEntity(entity: EntitySpec, tables: ReadonlyMap<string, DataTableSpec>): Finding[] {
  const table = tables.get(entity.table ?? pluralizeEntity(entity.entity));
  return entity.fields
    .filter((field) => field.personal)
    .flatMap((field) =>
      problemsOf(field, table).map((problem) => ({
        verifier: VERIFIER_ID,
        severity: 'error' as const,
        message: `${entity.entity}.${field.name} の personal_placeholder ${JSON.stringify(field.personalPlaceholder)} は列の制約に収まりません: ${problem}`,
        location: { ...field.location, pointer: `fields.${field.name}.personal_placeholder` },
        suggestion: '一意の列は {id} を含める(32 桁で数える)か null。文字列の列は長さと pattern に合わせる。空にできる列だけ null。ほかの型は値域の値',
        counterexample: { field: `${entity.entity}.${field.name}`, placeholder: String(field.personalPlaceholder) },
      })),
    );
}

/**
 * 全 entity_spec の `personal_placeholder` を列の制約と突き合わせる。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
export function verifyPersonalPlaceholders(domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  const tables = new Map(dataTables.tables.map((table) => [table.table, table] as const));
  return [...domain.aggregates.values()].flatMap((specs) => (specs.entity === undefined ? [] : checkEntity(specs.entity, tables)));
}
