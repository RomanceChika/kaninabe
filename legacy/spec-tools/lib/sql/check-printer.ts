/**
 * 不変条件の `formal` → **Postgres が印字する字面**への印字器。
 *
 * `check-expression.ts` が持つのは「写せるか / 写せないならなぜか」の**判定**、ここが持つのは
 * 「写せると決まった式をどう**印字**するか」である。
 *
 * ## なぜ自分の印字器を持つのか
 *
 * 突合(`ddl-parity`)も冪等の判定(`ddl-migration.ts` の定義一致ガード)も
 * `pg_get_constraintdef` の出力と**文字列で**比べる。`guardToSql` が返すのは「流せる SQL」
 * であって Postgres の正準表記ではない(括弧が余り、`::text` の cast も無く、`and` が小文字)。
 * そちらを正準へ寄せると**適用済みの RPC / ポリシーの migration が全部書き換わる**ので、
 * 印字はこちらが持つ。字面の実測は `__tests__/unit/sql/check-expression.test.ts`。
 *
 * ## 別名
 *
 * 行の CHECK は 1 行の中にいるので**別名を付けない**(既定)。付けるのは同じ式を**トリガの
 * 本文**へ置くときだけで、plpgsql では裸の列名が解決しないためである(`new.{列}` /
 * `{別名}.{列}`)。別名を付けても演算子・cast・括弧の入れ方は変わらない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { CompareOp, CompareRhs, GuardExpr, Literal, PathRef } from '../guard/ast.js';
import { pathKey } from '../guard/atoms.js';
import { valueKindOfFieldType } from '../model/field-values.js';
import type { FieldDef, FieldType } from '../model/types.js';
import { sqlLiteral } from './guard-to-sql.js';

/**
 * 列に付ける別名の指定。文字列ならすべての列に同じ別名、関数なら欄の鍵(`{集約}.{欄}`)ごとに決める
 * (別の集約の欄を結合して読むトリガの本文で、自集約の欄と相手の欄に別の別名を付ける)。
 */
export type AliasSpec = string | ((key: string) => string | undefined);

/** パスの末尾(= 列名)。 */
function lastSegment(path: PathRef): string {
  return path.segments[path.segments.length - 1] ?? '';
}

/** 比較演算子 → Postgres が印字する演算子。 */
const PRINTED_OPS: Readonly<Record<CompareOp, string>> = {
  '==': '=',
  '!=': '<>',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
};

/** 順序比較の演算子(text の欄では照合順序を固定する)。 */
const ORDER_OPS: ReadonlySet<CompareOp> = new Set<CompareOp>(['<', '<=', '>', '>=']);

/** 文字列の順序を TS(JS のコード単位順)に合わせる照合順序(印字は大文字)。 */
const CODE_POINT_COLLATION = 'COLLATE "C"';

/**
 * 式 1 本を Postgres が印字する字面にする。
 *
 * 返す字面は**必ず丸括弧で始まる**(`COALESCE` に包むのは呼び側の 1 か所だけである)。
 *
 * @param expr 写す式
 * @param fields 参照してよい欄の索引(`{集約}.{欄}` → 欄)
 * @param alias 列に付ける別名(省略すると付かない = 行の CHECK)。関数なら欄の鍵(`{集約}.{欄}`)ごとに決める(別の集約の欄を結合して読むトリガの本文)
 * @returns 正準表記の字面
 */
export function renderCheck(
  expr: GuardExpr,
  fields: ReadonlyMap<string, FieldDef>,
  alias?: AliasSpec,
): string {
  return render(expr, fields, alias);
}

/** 式 1 本の印字(再帰の本体)。 */
function render(expr: GuardExpr, fields: ReadonlyMap<string, FieldDef>, alias?: AliasSpec): string {
  switch (expr.kind) {
    case 'and':
    case 'or':
      // Postgres は同じ演算子の入れ子を平らに畳んで印字する(`(A AND B AND C)`)。
      return `(${flatten(expr, expr.kind).map((part) => render(part, fields, alias)).join(expr.kind === 'and' ? ' AND ' : ' OR ')})`;
    case 'not':
      // `not (x is null)` は `IS NOT NULL` に畳む(どちらも同じ制約になる)。
      return expr.operand.kind === 'null'
        ? `(${column(expr.operand.path, fields, alias)} IS NOT NULL)`
        : `(NOT ${render(expr.operand, fields, alias)})`;
    case 'compare':
      return `(${operand(expr.path, expr.op, fields, alias)} ${PRINTED_OPS[expr.op]} ${rhs(expr, fields, alias)})`;
    case 'in':
      return `(${column(expr.path, fields, alias)} = ANY (ARRAY[${expr.values
        .map((value) => printedLiteral(value, fields.get(pathKey(expr.path))?.type))
        .join(', ')}]))`;
    case 'null':
      return `(${column(expr.path, fields, alias)} IS NULL)`;
    case 'contains':
      // `groundingProblem` が先に断るので、ここへは来ない(型の網羅のためだけに置く)。
      return '(false)';
  }
}

/** 同じ演算子の入れ子を平らに畳む(左右の順序は保つ)。 */
function flatten(expr: GuardExpr, kind: 'and' | 'or'): readonly GuardExpr[] {
  if (expr.kind !== kind) return [expr];
  return [...flatten(expr.left, kind), ...flatten(expr.right, kind)];
}

/** 比較の右辺(リテラルはその欄の型で cast が決まる)。 */
function rhs(
  expr: Extract<GuardExpr, { kind: 'compare' }>,
  fields: ReadonlyMap<string, FieldDef>,
  alias?: AliasSpec,
): string {
  const value: CompareRhs = expr.rhs;
  if (value.kind === 'path') return operand(value.path, expr.op, fields, alias);
  return printedLiteral(value, fields.get(pathKey(expr.path))?.type);
}

/** 比較の被演算子 1 つ(text の順序比較だけ照合順序を固定する)。 */
function operand(
  path: PathRef,
  op: CompareOp,
  fields: ReadonlyMap<string, FieldDef>,
  alias?: AliasSpec,
): string {
  const name = column(path, fields, alias);
  const kind = fields.get(pathKey(path))?.type;
  const isText = kind !== undefined && valueKindOfFieldType(kind) === 'text';
  return ORDER_OPS.has(op) && isText ? `(${name} ${CODE_POINT_COLLATION})` : name;
}

/** パス 1 本の列名(別名が渡されればそれを前置する)。 */
function column(path: PathRef, fields: ReadonlyMap<string, FieldDef>, alias?: AliasSpec): string {
  if (!fields.has(pathKey(path))) return 'null';
  const name = lastSegment(path);
  const prefix = typeof alias === 'function' ? alias(pathKey(path)) : alias;
  return prefix === undefined ? name : `${prefix}.${name}`;
}

/**
 * リテラル 1 つの印字(cast はその欄の型で決まる)。
 *
 * 実測どおりに分ける —— boolean は裸の `true` / `false`、integer は裸の数、
 * decimal(numeric)は小数点の無い数だけ `(0)::numeric`、それ以外は `'v'::{型}`。
 */
function printedLiteral(literal: Literal, type: FieldType | undefined): string {
  if (type === undefined) return literal.kind === 'number' ? String(literal.value) : sqlLiteral(literal.value);
  if (type.kind === 'boolean') return literal.kind === 'number' ? String(literal.value) : literal.value;
  if (type.kind === 'integer') return String(literal.value);
  if (type.kind === 'decimal') {
    const text = String(literal.value);
    return text.includes('.') ? text : `(${text})::numeric`;
  }
  if (type.kind === 'uuid' || type.kind === 'ref') return `${sqlLiteral(String(literal.value))}::uuid`;
  return `${sqlLiteral(String(literal.value))}::text`;
}
