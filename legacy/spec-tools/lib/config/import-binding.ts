/**
 * 実装の木の走査で「**名前でなく束縛で見る**」ための部品(純関数)。
 *
 * 関門(`readConfigUrl` / `MarkdownView` / `renderMarkdown` / `plainTextOf`)は、字面に同じ名前があるだけでは関門とみなさない。
 * その識別子が **実行時パッケージの本物のモジュールからの値の import** に解決できるときだけ関門とする(別名の import は可)。
 * 同名のローカル関数・引数・props の分割代入・別モジュールの import は、関門ではない。
 */

import ts from 'typescript';

/** 許す import の 1 件(モジュールの指定子と、そこでの export 名)。 */
export interface ImportSpec {
  /** import 元のモジュールの指定子(例: `@kaninabe/runtime/url`)。 */
  readonly module: string;
  /** そのモジュールでの export 名(例: `readConfigUrl`)。 */
  readonly imported: string;
}

/** ファイル名からスクリプトの種類を決める(JSX を含みうるのは .tsx / .jsx だけ)。 */
function scriptKindOf(file: string): ts.ScriptKind {
  if (/\.tsx$/u.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/u.test(file)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/u.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * ソースを構文木にする。
 *
 * @param source ファイルの内容
 * @param file ファイル名(種類の判定にだけ使う)
 * @returns 構文木(親へのたどりつき)
 */
export function parseSource(source: string, file: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindOf(file));
}

/**
 * 許した import のうち、このファイルが**値として** import しているものの「ローカル名 → 許した import」。
 * 型だけの import(`import type` / `{ type X }`)・default import・名前空間 import は束縛と認めない。
 *
 * @param sourceFile 構文木
 * @param allowed 許す import
 * @returns ローカル名から許した import への対応
 */
export function allowedImports(sourceFile: ts.SourceFile, allowed: readonly ImportSpec[]): ReadonlyMap<string, ImportSpec> {
  const bound = new Map<string, ImportSpec>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly || clause.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      if (element.isTypeOnly) continue;
      const imported = (element.propertyName ?? element.name).text;
      const spec = allowed.find((entry) => entry.module === moduleName && entry.imported === imported);
      if (spec !== undefined) bound.set(element.name.text, spec);
    }
  }
  return bound;
}

/** 束縛の名前を、分割代入の入れ子も含めて集める。 */
function bindingNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(element.name, into);
}

/** 文の並びが宣言する名前(変数・関数・クラス)。 */
function declaredIn(statements: readonly ts.Statement[], into: Set<string>): void {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, into);
    else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name !== undefined) into.add(statement.name.text);
  }
}

/** 関数に準じるスコープ境界(`var` の巻き上げがここで止まる)。 */
function isVarScopeBoundary(node: ts.Node): boolean {
  return ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node);
}

/**
 * 関数の本体(またはファイル全体)の中で巻き上げられる名前を集める。
 *
 * - `var` は**入れ子のブロック(if / for / while / try / switch / ラベル付き)の中に書いても関数スコープ**で、書いた位置の前後を問わず
 *   その関数の全体で同名を隠す(外部レビュー: `if (true) { var stripControlChars = … } return stripControlChars(…)`)。
 * - ブロックの中の `function` 宣言も、緩いモードでは関数スコープへ巻き上がる。**保守的に隠すものとして数える**(隠す側に倒す = 本物と認めない側)。
 * - 入れ子の関数・クラスの本体は渡らない(別のスコープの `var` は外側を隠さない)。関数宣言の**名前**だけは、それを含むスコープの名前に数える。
 */
function collectHoisted(root: ts.Node, into: Set<string>): void {
  ts.forEachChild(root, (child) => {
    if (ts.isFunctionDeclaration(child)) {
      if (child.name !== undefined) into.add(child.name.text);
      return;
    }
    if (isVarScopeBoundary(child)) return;
    if (ts.isVariableDeclarationList(child) && (child.flags & ts.NodeFlags.BlockScoped) === 0) {
      for (const declaration of child.declarations) bindingNames(declaration.name, into);
    }
    collectHoisted(child, into);
  });
}

/**
 * ある位置の識別子が、import より内側のスコープで同名の宣言(引数・変数・関数・catch 変数・for の変数)に隠されているか。
 *
 * @param node 識別子の位置
 * @param name 識別子の名前
 * @returns 隠されていれば true
 */
export function isShadowed(node: ts.Node, name: string): boolean {
  for (let current: ts.Node | undefined = node.parent; current !== undefined; current = current.parent) {
    const names = new Set<string>();
    if (ts.isFunctionLike(current)) for (const parameter of current.parameters) bindingNames(parameter.name, names);
    // 名前つきの関数式・クラス式は、自分の本体の中で自分の名前を束縛する(外部レビュー: `(function readConfigUrl(…) { … readConfigUrl(…) })`)。
    if ((ts.isFunctionExpression(current) || ts.isClassExpression(current)) && current.name !== undefined) names.add(current.name.text);
    if (ts.isBlock(current) || ts.isModuleBlock(current) || ts.isCaseClause(current) || ts.isDefaultClause(current)) declaredIn(current.statements, names);
    if (ts.isCatchClause(current) && current.variableDeclaration !== undefined) bindingNames(current.variableDeclaration.name, names);
    if ((ts.isForStatement(current) || ts.isForInStatement(current) || ts.isForOfStatement(current)) && current.initializer !== undefined && ts.isVariableDeclarationList(current.initializer)) {
      for (const declaration of current.initializer.declarations) bindingNames(declaration.name, names);
    }
    // 巻き上げられる名前(入れ子ブロックの `var`・ブロック内の関数宣言)は、関数(またはファイル)の全体で隠す。位置の前後は問わない。
    if (ts.isSourceFile(current) || isVarScopeBoundary(current)) collectHoisted(current, names);
    if (names.has(name) || ts.isSourceFile(current)) return names.has(name);
  }
  return false;
}

/**
 * 識別子が、許した import の束縛に解決できるか。
 *
 * @param node 識別子
 * @param bound `allowedImports` の結果
 * @returns 解決できればその import、できなければ null
 */
export function resolveImport(node: ts.Identifier, bound: ReadonlyMap<string, ImportSpec>): ImportSpec | null {
  const spec = bound.get(node.text);
  return spec !== undefined && !isShadowed(node, node.text) ? spec : null;
}

/**
 * 構文木を深さ優先でたどる。
 *
 * @param node 起点
 * @param visit 各節で呼ぶ関数
 */
export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
