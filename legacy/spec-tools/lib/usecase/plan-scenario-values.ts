/**
 * 生成テストの**値の世界**(束 ⑰-3)—— ガード式を満たす / 満たさない割当を仕様から探す。
 *
 * 実行計画は「何を読み、どのロールをどう解決し、どのガード式を見るか」を宣言しているが、
 * **その宣言を満たす具体的な値**は持っていない。生成テストはその値を要る ——「受付中の催しを
 * 世話役が中止できる」を確かめるには `workshop.state = accepting` が要る。ここはその値を、
 * ドメイン仕様(欄の型・状態機械の状態・ガード式)から機械的に選ぶ。
 *
 * **ガード式の評価器をここに 1 つ持つ**のは意図である。実行時の評価器(`domain/engine/guard.ts`)と
 * 同じ答えを出すことを確かめるのが生成テストの役目であり、そのためには**独立した 2 つ目の
 * 読み手**が要る(同じ関数を呼んで比べても何も確かめたことにならない)。文法の正は
 * domain-spec-writing.md §ガード式の文法 の 1 つであり、両者はその写像である。
 *
 * ファイル I/O はしない純関数(scripts-code-quality.md)。**アプリの語彙は 1 語も持たない。**
 */

import type { GuardExpr, Literal, PathRef } from '../guard/ast.js';
import type { FieldDef, FieldType } from '../model/types.js';
import type { FieldBounds } from './field-bounds.js';
import { withinBounds } from './field-bounds.js';

/** 割当 1 つ(ガード式の変数 → 値)。実行時の `GuardEnv` と同じ形。 */
export type ScenarioValue = string | number | boolean | null;

/** 変数 → 値。 */
export type Assignment = Readonly<Record<string, ScenarioValue>>;

/** 3 値論理の評価結果(`'unknown'` = 評価できなかった)。 */
export type GuardVerdict = boolean | 'unknown';

/** 判断材料としての現在時刻(生成テストの時計はここに固定する)。 */
export const SCENARIO_NOW = '2027-06-01T00:00:00.000Z';

/** 現在時刻より前の日時(「締切を過ぎている」を作る値)。 */
export const SCENARIO_PAST = '2026-01-01T00:00:00.000Z';

/** 現在時刻より後の日時(「まだ締切前」を作る値)。 */
export const SCENARIO_FUTURE = '2028-01-01T00:00:00.000Z';

/** パス参照を `a.b` の字面にする。 */
export function pathText(path: PathRef): string {
  return path.segments.join('.');
}

/** リテラルを値にする。 */
function literalValue(literal: Literal): ScenarioValue {
  return literal.kind === 'number' ? literal.value : literal.value;
}

/** 3 値の AND(片方が偽なら偽)。 */
function and(left: GuardVerdict, right: GuardVerdict): GuardVerdict {
  if (left === false || right === false) return false;
  if (left === true && right === true) return true;
  return 'unknown';
}

/** 3 値の OR(片方が真なら真)。 */
function or(left: GuardVerdict, right: GuardVerdict): GuardVerdict {
  if (left === true || right === true) return true;
  if (left === false && right === false) return false;
  return 'unknown';
}

/** 割当から値を取り出す(未定義と `null` はどちらも「取り出せなかった」)。 */
function lookup(env: Assignment, key: string): Exclude<ScenarioValue, null> | undefined {
  const value = env[key];
  return value === null || value === undefined ? undefined : value;
}

/** 真偽値に読めるか(裸トークンの `true` / `false` も受ける)。 */
function asBoolean(value: Exclude<ScenarioValue, null>): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** 2 値の比較(型が揃う場合だけ判定する)。 */
function compareValues(
  left: Exclude<ScenarioValue, null>,
  op: string,
  right: Exclude<ScenarioValue, null>,
): GuardVerdict {
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    const a = asBoolean(left);
    const b = asBoolean(right);
    if (a === undefined || b === undefined) return 'unknown';
    if (op === '==') return a === b;
    if (op === '!=') return a !== b;
    return 'unknown';
  }
  if (typeof left !== typeof right) return 'unknown';
  if (op === '==') return left === right;
  if (op === '!=') return left !== right;
  const rank = left === right ? 0 : left < right ? -1 : 1;
  if (op === '<') return rank < 0;
  if (op === '<=') return rank <= 0;
  if (op === '>') return rank > 0;
  return rank >= 0;
}

/**
 * ガード式を割当の下で評価する(3 値論理)。
 *
 * @param expr ガード式の AST
 * @param env 変数 → 値
 * @returns 成立なら true、不成立なら false、評価できなければ `'unknown'`
 */
export function evaluate(expr: GuardExpr, env: Assignment): GuardVerdict {
  switch (expr.kind) {
    case 'and':
      return and(evaluate(expr.left, env), evaluate(expr.right, env));
    case 'or':
      return or(evaluate(expr.left, env), evaluate(expr.right, env));
    case 'not': {
      const operand = evaluate(expr.operand, env);
      return operand === 'unknown' ? 'unknown' : !operand;
    }
    case 'compare': {
      const left = lookup(env, pathText(expr.path));
      const right =
        expr.rhs.kind === 'path' ? lookup(env, pathText(expr.rhs.path)) : literalValue(expr.rhs);
      if (left === undefined || right === undefined || right === null) return 'unknown';
      return compareValues(left, expr.op, right);
    }
    case 'in': {
      const left = lookup(env, pathText(expr.path));
      if (left === undefined || typeof left === 'boolean') return 'unknown';
      const values = expr.values.map(literalValue);
      if (values.some((value) => value === left)) return true;
      return values.some((value) => typeof value === typeof left) ? false : 'unknown';
    }
    default:
      // `contains` は集合の所属であり、実行器が真偽値として解決する契約である
      // (`domain/engine/guard.ts` の `containsKey`)。計画の `guardFacts` には現れないので、
      // ここに来る割当も無い —— 評価できないものとして扱う。
      return 'unknown';
  }
}

/** 式に現れる変数(`contains` は解決済みの鍵を数えない)。 */
export function variablesOf(expr: GuardExpr, into: Set<string> = new Set()): ReadonlySet<string> {
  switch (expr.kind) {
    case 'and':
    case 'or':
      variablesOf(expr.left, into);
      variablesOf(expr.right, into);
      return into;
    case 'not':
      return variablesOf(expr.operand, into);
    case 'compare':
      into.add(pathText(expr.path));
      if (expr.rhs.kind === 'path') into.add(pathText(expr.rhs.path));
      return into;
    case 'in':
      into.add(pathText(expr.path));
      return into;
    default:
      return into;
  }
}

/** 式に現れる数値リテラル(整数の候補を作る種)。 */
function numericLiterals(expr: GuardExpr, into: number[] = []): readonly number[] {
  switch (expr.kind) {
    case 'and':
    case 'or':
      numericLiterals(expr.left, into);
      numericLiterals(expr.right, into);
      return into;
    case 'not':
      return numericLiterals(expr.operand, into);
    case 'compare':
      if (expr.rhs.kind === 'number') into.push(expr.rhs.value);
      return into;
    case 'in':
      for (const value of expr.values) if (value.kind === 'number') into.push(value.value);
      return into;
    default:
      return into;
  }
}

/**
 * 欄の型から、その欄が取りうる値の候補を作る。
 *
 * 有限の型(状態・列挙・真偽)は**全部**、順序のある型は 2 点(現在時刻の前と後・リテラルの
 * 前後)だけを並べる。日時が 2 点でよいのは、ガード式が日時に対してできるのが順序比較だけ
 * だからである(V9 の判定能力と同じ線)。数は**欄が宣言した範囲で切る**(`withinBounds`)。
 *
 * @param type 欄の型(無ければ不透明な値として扱う)
 * @param states 状態機械の状態(`state(...)` 型のときに使う)
 * @param seeds 式に現れる数値リテラル(整数の候補を作る種)
 * @param bounds 欄が宣言した値の範囲(省略すると切らない)
 * @returns 候補の値(空にはならない)
 */
export function candidatesOf(
  type: FieldType | null,
  states: readonly string[],
  seeds: readonly number[],
  bounds: FieldBounds = {},
): readonly ScenarioValue[] {
  if (type === null) return [SCENARIO_PAST, SCENARIO_FUTURE];
  switch (type.kind) {
    case 'state':
      return states.length > 0 ? states : ['unknown_state'];
    case 'enum':
      return type.values;
    case 'boolean':
      return [true, false];
    case 'integer':
    case 'decimal':
      return withinBounds([...new Set([0, ...seeds.flatMap((seed) => [seed - 1, seed, seed + 1])])], bounds);
    case 'date':
    case 'datetime':
      return [SCENARIO_PAST, SCENARIO_FUTURE];
    default:
      return ['a', 'b'];
  }
}

/** 欄の型を候補に写すときの種(式の数値リテラル)。 */
export function seedsOf(expr: GuardExpr | null): readonly number[] {
  return expr === null ? [] : numericLiterals(expr);
}

/** 変数 1 つと、その候補値。 */
export interface ScenarioVariable {
  readonly key: string;
  readonly candidates: readonly ScenarioValue[];
}

/**
 * 候補の直積を走査し、望む真偽になる最初の割当を返す(無ければ null)。
 *
 * 変数は多くて 3〜4 本・候補はそれぞれ 2〜10 個なので、全列挙で足りる(探索の道具を
 * 持ち込むほどの空間ではない)。`unknown` は**望む真偽と一致しない**として扱う ——
 * 評価できない割当を「満たさない例」として使うと、テストが `guard_unknown` を
 * `guard_unsatisfied` と取り違える。
 *
 * @param variables 変数と候補
 * @param expr ガード式(null は「常に真」)
 * @param want 望む真偽
 * @param fixed 固定済みの割当(状態など)
 * @returns 望む真偽になる割当、または null
 */
export function searchAssignment(
  variables: readonly ScenarioVariable[],
  expr: GuardExpr | null,
  want: boolean,
  fixed: Assignment = {},
): Assignment | null {
  if (expr === null) return want ? { ...fixed } : null;
  const total = variables.reduce((product, variable) => product * variable.candidates.length, 1);
  for (let index = 0; index < total; index += 1) {
    const env: Record<string, ScenarioValue> = { ...fixed };
    let rest = index;
    for (const variable of variables) {
      const size = variable.candidates.length;
      env[variable.key] = variable.candidates[rest % size] ?? null;
      rest = Math.floor(rest / size);
    }
    if (evaluate(expr, env) === want) return env;
  }
  return null;
}

/** 欄の型に合う「意味のない既定値」(ガードが見ない欄を埋めるためのもの)。 */
export function placeholderOf(field: FieldDef | null): ScenarioValue {
  if (field === null) return null;
  switch (field.type.kind) {
    case 'boolean':
      return false;
    case 'integer':
    case 'decimal':
      // 範囲の**両辺**を見る(`min` だけを見ると `max: -1` のような欄に 0 を置いてしまう)。
      return field.min ?? Math.min(0, field.max ?? 0);
    case 'date':
    case 'datetime':
      return SCENARIO_FUTURE;
    case 'enum':
      return field.type.values[0] ?? null;
    default:
      return field.required ? 'x' : null;
  }
}
