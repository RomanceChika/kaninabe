/**
 * 不変条件の**形式定義の式**(`formal.type: check` の式・`state_dependency` は `not (前提) or (帰結)`)を 1 本の式として読む。
 *
 * 行の CHECK の写像(`sql/check-expression.ts`)・参照の欄が指す行を読む条件の判定(`model/data/ref-check-shape.ts`)・書き込みの端の覆い
 * (`sql/ddl-ref-check-edges.ts`)が同じ 1 本を呼ぶ(読み方を 2 か所に書くと片方だけが直る)。判定が SQL の層の下(前段)にあるのは、
 * 文書の生成器も相手の端の計画を読むためである(`ref-check-shape.ts` の冒頭)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { parseFormalGuard } from '../guard/parser.js';
import type { InvariantDef } from './types.js';

/**
 * 形式定義の式。
 *
 * @param formal 形式定義(check / state_dependency)
 * @returns パースの結果
 */
export function formalExpr(formal: Extract<NonNullable<InvariantDef['formal']>, { readonly kind: 'check' | 'state_dependency' }>): ReturnType<typeof parseFormalGuard> {
  if (formal.kind === 'check') return parseFormalGuard(formal.expr);
  const premise = parseFormalGuard(formal.if);
  if (!premise.ok) return premise;
  const conclusion = parseFormalGuard(formal.then);
  if (!conclusion.ok) return conclusion;
  return { ok: true, expr: { kind: 'or', left: { kind: 'not', operand: premise.expr }, right: conclusion.expr } };
}
