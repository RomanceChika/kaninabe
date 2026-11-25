/**
 * **手書きの入口の関門を構文木で見る検査の共通の目**(H6 の手書きの Server Action・J2 の cookie の口の Route Handler が同じものを使う)。
 *
 * 2 つの検査は「関門をどこで呼び、結果をどう使っているか」の形の求め方が違う(`guard-before-call.ts` = 本体より前に呼んで拒否なら返る /
 * `route-origin-guard.ts` = 最初の文で呼んでその結果を返す)が、その手前の材料は同じである。ここはその材料だけを持つ ——
 *
 *   - **import の束縛**: 局所名 → 指定子・元の export 名・束縛の種類(名前つき / 名前空間 / 既定)。型だけの import は数えない
 *   - **export した関数**: `export function f` / `export async function f` / `export const f = (…) => …`(関数式も)/
 *     `export { f }` / `export { g as f }`(同じファイルの関数)/ `export default function`。再輸出・高階関数の戻り値は関数として読めない。
 *     ただし Route Handler の出口の関所 `guardRoute(関数, …)`(`@kaninabe/runtime/http/route-guard` から値として import した名前)だけは
 *     **素通しの包み**として中の関数を読む(関所は口の本体を変えず、応答の行き先の見出しを見るだけ。点検 10 回目 B10-1)
 *   - **関門の呼び出し**: 関門のモジュールから値として import した名前(別名の import を含む)か、名前空間の import の `ns.名前` の呼び出し。
 *     既定の import の性質(`d.名前`)は数えない(関門のモジュールの公開の口は名前つきの export だけ)
 *
 * 純粋関数であり throw しない。
 */

import ts from 'typescript';

/** 関門の部品(モジュール指定と、関門として数える export 名)。 */
export interface GuardSpec {
  readonly module: string;
  readonly names: readonly string[];
}

/** import の束縛 1 つ。`imported` は名前つきの import の元の export 名(名前空間・既定は null)。 */
export interface Binding {
  readonly specifier: string;
  readonly kind: 'named' | 'namespace' | 'default';
  readonly imported: string | null;
}

/** 関数として読める節(宣言・矢印関数・関数式)。 */
export type FunctionNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

/** 本文を構文木にする。 */
export function parseModule(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
}

/** 値として束縛される import の局所名。 */
export function importBindings(file: ts.SourceFile): ReadonlyMap<string, Binding> {
  const bindings = new Map<string, Binding>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    if (clause.name !== undefined) bindings.set(clause.name.text, { specifier, kind: 'default', imported: null });
    const named = clause.namedBindings;
    if (named !== undefined && ts.isNamespaceImport(named)) bindings.set(named.name.text, { specifier, kind: 'namespace', imported: null });
    if (named !== undefined && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (!element.isTypeOnly) bindings.set(element.name.text, { specifier, kind: 'named', imported: (element.propertyName ?? element.name).text });
      }
    }
  }
  return bindings;
}

/** Route Handler の出口の関所(素通しの包み。J2 が全部の口にこの形を要求する)。 */
export const ROUTE_GUARD: GuardSpec = { module: '@kaninabe/runtime/http/route-guard', names: ['guardRoute'] };

/** 関数として扱う式(矢印関数・関数式。`guardRoute(関数, …)` の包みは中の関数)。 */
function functionOf(node: ts.Expression | undefined, bindings: ReadonlyMap<string, Binding>): ts.ArrowFunction | ts.FunctionExpression | undefined {
  if (node === undefined) return undefined;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
  const call = guardCall(node, bindings, ROUTE_GUARD);
  const inner = call?.arguments[0];
  return inner !== undefined && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) ? inner : undefined;
}

/** 文に指定の修飾子があるか。 */
function hasModifier(statement: ts.Statement, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === kind);
}

/** 同じファイルの最上位の関数(宣言・`const f = 関数`)。同じ名前は先に現れたもの。 */
function localFunctions(file: ts.SourceFile, bindings: ReadonlyMap<string, Binding>): ReadonlyMap<string, FunctionNode> {
  const functions = new Map<string, FunctionNode>();
  const add = (name: string, fn: FunctionNode): void => {
    if (!functions.has(name)) functions.set(name, fn);
  };
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) add(statement.name.text, statement);
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const fn = functionOf(declaration.initializer, bindings);
      if (ts.isIdentifier(declaration.name) && fn !== undefined) add(declaration.name.text, fn);
    }
  }
  return functions;
}

/** export した関数(export の名前と関数。ファイルの順。多重定義の宣言は本体の無いものも並ぶ)。 */
export function exportedFunctions(file: ts.SourceFile): readonly (readonly [string, FunctionNode])[] {
  const bindings = importBindings(file);
  const locals = localFunctions(file, bindings);
  const exported: [string, FunctionNode][] = [];
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      exported.push([hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? 'default' : (statement.name?.text ?? 'default'), statement]);
    }
    if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        const fn = functionOf(declaration.initializer, bindings);
        if (ts.isIdentifier(declaration.name) && fn !== undefined) exported.push([declaration.name.text, fn]);
      }
    }
    const clause = ts.isExportDeclaration(statement) && statement.moduleSpecifier === undefined && !statement.isTypeOnly ? statement.exportClause : undefined;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      const fn = locals.get((element.propertyName ?? element.name).text);
      if (!element.isTypeOnly && fn !== undefined) exported.push([element.name.text, fn]);
    }
  }
  return exported;
}

/** 括弧を外す。 */
export function unwrap(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression;
}

/** `node` の中に条件を満たす節があるか(`intoFunctions` が偽なら入れ子の関数の中は見ない)。 */
export function contains(node: ts.Node, test: (node: ts.Node) => boolean, intoFunctions: boolean): boolean {
  if (!intoFunctions && ts.isFunctionLike(node)) return false;
  if (test(node)) return true;
  return ts.forEachChild(node, (child) => (contains(child, test, intoFunctions) ? true : undefined)) === true;
}

/** 節が関門の呼び出し(括弧は外す)なら、その呼び出し。 */
export function guardCall(node: ts.Node, bindings: ReadonlyMap<string, Binding>, guard: GuardSpec): ts.CallExpression | undefined {
  const call = ts.isParenthesizedExpression(node) ? unwrap(node) : node;
  if (!ts.isCallExpression(call)) return undefined;
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    const binding = bindings.get(callee.text);
    const named = binding?.kind === 'named' && binding.specifier === guard.module && binding.imported !== null && guard.names.includes(binding.imported);
    return named ? call : undefined;
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    const binding = bindings.get(callee.expression.text);
    const namespaced = binding?.kind === 'namespace' && binding.specifier === guard.module && guard.names.includes(callee.name.text);
    return namespaced ? call : undefined;
  }
  return undefined;
}
