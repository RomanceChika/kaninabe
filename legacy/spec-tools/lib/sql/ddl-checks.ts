/**
 * **CHECK 制約 1 本の計画**の写像(純関数)。2 つある。
 *
 * - entity_spec の 1 欄 → **導出 CHECK**(`derivedChecks`)
 * - data_table の `checks[]` の 1 行 → **宣言された CHECK**(`planDeclaredCheck`)
 *
 * 制約の名前は `{表}_{列}_{接尾辞}` で、接尾辞は 4 語に固定してある(`ddl-plan.ts` の
 * `CHECK_SUFFIXES`)—— 名前が「どの列のどの制約か」から機械的に決まることが、突合を双方向に
 * できる条件である。式の字面は `pg_get_constraintdef` が `CHECK (…)` の内側に印字する形に合わせる。
 *
 * 表の形の計画(`ddl-plan.ts`)が呼ぶ下位の部品で、責務は CHECK 制約 1 本の計画に閉じる。
 */

import type { EntitySpec, FieldDef, SpecModel, StateMachineSpec } from '../model/types.js';
import type { DataCheckDecl } from '../model/data/types.js';
import { checkExpressionOf } from './check-expression.js';
import { sqlLiteral } from './guard-to-sql.js';
import { columnType, isNumeric, isStringLike } from './sql-types.js';
import { effectivePattern } from '../kernel/url-format.js';
import type { CheckSuffix, DdlCheck } from './ddl-plan.js';

/**
 * 1 欄から導出される CHECK の全数。
 *
 * 制約が効く型の判定は zod の生成と**同じ 1 本**(`sql-types.ts` の `isStringLike` /
 * `isNumeric`)を使う —— 入口(zod)と DB で効く型が食い違うと、入口で通った値が
 * DB で弾かれることになる。
 *
 * `enum([...])` と `state(機械)` は同じ `_enum` に落ちる(値の値域であることが同じで、
 * 値の出どころだけが違う)。
 */
export function derivedChecks(
  field: FieldDef,
  table: string,
  machines: ReadonlyMap<string, StateMachineSpec>,
): DdlCheck[] {
  const checks: DdlCheck[] = [];
  const add = (suffix: CheckSuffix, expression: string): void => {
    checks.push({ name: `${table}_${field.name}_${suffix}`, expression, invariant: null });
  };
  if (isStringLike(field.type)) {
    if (field.maxLength !== undefined) add('max_length', `(char_length(${field.name}) <= ${field.maxLength})`);
    const pattern = effectivePattern(field);
    if (pattern !== undefined) add('pattern', `(${field.name} ~ ${sqlLiteral(pattern)}::text)`);
  }
  if (isNumeric(field.type)) {
    const range = rangeExpression(field);
    if (range !== null) add('range', range);
  }
  if (field.type.kind === 'enum') add('enum', memberOf(field.name, field.type.values));
  if (field.type.kind === 'state') {
    const states = machines.get(field.type.machine)?.states ?? [];
    // 値の出どころ(state_spec の `states`)が違うだけで、DB に出る制約は enum とまったく同じ形。
    if (states.length > 0) add('enum', memberOf(field.name, states));
  }
  return checks;
}

/**
 * 数値の境界の**正準表記**。
 *
 * Postgres は負の定数を `'-100000'::integer` の形で印字する(`-` は演算子なので、定数として
 * 畳んだ結果に型を付けて書き戻す)。正の定数は素の数字のままである。**突合は
 * `pg_get_constraintdef` の字面と比べる**ので、ここが実測どおりでないと「生成 DDL を適用した
 * のに食い違う」が出る(負の下限を持つ数量の欄 `quantity >= -100000` で実測。題材の製品には負の下限を
 * 持つ欄が 1 つも無く、一生見えない穴だった)。
 *
 * @param field 欄の宣言(型を見る)
 * @param value 境界の値
 * @returns CHECK の式に置ける字面
 */
function numericBound(field: FieldDef, value: number): string {
  return value < 0 ? `'${value}'::${columnType(field.type)}` : String(value);
}

/** `min` / `max` の 4 通り(両方 / 下限だけ / 上限だけ / 無し)。 */
function rangeExpression(field: FieldDef): string | null {
  const low = field.min === undefined ? null : `(${field.name} >= ${numericBound(field, field.min)})`;
  const high = field.max === undefined ? null : `(${field.name} <= ${numericBound(field, field.max)})`;
  if (low !== null && high !== null) return `(${low} AND ${high})`;
  return low ?? high;
}

/**
 * 値の集合に属することの式。
 *
 * 字面を `= ANY (ARRAY[…])` にするのは、`in (…)` と書いても Postgres がこの形に正規化して
 * 印字するためである(突合は `pg_get_constraintdef` の出力と比べる)。
 *
 * 公開しているのは、仕組みが自分で持つ表(`framework-tables.ts`)の値域も同じ字面で
 * 書かなければならないからである(正準表記の正を 2 つ持たない)。
 *
 * @param column 列名
 * @param values 値の値域
 * @returns SQL の式(丸括弧で始まる)
 */
export function memberOf(column: string, values: readonly string[]): string {
  return `(${column} = ANY (ARRAY[${values.map((value) => `${sqlLiteral(value)}::text`).join(', ')}]))`;
}

/**
 * data_table の `checks[]` の 1 行 → 宣言された CHECK 1 本の計画(式の出どころは 3 通り)。
 *
 * | 宣言 | 式 |
 * |---|---|
 * | `rule` | その字面(素の式を丸括弧で包み、`check (…)` の形と `pg_get_constraintdef` の印字に揃える) |
 * | `invariant` だけ | 不変条件の `formal` から写した正準表記(`check-expression.ts`) |
 * | `handwritten` を宣言する / 写せない | `null`(この DDL は制約を作らず、突合は実在だけを見る) |
 *
 * **写せない理由をここで報告しない**のは、生成器が検査器の持ち場を兼ねないからである
 * (理由は T16 が `verify` に出す)。生成器は「反映できるものを反映する」だけを行う。
 *
 * @param check `checks[]` の 1 行
 * @param entity その表の集約(列の正)
 * @param domain ドメイン仕様(由来の不変条件を引く)
 * @returns CHECK 1 本の計画
 */
export function planDeclaredCheck(check: DataCheckDecl, entity: EntitySpec, domain: SpecModel): DdlCheck {
  return {
    name: check.name,
    expression: declaredExpression(check, entity, domain),
    invariant: check.invariant ?? null,
  };
}

/** 宣言された CHECK 1 本の式(反映できなければ null)。 */
function declaredExpression(check: DataCheckDecl, entity: EntitySpec, domain: SpecModel): string | null {
  if (check.rule !== undefined) return `(${check.rule})`;
  if (check.handwritten !== undefined || check.invariant === undefined) return null;
  const written = checkExpressionOf(check.invariant, entity, domain);
  return written.ok ? written.expression : null;
}

/**
 * `check` の後ろに置ける形(**丸括弧で始まらない式だけ**を包む)。
 *
 * 計画が持つ式は `pg_get_constraintdef` の内側の字面であり、ほとんどの形はそこが丸括弧で
 * 始まる。例外は全域化の `COALESCE(…, false)` だけで、Postgres が COALESCE を括弧で包まずに
 * 印字するため式の側も包めない。既存の式はすべて丸括弧で始まるので、**適用済みの生成 DDL の
 * 字面は 1 バイトも動かない**。
 *
 * @param expression CHECK の式(`DdlCheck.expression`)
 * @returns `check` の直後に置ける字面
 */
export function checkBody(expression: string): string {
  return expression.startsWith('(') ? expression : `(${expression})`;
}
