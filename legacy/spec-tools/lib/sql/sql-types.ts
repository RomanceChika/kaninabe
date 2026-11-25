/**
 * entity_spec のフィールド型 → **SQL の型**の写像(純関数)。
 *
 * 同じ対応表が 3 か所(定型 RPC の列の型・jsonb から取り出すときの cast・保存点の複合 RPC)に
 * 写されていた。列の型を 1 つ足したときに直し忘れる場所が 3 つあるということなので、正をここへ
 * 集める(PRIN-0007)。
 *
 * `columnExpression` が「型が同じなら何も足さない」形なのは、同じ型どうしに cast を書いても
 * 意味は変わらないからである —— 字面が長くなるだけの cast を出さない(既存の生成物と字面を
 * 合わせる意味もある)。jsonb の `->>` が返すのは必ず text なので、その経路では型どおりの
 * cast が付く。
 */

import type { FieldType } from '../model/types-entity.js';

/** フィールド型 → 列の型(pg_catalog の型名)。 */
const COLUMN_TYPES: Readonly<Record<FieldType['kind'], string>> = {
  uuid: 'uuid',
  ref: 'uuid',
  string: 'text',
  text: 'text',
  enum: 'text',
  state: 'text',
  integer: 'integer',
  decimal: 'numeric',
  boolean: 'boolean',
  date: 'date',
  datetime: 'timestamptz',
};

/** text のままでよい型(cast を書かない)。 */
const TEXT_TYPE = 'text';

/**
 * その欄を載せる列の型。
 *
 * @param type entity_spec のフィールド型
 * @returns pg_catalog の型名
 */
export function columnType(type: FieldType): string {
  return COLUMN_TYPES[type.kind];
}

/**
 * `max_length` / `pattern` を適用できる型か(文字列の欄)。
 *
 * **フィールド制約がどの型に効くかの正**である。zod の生成(`code-zod-field.ts` の
 * `.max()` / `.regex()`)と表の DDL の導出 CHECK(`{表}_{列}_max_length` /
 * `_pattern`)は**同じ有無**でなければならない —— 片方だけが効く型があると、
 * 入口で通った値が DB で弾かれる(またはその逆)ことになる。
 *
 * @param type entity_spec のフィールド型
 * @returns 文字列の欄なら true
 */
export function isStringLike(type: FieldType): boolean {
  return type.kind === 'string' || type.kind === 'text';
}

/**
 * `min` / `max` を適用できる型か(数値の欄)。`isStringLike` と同じ理由でここが正である。
 *
 * @param type entity_spec のフィールド型
 * @returns 数値の欄なら true
 */
export function isNumeric(type: FieldType): boolean {
  return type.kind === 'integer' || type.kind === 'decimal';
}

/**
 * 値を**その列に入れられる形**にした式(型が違うときだけ cast する)。
 *
 * **列 → 式の写像はこの 1 本である。** 定型 RPC の値の出どころは 3 通りある ——
 * jsonb の袋(`p_values ->> '欄'`)・1 欄ずつ受ける引数(`p_{欄}`)・保存点の複合 RPC が
 * 入力から取り出す式 —— が、どれも「この式をこの列に入れる」という同じ 1 つの問いを
 * 解いている。3 つが別々に cast の規則を持っていると、**片方の経路にだけ抜ける**。
 * 実測がそれで、jsonb の経路は `(… ->> 'x')::integer` を書くのに個別引数の経路は
 * 素の引数を書いており、`text` の引数を `timestamptz` の列へ入れる SQL が生成されていた
 * (予約を作る個別引数の RPC。`42804 column "starts_at" is of type timestamp with
 * time zone but expression is of type text`)。
 *
 * **「ずれてよい集合」は 1 つだけである** —— jsonb(と JWT)から `->>` で取り出した値は
 * 必ず `text` になるので、そこからのずれは cast で埋める。個別引数のずれは埋める対象ではなく
 * **宣言の誤り**であり、T14 が `args` の型と列の型の一致を error で見る(ARCH-SP-BE-0001
 * §引数名(params))。ここが cast を出せることと、出さずに済むことは矛盾しない ——
 * 検査が通っていれば同じ型なので cast は出ない。
 *
 * @param expression 値を与える式
 * @param from その式の型(pg_catalog の型名)
 * @param type 入れる先の欄の型
 * @returns SQL の式
 */
export function columnExpression(expression: string, from: string, type: FieldType): string {
  const column = columnType(type);
  return from === column ? expression : `(${expression})::${column}`;
}

/** jsonb / JWT から `->>` で取り出した値の型(`columnExpression` の `from`)。 */
export const JSON_TEXT_TYPE = TEXT_TYPE;
