/**
 * 有料の口の走査(`paid-entry-scan.ts`)が使う、構文木の小さな読み方(式の皮むき・字句・オプションの写像・参照の位置)。
 * 判定は持たない。純粋関数であり throw しない。
 */

import ts from 'typescript';

/** await・括弧・型の注記を剥がす。 */
export function peel(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) return peel(expression.expression);
  if (ts.isAwaitExpression(expression)) return peel(expression.expression);
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)) return peel(expression.expression);
  // 出どころの確認 `refuseCrossOrigin(…) ?? 本体` の本体側。
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return peel(expression.right);
  return expression;
}

/** 本体が返す式(ブロックなら最後の文の `return` の式)。 */
export function returnedExpression(body: ts.ConciseBody): ts.Expression | undefined {
  if (!ts.isBlock(body)) return body;
  const last = body.statements[body.statements.length - 1];
  return last !== undefined && ts.isReturnStatement(last) ? last.expression : undefined;
}

/** 文字列の字句か(`'…'` と置換なしのテンプレート)の値。 */
export function literalText(node: ts.Expression): string | null {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

/**
 * プロパティ名の、実行時の鍵としての名前(識別子 `a`・文字列 `'a'` / `"a"`・数 `1` / `1.0` を同じ名前に畳む)。
 * 字面(`getText()`)で数えると、識別子の `bindings` と文字列の `'bindings'` が別の鍵になり、後勝ちの重複を見落とす(点検 4 回目 B4-2)。
 * 名前を読み切れない形(算出キー)は null。
 */
function propertyKeyOf(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return String(Number(name.text));
  return null;
}

/**
 * 呼び出しオプションの写像(スプレッド・算出キー・**同じ名前の重複**があれば null)。
 * 重複は実行時に後勝ちで上書きされるので、検査が見た値と実際に渡る値が食い違う(`@ts-expect-error` で型の重複の指摘を黙らせた形も含む)。
 */
export function optionsOf(object: ts.ObjectLiteralExpression): ReadonlyMap<string, ts.ObjectLiteralElementLike> | null {
  const options = new Map<string, ts.ObjectLiteralElementLike>();
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property) || property.name === undefined) return null;
    const key = propertyKeyOf(property.name);
    if (key === null || options.has(key)) return null;
    options.set(key, property);
  }
  return options;
}

/** プロパティの値の式(メソッド記法は null)。 */
export function valueOf(property: ts.ObjectLiteralElementLike | undefined): ts.Expression | null {
  return property !== undefined && ts.isPropertyAssignment(property) ? property.initializer : null;
}

/** 識別子が、名前を**参照**している位置か(プロパティ名・宣言の名前・型の位置は参照ではない)。 */
export function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isExportSpecifier(parent)) return (parent.propertyName ?? parent.name) === node;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  return (parent as { readonly name?: ts.Node }).name !== node;
}

/** `node` が `container` の中にあるか。 */
export function isInside(node: ts.Node, container: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) if (current === container) return true;
  return false;
}
