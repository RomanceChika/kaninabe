/**
 * 1 本のソースの中で、**実際に使われている import** の指定子を AST で求める(閉包の「起点の束縛を絞る」ための目)。
 *
 * `import-closure.ts` の閉包は import の**辺**で作るので、`import { A }` と `import { B }` を並べて片方だけ
 * 呼んでも、使わない import が 1 本あっても、両方の先へ届く。C24 の鮮度の hash はそれでよい(import が
 * 変われば本文が変わるので hash も動く)が、「起動口が**何を呼ぶか**」を見たい J2 には広すぎる
 * (網の穴探し 2026-10-06 の独立レビュー m07a: 締切の口が料金の確定を import して、呼ぶのは確定だけ、が緑のまま通った)。
 *
 * ここが返すのは、次のどれかの形で**値として使われている**指定子である。
 *
 * - `import { A } from 'x'` / `import A from 'x'` / `import * as A from 'x'` / `import A = require('x')` の束縛が、
 *   式の位置に 1 度でも現れる(呼び出し `A()`・値として渡す `use(A)`・参照 `A.b`・`export { A }` のどれも使用)
 * - `export { … } from 'x'` / `export * from 'x'`(再輸出。値として外へ渡している)
 * - `import('x')` / `require('x')`(式そのものが読み込みの呼び出し)
 *
 * **使われていない**ものは数えない: 型だけの import(`import type`・全部 `type` の指定子)・副作用 import
 * (`import 'x'`。束縛が無いので「呼んでいる」とは言えない)・束縛はあるが 1 度も式に現れないもの・型の位置
 * (型注釈・`as T`・`typeof A` の型・`implements`)にしか現れないもの。
 *
 * 限界(下限): 束縛の**スコープは追わない**。内側のスコープで同じ名前を宣言し直していても、その名前を
 * 参照すれば使用に数える(使われていないものを使われたと数える側 = 「届く」と言う側に寄る)。
 * 純粋関数であり throw しない。
 */

import ts from 'typescript';
import { importsOfSource } from './import-graph.js';

/** import 宣言 1 本の、値として束縛される局所名(型だけの束縛は含まない)。 */
function localNamesOf(node: ts.ImportDeclaration): readonly string[] {
  const clause = node.importClause;
  if (clause === undefined || clause.isTypeOnly) return [];
  const bindings = clause.namedBindings;
  const named = bindings === undefined || !ts.isNamedImports(bindings) ? [] : bindings.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text);
  const namespace = bindings !== undefined && ts.isNamespaceImport(bindings) ? [bindings.name.text] : [];
  return [...(clause.name === undefined ? [] : [clause.name.text]), ...namespace, ...named];
}

/** 局所名 → 指定子(`import x = require('./a')` を含む)。型だけの束縛は載せない。 */
function bindingsOf(file: ts.SourceFile): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>();
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      for (const name of localNamesOf(statement)) bindings.set(name, statement.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      !statement.isTypeOnly &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      ts.isStringLiteral(statement.moduleReference.expression)
    ) {
      bindings.set(statement.name.text, statement.moduleReference.expression.text);
    }
  }
  return bindings;
}

/** クラスの `extends` の式(型の節の形をしているが、実行時に評価される値)。 */
function isClassExtends(node: ts.Node): node is ts.ExpressionWithTypeArguments {
  return (
    ts.isExpressionWithTypeArguments(node) &&
    ts.isHeritageClause(node.parent) &&
    node.parent.token === ts.SyntaxKind.ExtendsKeyword &&
    ts.isClassLike(node.parent.parent)
  );
}

/** この識別子は、名前を**参照**している位置か(プロパティ名・宣言の名前は参照ではない)。 */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isExportSpecifier(parent)) return (parent.propertyName ?? parent.name) === node;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  return (parent as { readonly name?: ts.Node }).name !== node;
}

/**
 * 1 ファイルの本文から、実際に使われている import の指定子を返す。
 *
 * @param fileName ファイル名(AST の診断用。中身の判定には使わない)
 * @param source 本文
 * @returns 値として使われている import の指定子の集合
 */
export function usedImportSpecifiers(fileName: string, source: string): ReadonlySet<string> {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const bindings = bindingsOf(file);
  const used = new Set<string>(
    importsOfSource(fileName, source)
      .filter((raw) => raw.opaque !== true && (raw.kind === 'reexport' || raw.kind === 'dynamic'))
      .map((raw) => raw.specifier),
  );
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) return;
    if (isClassExtends(node)) {
      visit(node.expression);
      return;
    }
    if (ts.isTypeNode(node)) return;
    const specifier = ts.isIdentifier(node) && isReference(node) ? bindings.get(node.text) : undefined;
    if (specifier !== undefined) used.add(specifier);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return used;
}
