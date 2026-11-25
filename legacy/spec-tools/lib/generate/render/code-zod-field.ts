/**
 * entity_spec の 1 フィールドを zod の式文字列に写像する。
 *
 * 対応する zod は app 側にインストールされた v4 系で、文字列フォーマットは
 * トップレベル API(`z.uuid()` / `z.iso.datetime()`)を使う(v3 の
 * `z.string().uuid()` は v4 では非推奨)。
 */

import type { FieldDef, FieldType } from '../../model/types.js';
import { isNumeric, isStringLike } from '../../sql/sql-types.js';
import { effectivePattern } from '../../kernel/url-format.js';
import { tsString } from '../../gen-kit/code-emit.js';

/** 機械名 → その状態機械の状態一覧。state 型フィールドを z.enum に展開するために使う。 */
export type StatesByMachine = ReadonlyMap<string, readonly string[]>;

/**
 * 「値が無い」ことの表し方。**同じ `required: false` でも、スキーマによって形が違う**。
 * - `none`     … 値は必ずある(required、またはシステムが供給するフィールド)
 * - `optional` … キーごと無い(作成入力で「渡さなかった」)
 * - `nullable` … キーはあり値が null(永続化された行。列が NULL を持つ)
 */
export type Absence = 'none' | 'optional' | 'nullable';

/** 表し方 → zod のチェーンメソッド。 */
const ABSENCE_SUFFIX: Readonly<Record<Absence, string>> = {
  none: '',
  optional: '.optional()',
  nullable: '.nullable()',
};

/**
 * フィールド定義から zod の式(例: `z.string().max(100).optional()`)を作る。
 * required の文字列には「空白を除いて 1 文字以上」の写像として `.trim().min(1)` が付く。
 *
 * **値が無いときの形は呼び出し側が決める**。`required` は「入力として必須か」の 1 つの意味しか
 * 持たず、行(row)のスキーマでは auto / state 型が別の理由で必須になり、任意の列は
 * 「キーが無い」ではなく「null」として返ってくるためである
 * (code-zod.ts の absenceInRow / absenceInInput が判断の置き場)。
 *
 * @param field 対象フィールド
 * @param states state 型の展開に使う機械名 → 状態一覧
 * @param absence 値が無いときの表し方
 */
export function fieldSchemaExpr(
  field: FieldDef,
  states: StatesByMachine,
  absence: Absence,
): string {
  return `${baseExpr(field.type, states)}${constraintExpr(field)}${ABSENCE_SUFFIX[absence]}`;
}

/**
 * 文字列の欄(string / text)の起点。`@kaninabe/runtime/text-input` の部品で、制御文字と孤立した surrogate を拒む(点検 18 回目 O18-2)。
 *
 * **行(row)にも入力(input)にも同じに使う。** 更新の入力スキーマは行のスキーマから `pick` で借りる(`domain/inputs/*`)ので、
 * 行だけ素の `z.string()` にすると、作成は拒むのに更新は NUL を通して 500 になる(実測: 項目の題名・催しの題名の更新)。
 * 行のスキーマを読み取りの検証に使う経路は無い(行の形の突合の試験だけ)ので、この検証が読み取りを止めることは無い。
 */
const TEXT_INPUT_EXPR = 'textInput()';

/**
 * 文字列の欄(string / text)が 1 つでもあるか(あれば生成するファイルは `textInput` を import する。無い集約に未使用の import を出さない)。
 *
 * @param fields 集約の全フィールド
 * @returns 文字列の欄があれば true
 */
export function hasTextField(fields: readonly FieldDef[]): boolean {
  return fields.some((field) => isStringLike(field.type));
}

/** 型 kind ごとの基底の zod 式。 */
function baseExpr(type: FieldType, states: StatesByMachine): string {
  switch (type.kind) {
    case 'uuid':
    case 'ref':
      return 'z.uuid()';
    case 'string':
    case 'text':
      return TEXT_INPUT_EXPR;
    case 'integer':
      return 'z.number().int()';
    case 'decimal':
      return 'z.number()';
    case 'boolean':
      return 'z.boolean()';
    case 'date':
      return 'z.iso.date()';
    case 'datetime':
      // offset: true — DB(timestamptz)から読んだ値は "+09:00" のようなオフセット付きで返るため、
      // Z 固定の既定では実在の行が自分の row スキーマを通らない(仕様が行について嘘をつく)。
      return 'z.iso.datetime({ offset: true })';
    case 'enum':
      return enumExpr(type.values);
    case 'state':
      return stateExpr(type.machine, states);
  }
}

/**
 * state 型を、その状態機械の states から作った z.enum に展開する。
 * 参照先の機械が見つからない場合(V2 が捕まえるため verify 通過後には起きない)は
 * 生成を落とさず z.string() に縮退する。
 */
function stateExpr(machine: string, states: StatesByMachine): string {
  const values = states.get(machine);
  return values === undefined || values.length === 0 ? 'z.string()' : enumExpr(values);
}

/** 値の並びから `z.enum([...])` を作る(並びは仕様の順を保つ)。 */
function enumExpr(values: readonly string[]): string {
  return `z.enum([${values.map(tsString).join(', ')}])`;
}

/**
 * max_length / min / max / pattern をチェーンメソッドに写像する。型に合わない制約は無視する。
 *
 * **required の文字列は「空白を除いて 1 文字以上」を意味する**(domain-spec-writing.md の fields 節)。
 * その写像が `.trim().min(1)` であり、順序が要点である — 先に `.trim()`(値を書き換える check)を
 * 置くことで、`min` / `max` は**前後の空白を落とした後の長さ**に対して判定される。逆順だと
 * 空白だけの入力が `min(1)` を通ってしまい、宣言と実際の受理集合がずれる。
 */
function constraintExpr(field: FieldDef): string {
  const parts: string[] = [];
  if (isStringLike(field.type)) {
    if (field.required) parts.push('.trim()', '.min(1)');
    if (field.maxLength !== undefined) parts.push(`.max(${field.maxLength})`);
    const pattern = effectivePattern(field);
    if (pattern !== undefined) parts.push(`.regex(new RegExp(${tsString(pattern)}))`);
  }
  if (isNumeric(field.type)) {
    if (field.min !== undefined) parts.push(`.min(${field.min})`);
    if (field.max !== undefined) parts.push(`.max(${field.max})`);
  }
  return parts.join('');
}
