/**
 * 有料の口のメソッドの**本体の文の並びの許可表**(`paid-entry-scan.ts` の 1b。点検 6 回目 B6-1)。
 *
 * 入口(`runPaidEntry`)の前に任意の文を許すかぎり、見張りの生成テストが送る 1 種類の要求では閉世界にならない —— 送らないヘッダ・本文・
 * クエリで分岐して、認可・本文の上限・枠の消費・拒否の行の全部を飛ばせる(探り台本 probe1 の `x-preview-key`)。そこで本体を次の形だけに絞る:
 *
 *   - 式の本体・1 文: `入口(…)` / `関門(request, …) ?? 入口(…)`
 *   - 2 文: `const r = 関門(request, …);` + `return r ?? 入口(…);`
 *   - 3 文: `const r = 関門(request, …);` + `if (r !== null) return r;` + `return 入口(…);`
 *
 * 関門は出どころの確認(`refuseCrossOrigin`)で、形と「引数が副作用を持たない」の判定は J2 と同じ `route-origin-guard.ts` の部品を使う。
 * 入口の呼び出しかどうかは呼び手(import の束縛を持つ走査)が述語で渡す。純粋関数であり throw しない。
 */

import ts from 'typescript';
import { unwrap } from '../semantics/guard-ast.js';
import { originGuardParts, REQUEST_ORIGIN_GUARD } from '../semantics/route-origin-guard.js';
import type { OriginGuardParts } from '../semantics/route-origin-guard.js';

/** 入口の呼び出しかの述語(本物の import に解決できるもの)。 */
type EntryPredicate = (call: ts.CallExpression) => boolean;

/** 式が、共通の入口の呼び出しそのもの(`await`・括弧・型の注記だけを剥がす。`??` は剥がさない)か。 */
function isBareEntry(expression: ts.Expression, isEntry: EntryPredicate): boolean {
  let inner = unwrap(expression);
  while (ts.isAwaitExpression(inner) || ts.isParenthesizedExpression(inner)) inner = unwrap(inner.expression);
  return ts.isCallExpression(inner) && isEntry(inner);
}

/** 返す式が `入口(…)` か、`左 ?? 入口(…)`(左は関門の呼び出し、`name` があればその名前)か。 */
function isEntryTail(expression: ts.Expression, isEntry: EntryPredicate, guard: OriginGuardParts, name: string | null): boolean {
  if (name === null && isBareEntry(expression, isEntry)) return true;
  const value = unwrap(expression);
  if (!ts.isBinaryExpression(value) || value.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) return false;
  const left = unwrap(value.left);
  const leftOk = name === null ? guard.isGuardCall(left) : ts.isIdentifier(left) && left.text === name;
  return leftOk && isBareEntry(value.right, isEntry);
}

/** `return 式;` の式(それ以外の文は undefined)。 */
function returnOf(statement: ts.Statement | undefined): ts.Expression | undefined {
  return statement !== undefined && ts.isReturnStatement(statement) ? statement.expression : undefined;
}

/**
 * 本体が許可表のどれかか(出どころの確認と `return 入口(…)` のほかに文・式を持たない)。
 *
 * @param body メソッドの本体
 * @param file 構文木(関門の import の束縛を引く)
 * @param request メソッドが受けた要求の引数の名前
 * @param isEntry 入口の呼び出しかの述語
 * @returns 許可表のどれかなら true
 */
export function isAllowedPaidBody(body: ts.ConciseBody, file: ts.SourceFile, request: string, isEntry: EntryPredicate): boolean {
  const guard = originGuardParts(file, request, REQUEST_ORIGIN_GUARD);
  if (!ts.isBlock(body)) return isEntryTail(body, isEntry, guard, null);
  const [first, second, third, ...more] = body.statements;
  if (more.length > 0 || first === undefined) return false;
  if (second === undefined) {
    const value = returnOf(first);
    return value !== undefined && isEntryTail(value, isEntry, guard, null);
  }
  const name = guard.guardedConst(first);
  if (name === null) return false;
  if (third === undefined) {
    const value = returnOf(second);
    return value !== undefined && isEntryTail(value, isEntry, guard, name);
  }
  const value = returnOf(third);
  return guard.returnsIfPresent(second, name) && value !== undefined && isBareEntry(value, isEntry);
}
