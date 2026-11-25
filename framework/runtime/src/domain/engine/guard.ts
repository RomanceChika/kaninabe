/**
 * ガード式の評価器（3値論理）。
 *
 * 仕様のガード式は「path op literal / path op path / path in [...] / path contains path」を
 * `and` / `or` / `not` で結合したものに限られる（domain-spec-writing.md「ガード式の文法」）。
 * ここではそのASTを、実行時の値（`GuardEnv`）の下で評価する。
 *
 * **3値論理を採る理由**: 実行時には「値が渡ってきていない」「型が仕様と食い違う」が起こりうる。
 * これを false に潰すと「ガードが成立しなかった」と「評価できなかった」が区別できなくなり、
 * 呼び出し側がバグ（envの組み立て漏れ）と正常な拒否を取り違える。よって第3の値 `'unknown'`
 * を返し、拒否の分類（`guard_unsatisfied` / `guard_unknown`）で区別する。
 */

import type { GuardEnv, GuardExprData, GuardValue } from './types';

/** ガード評価の結果。`'unknown'` は「評価できなかった」（偽ではない）。 */
export type GuardResult = boolean | 'unknown';

/** 比較演算子。 */
type CompareOp = Extract<GuardExprData, { kind: 'compare' }>['op'];

/** 順序比較の演算子（`==` / `!=` を除いたもの）。 */
type OrderedOp = Exclude<CompareOp, '==' | '!='>;

/** envから取り出せた値（`null` = 値なし は含まない）。 */
type ResolvedValue = Exclude<GuardValue, null>;

/**
 * `contains` の判定に使うenvキーを組み立てる。
 *
 * `GuardEnv` の値はスカラーのみで集合を表現できない。例: `workshop.organizer_ids contains actor.id`
 * のような集合メンバーシップは**operation側が解決してboolean値としてenvに載せる**契約とし、
 * そのキーをこの関数で決める（呼び出し側が書式を推測しなくて済むように公開する）。
 *
 * @param path - 集合側のパス（例: `workshop.organizer_ids`）
 * @param ref - 要素側のパス（例: `actor.id`）
 * @returns envに載せるべきキー（例: `workshop.organizer_ids contains actor.id`）
 */
export function containsKey(path: string, ref: string): string {
  return `${path} contains ${ref}`;
}

/** 3値のAND。片方が偽なら偽（もう片方が評価不能でも確定する）。 */
function and(left: GuardResult, right: GuardResult): GuardResult {
  if (left === false || right === false) return false;
  if (left === true && right === true) return true;
  return 'unknown';
}

/** 3値のOR。片方が真なら真（もう片方が評価不能でも確定する）。 */
function or(left: GuardResult, right: GuardResult): GuardResult {
  if (left === true || right === true) return true;
  if (left === false && right === false) return false;
  return 'unknown';
}

/** 3値のNOT。評価不能の否定は評価不能。 */
function not(operand: GuardResult): GuardResult {
  return operand === 'unknown' ? 'unknown' : !operand;
}

/** envから値を取り出す。未定義と `null`（値なし）はどちらも「取り出せなかった」とする。 */
function lookup(env: GuardEnv, path: string): ResolvedValue | undefined {
  const value = env[path];
  return value === null || value === undefined ? undefined : value;
}

/**
 * boolean と、リテラル `true` / `false`（裸トークンなので文字列として届く）を突き合わせる。
 * 片側がbooleanのときだけ使う。合わせられなければ undefined。
 */
function asBoolean(value: ResolvedValue): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/**
 * ISO 8601 の日付・日時として読める字面。日時リテラルは裸トークンなので、
 * 識別子（例: `draft`）と区別できるのはこの形に当たるかどうかだけである。
 */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * 日時を**正規形**（`YYYY-MM-DDTHH:mm:ss.sssZ`）に畳む。
 *
 * 仕様に `2026-01-01T00:00:00Z`（小数部なし）と書き、envに `2026-01-01T00:00:00.000Z` が来ると、
 * 素朴な字句順では 19 文字目（`.` < `Z`）で**別物**になる — 一方 DB は timestamptz の時刻順で
 * 比べるので真になり、**DBだけが通す**。書式に依らない時刻の順序にするため、両辺が ISO 8601 と
 * して読めるときは正規形に畳んでから比べる（datetime.md §境界は ISO 8601）。
 *
 * @param value - 比較しようとしている文字列
 * @returns 正規形。ISO 8601 として読めなければ `undefined`
 */
function normalizedDatetime(value: string): string | undefined {
  if (!ISO_DATETIME.test(value)) return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/**
 * 同じ型の2値の順序を返す。string同士は字句順、number同士は数値順。
 *
 * 型が揃っていることは呼び出し側（`compareValues`）が確かめてから渡す契約であり、
 * ここでは再検査しない（揃わない組を弾く分岐はどの経路からも到達しない）。
 */
function orderedRank(left: string | number, right: string | number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * 文字列2値を比較用に揃える。**両方が ISO 8601 として読めるときだけ**正規形に畳む
 * （片方しか読めないなら日時どうしの比較ではないので、字面のまま比べる）。
 *
 * @param left - 左辺
 * @param right - 右辺
 * @returns 比較に使う2値
 */
function alignedStrings(left: string, right: string): readonly [string, string] {
  const a = normalizedDatetime(left);
  const b = normalizedDatetime(right);
  return a === undefined || b === undefined ? [left, right] : [a, b];
}

/** 順序の符号（`orderedRank` の戻り値）と演算子から真偽を決める。 */
function compareOrdered(rank: number, op: OrderedOp): boolean {
  switch (op) {
    case '<':
      return rank < 0;
    case '<=':
      return rank <= 0;
    case '>':
      return rank > 0;
    case '>=':
      return rank >= 0;
  }
}

/**
 * 2値の比較。**型が揃う場合のみ**判定し、揃わなければ `'unknown'` を返す。
 *
 * - string同士: 字句順で比較する。ただし**両辺が ISO 8601 として読めるときは正規形に畳んでから**
 *   比べる（`2026-01-01T00:00:00Z` と `…00.000Z` を同じ時刻として扱う。`normalizedDatetime`）。
 *   畳んだあとは字句順 = 時刻順であり、DB の timestamptz の順序と一致する。
 * - number同士: 数値順で比較する。
 * - boolean: `==` / `!=` のみ。順序比較は `'unknown'`。**`in` も `'unknown'`**（`evaluateIn`）——
 *   書けてしまうが常に不成立なので、仕様の側では V2 が error にする（domain-spec-writing.md）。
 */
function compareValues(left: ResolvedValue, op: CompareOp, right: ResolvedValue): GuardResult {
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    const a = asBoolean(left);
    const b = asBoolean(right);
    if (a === undefined || b === undefined) return 'unknown';
    if (op === '==') return a === b;
    if (op === '!=') return a !== b;
    return 'unknown';
  }
  if (typeof left !== typeof right) return 'unknown';
  const [a, b] =
    typeof left === 'string' && typeof right === 'string' ? alignedStrings(left, right) : [left, right];
  if (op === '==') return a === b;
  if (op === '!=') return a !== b;
  return compareOrdered(orderedRank(a, b), op);
}

/** `path op (literal | path)` を評価する。 */
function evaluateCompare(expr: Extract<GuardExprData, { kind: 'compare' }>, env: GuardEnv): GuardResult {
  const left = lookup(env, expr.path);
  const right = expr.rhs.kind === 'literal' ? expr.rhs.value : lookup(env, expr.rhs.path);
  if (left === undefined || right === undefined) return 'unknown';
  return compareValues(left, expr.op, right);
}

/**
 * `path in [...]` を評価する。
 * 候補のどれとも型が揃わない場合は「偽」ではなく `'unknown'`（仕様とenvの食い違いを隠さないため）。
 */
function evaluateIn(expr: Extract<GuardExprData, { kind: 'in' }>, env: GuardEnv): GuardResult {
  const left = lookup(env, expr.path);
  if (left === undefined || typeof left === 'boolean') return 'unknown';
  if (expr.values.some((value) => value === left)) return true;
  return expr.values.some((value) => typeof value === typeof left) ? false : 'unknown';
}

/** `path contains ref` を評価する。operationが解決済みのboolean（`containsKey` のキー）を読む。 */
function evaluateContains(expr: Extract<GuardExprData, { kind: 'contains' }>, env: GuardEnv): GuardResult {
  const resolved = lookup(env, containsKey(expr.path, expr.ref));
  return typeof resolved === 'boolean' ? resolved : 'unknown';
}

/**
 * ガード式を評価する。
 *
 * 評価不能（envに値が無い・型が揃わない・`contains` が未解決）は `'unknown'` を返す。
 * `and` / `or` は短絡的に確定できる場合は確定させる（`false and unknown` は `false`）。
 * `'unknown'` を拒否として扱うかは呼び出し側ではなく `canFire` が決める（拒否として扱う）。
 *
 * @param expr - ガード式のAST
 * @param env - パス文字列 → 実行時の値
 * @returns 成立なら `true`、不成立なら `false`、評価できなければ `'unknown'`
 */
export function evaluateGuard(expr: GuardExprData, env: GuardEnv): GuardResult {
  switch (expr.kind) {
    case 'and':
      return and(evaluateGuard(expr.left, env), evaluateGuard(expr.right, env));
    case 'or':
      return or(evaluateGuard(expr.left, env), evaluateGuard(expr.right, env));
    case 'not':
      return not(evaluateGuard(expr.operand, env));
    case 'compare':
      return evaluateCompare(expr, env);
    case 'in':
      return evaluateIn(expr, env);
    case 'contains':
      return evaluateContains(expr, env);
  }
}

/** 式が参照するenvキーを重複なく集める（`contains` は解決済みキーに読み替える）。 */
function collectKeys(expr: GuardExprData, into: Set<string>): void {
  switch (expr.kind) {
    case 'and':
    case 'or':
      collectKeys(expr.left, into);
      collectKeys(expr.right, into);
      return;
    case 'not':
      collectKeys(expr.operand, into);
      return;
    case 'compare':
      into.add(expr.path);
      if (expr.rhs.kind === 'path') into.add(expr.rhs.path);
      return;
    case 'in':
      into.add(expr.path);
      return;
    case 'contains':
      into.add(containsKey(expr.path, expr.ref));
      return;
  }
}

/**
 * 式が参照するパスのうち、envから値を取り出せなかったものを列挙する（診断用）。
 *
 * 空配列が返り、かつ評価結果が `'unknown'` だった場合は、
 * 「パスは揃っていたが型が仕様と食い違っていた」ことを意味する。
 *
 * @param expr - ガード式のAST
 * @param env - パス文字列 → 実行時の値
 * @returns 未解決のパス（出現順・重複なし）
 */
export function unresolvedPaths(expr: GuardExprData, env: GuardEnv): readonly string[] {
  const keys = new Set<string>();
  collectKeys(expr, keys);
  return [...keys].filter((key) => lookup(env, key) === undefined);
}
