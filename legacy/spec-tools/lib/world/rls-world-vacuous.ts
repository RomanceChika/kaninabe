/**
 * 執行点の条件が **world の行では前提から成り立たない**(空に満たされる)かの判定(点検 20 回目 B20-1 の残り 3)。
 *
 * `rls-world-derivable.ts` は、行内比較・一意・排他に写せない執行点(数の上限・別の集約の状態・未ログインの作成の天井)を
 * 「world を宣言から作れない」として止めてきた。ところがそのうち少なくない数は、**条件の前提が world の行では偽**なので
 * 執行点が何も拒まない —— 例: 「聴講者の枠には資料を登録できない」(数の上限 0・`where` が枠の種別 = 聴講者)は、world が枠の種別に
 * 列挙の先頭(発表)を置くので当たらない。そうした執行点は world の組み立てを妨げない。
 *
 * 判定は宣言だけから行う(3 値: 真 / 偽 / 不明。不明は「当たりうる」に倒し、従来どおり止める)。
 *
 * **状態依存(`state_dependency`)の前提は見ない。** 前提(`if`)が world で偽でも、執行点(トリガの本文)が宣言より強く
 * 帰結を無条件に要求していれば world は入らない —— 以前の製品の実例(INV-PROGRAM-003。前提つきの宣言・無条件の本文)でそうなり、
 * 宣言の前提を信じて world を作ると組み立てそのものが落ちた。この食い違いは 3a0a0b25e で宣言の前提を外して(厳しい側に揃えて)
 * 解消済みで、今の製品に前提つきの宣言と無条件の本文の組は無い。ただし食い違いは宣言の側の誤りであって世界の作り方で救うものではない
 * ので、この規則(前提を見ない)は残す。状態依存は帰結の側(祖先の行を帰結の状態に置く)で満たすのが筋であり、
 * それは別の仕事として残す。
 *
 * | 執行点の形式定義 | 当たらないとみなす条件 |
 * |---|---|
 * | `cardinality`(`where` つき) | `where` が world の値で偽 |
 * | 未ログインの作成の天井(`creates[].abuse` の生成トリガ) | 全体・鍵ごとの天井がどちらも 2 以上(world はその表に系統ごとに 1 行・鍵の欄は行ごとに違う値を置き、実行中の作成は 1 行ずつ足して消す) |
 *
 * world の値は `rls-world-values.ts` の写像と同じ規則で決まるものだけを読む: 状態の欄は機械の初期状態(DB の既定)、値を置く
 * 必須の列挙の欄は先頭、必須の真偽の欄は false。data_table が既定値を宣言した欄・DB が決める欄・ほかの型は「不明」である。
 *
 * world を組み立てた後の組み合わせ(状態やガード変数の置き直し)で執行点が拒むことはある。それは許可の側の制約違反(SQLSTATE
 * クラス 23)として一致の証明に数えられ(engine は不変条件を予測しない)、world そのものが入らなければ「world が設計図どおりに
 * 作られている」のテストが赤になる —— 黙って緑にはならない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { InvariantFormal, SpecModel } from '../model/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import type { GuardExpr, Literal, PathRef } from '../guard/ast.js';
import { parseFormalGuard } from '../guard/parser.js';
import { findEntitySpec, findStateMachines } from '../semantics/domain-lookup.js';
import { ceilingPlanOf } from '../model/data/ceiling-plan.js';
import { isValueSupplied } from './rls-world-values.js';

/** 未ログインの作成の天井が world を妨げない最小の値(world の 1 行 + 実行中の作成 1 行)。 */
const CEILING_ROOM = 2;

/** 3 値の真偽(不明 = null)。 */
type Truth = boolean | null;

/**
 * 形式定義の執行点が world の行では当たらないか。
 *
 * @param formal 由来の不変条件の形式定義
 * @param domain ドメイン仕様
 * @param tables 全テーブル仕様(既定値を宣言した欄を「不明」にするため)
 * @returns 当たらないと宣言から言えるなら true
 */
export function vacuousInWorld(formal: InvariantFormal, domain: SpecModel, tables: readonly DataTableSpec[]): boolean {
  const premise = formal.kind === 'cardinality' ? formal.where : undefined;
  if (premise === undefined) return false;
  const parsed = parseFormalGuard(premise);
  return parsed.ok && evaluate(parsed.expr, domain, tables) === false;
}

/**
 * 未ログインの作成の天井の生成トリガが world を妨げないか。
 *
 * @param table 対象の表
 * @param trigger トリガ名
 * @param domain ドメイン仕様
 * @returns その表の天井のトリガで、天井が world の行と実行中の作成を収めるなら true
 */
export function ceilingRoomy(table: DataTableSpec, trigger: string, domain: SpecModel): boolean {
  const plan = ceilingPlanOf(table, domain);
  if (plan?.name !== trigger) return false;
  return plan.global.max >= CEILING_ROOM && (plan.perKey === undefined || plan.perKey.max >= CEILING_ROOM);
}

/** ガード式を world の値で評価する(読めない値・形は不明)。 */
function evaluate(expr: GuardExpr, domain: SpecModel, tables: readonly DataTableSpec[]): Truth {
  switch (expr.kind) {
    case 'and': {
      const left = evaluate(expr.left, domain, tables);
      const right = evaluate(expr.right, domain, tables);
      if (left === false || right === false) return false;
      return left === true && right === true ? true : null;
    }
    case 'or': {
      const left = evaluate(expr.left, domain, tables);
      const right = evaluate(expr.right, domain, tables);
      if (left === true || right === true) return true;
      return left === false && right === false ? false : null;
    }
    case 'not': {
      const operand = evaluate(expr.operand, domain, tables);
      return operand === null ? null : !operand;
    }
    case 'compare': {
      if (expr.rhs.kind === 'path' || (expr.op !== '==' && expr.op !== '!=')) return null;
      const value = worldValueOf(expr.path, domain, tables);
      if (value === undefined) return null;
      const equal = value === literalOf(expr.rhs);
      return expr.op === '==' ? equal : !equal;
    }
    case 'in': {
      const value = worldValueOf(expr.path, domain, tables);
      return value === undefined ? null : expr.values.some((literal) => literalOf(literal) === value);
    }
    default:
      return null;
  }
}

/** リテラルの値(列挙・状態は記号の字面、真偽は true / false の字面を真偽に)。 */
function literalOf(literal: Literal): string | number | boolean {
  if (literal.kind === 'number') return literal.value;
  if (literal.value === 'true') return true;
  if (literal.value === 'false') return false;
  return literal.value;
}

/** world がその欄に置く値(`{集約}.{欄}` の 2 段だけ。決まらなければ undefined)。 */
function worldValueOf(path: PathRef, domain: SpecModel, tables: readonly DataTableSpec[]): string | boolean | undefined {
  const [entity, name, ...rest] = path.segments;
  if (entity === undefined || name === undefined || rest.length > 0) return undefined;
  const field = findEntitySpec(domain, entity)?.fields.find((candidate) => candidate.name === name);
  if (field === undefined) return undefined;
  if (field.type.kind === 'state') {
    const machineName = field.type.machine;
    return findStateMachines(domain, entity).find((machine) => machine.machine === machineName)?.initial;
  }
  const defaults = tables.find((table) => table.entity === entity)?.defaults ?? {};
  // 値を置くのは必須の欄だけ(任意の欄は置かないことがある = 空)。
  if (!isValueSupplied(field, defaults) || !field.required) return undefined;
  if (field.type.kind === 'enum') return field.type.values[0];
  if (field.type.kind === 'boolean') return false;
  return undefined;
}
