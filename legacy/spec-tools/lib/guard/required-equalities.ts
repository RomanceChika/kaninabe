/**
 * 式が**必ず成り立たせる等式**(トップレベルの `and` の項になっている `パス == パス`)の列挙。
 *
 * 「式が 2 つの欄を結んでいる」と言えるのは、その 2 つの欄の等式が `and` の必須の項のときだけである。
 * 式の中に 2 つの欄が**現れる**だけでは、結んだことにならない —— `!=`・`or` の片側(もう片方が恒真なら素通り)・
 * `not (a == b)`・無関係な比較が別々に並ぶ形は、どれも「2 つの欄が出てくる」が一致を保証しない。
 * 別の集約の列との等式をトリガに写す側(`sql/cross-check-plan.ts`)は式の全体を DB に写す —— 式が 2 つの欄を結ぶ形で
 * あることは生成の前提ではない。それを「持ち主の付け替えを塞ぐ」と**数える**側(`verify/verifiers/v26-write-retarget.ts`)
 * は、写される式のうち**等式として必須の項**だけを根拠にする。その読み方がここの 1 本である。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { GuardExpr } from './ast.js';

/** 等式 1 本(辺の順は式のとおり。向きは意味を持たない)。 */
export type EqualityPair = readonly [string, string];

/** トップレベルの `and` の項(`or` / `not` の中は項に数えない)。式のとおりの順。 */
export function conjunctsOfExpr(expr: GuardExpr): readonly GuardExpr[] {
  if (expr.kind !== 'and') return [expr];
  return [...conjunctsOfExpr(expr.left), ...conjunctsOfExpr(expr.right)];
}

/**
 * 式が必ず成り立たせる等式(`and` の項になっている `パス == パス`)。
 *
 * リテラルとの比較・`==` 以外の演算子・`or` / `not` の中の等式は数えない。
 *
 * @param expr パース済みの式
 * @returns 辺を `a.b` に連ねた等式の列
 */
export function requiredEqualities(expr: GuardExpr): readonly EqualityPair[] {
  const pairs: EqualityPair[] = [];
  for (const term of conjunctsOfExpr(expr)) {
    if (term.kind !== 'compare' || term.op !== '==' || term.rhs.kind !== 'path') continue;
    pairs.push([term.path.segments.join('.'), term.rhs.path.segments.join('.')]);
  }
  return pairs;
}

/** その 2 つの欄が、必須の等式で結ばれているか(辺の向きは問わない)。 */
export function equatesPaths(expr: GuardExpr, first: string, second: string): boolean {
  return requiredEqualities(expr).some(([left, right]) => (left === first && right === second) || (left === second && right === first));
}
