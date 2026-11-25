/**
 * ガード式 AST(docs 側)→ エンジンが解釈する GuardExprData(app 側)への写像。
 *
 * 2 つの表現の違いは「パスの持ち方」だけである。docs 側は PathRef(セグメント配列)で
 * 持つが、エンジン側はデータとして扱いやすいドット文字列("workshop.state")で持つ。
 * それ以外のノード構造(and / or / not / compare / in / contains)は 1 対 1 に対応する。
 *
 * `x not in [...]` はパーサーが not(in) の入れ子として返すため、ここでも not ノードのまま
 * 写す(エンジン側に「否定付き in」を作らない)。
 *
 * **エンジンに反映できない節点が 1 つある** —— `is null`(束 ㉒)である。この語は不変条件の
 * `formal` にだけ書ける約束であり、`formal` の式は TS の評価器に反映されない。したがってここへ
 * 来ることはない(ガードを読む口のパーサーはこの原子を受け取らず、`is null` と書かれた
 * ガードは**パースの段で落ちる**)。万一来たら `null` を返して**黙って「ガード省略」に
 * 縮退しない**ための口にする —— 呼び側はパース不能と同じ扱い、つまり `guardSource` だけを
 * 残す形に倒し、エンジンが「知らない節点」を実行時に踏むことがないようにする。
 */

import type { CompareRhs, GuardExpr, Literal, PathRef } from './ast.js';
import type { GuardExprData } from '@kaninabe/runtime/engine';

/**
 * ガード式 AST を、エンジンの `GuardExprData` に変換する。
 * 戻り値は renderLiteral でそのまま TS のリテラル式にできる。
 *
 * @param expr パース済みのガード式
 * @returns エンジンが読むデータ。反映できない節点(`is null`)を含むなら `null`
 */
export function guardExprData(expr: GuardExpr): GuardExprData | null {
  switch (expr.kind) {
    case 'and':
    case 'or': {
      const left = guardExprData(expr.left);
      const right = guardExprData(expr.right);
      return left === null || right === null ? null : { kind: expr.kind, left, right };
    }
    case 'not': {
      const operand = guardExprData(expr.operand);
      return operand === null ? null : { kind: 'not', operand };
    }
    case 'compare':
      return { kind: 'compare', path: pathString(expr.path), op: expr.op, rhs: rhsData(expr.rhs) };
    case 'in':
      return { kind: 'in', path: pathString(expr.path), values: expr.values.map(literalValue) };
    case 'contains':
      return { kind: 'contains', path: pathString(expr.path), ref: pathString(expr.ref) };
    case 'null':
      return null;
  }
}

/** PathRef をエンジン側の表現(ドット区切り文字列)にする。 */
function pathString(path: PathRef): string {
  return path.segments.join('.');
}

/** 比較の右辺。リテラルは {kind:'literal'}、パスは {kind:'path'} でタグ付けする。 */
function rhsData(rhs: CompareRhs): Extract<GuardExprData, { kind: 'compare' }>['rhs'] {
  return rhs.kind === 'path'
    ? { kind: 'path', path: pathString(rhs.path) }
    : { kind: 'literal', value: literalValue(rhs) };
}

/** リテラルの素の値(number ならそのまま、symbol は文字列)。 */
function literalValue(literal: Literal): string | number {
  return literal.value;
}
