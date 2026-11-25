/**
 * TypeScript のモジュールが **値として export している名前**を AST で求める。
 *
 * 「関数が実在するか」を本文の字面(`includes`)で見ると、コメントに名前が書いてあるだけ・別の関数の名前の一部・
 * export していない内部関数でも通る —— 呼び手(生成物・画面)が import できるかとは別の事実になる。ここは構文木から
 * export の一覧を取るので、**import できる名前**だけが返る。
 *
 * 数える形は、`export function f` / `export async function f` / `export class C` / `export enum E` / `export namespace N` /
 * `export import f = …` / `export const f = …` / `export { f }` / `export { g as f }` / `export { f } from '…'` /
 * `export * as f from '…'`(型だけの export・型だけの再輸出は除く)。純粋関数であり throw しない。
 *
 * **名前を数えられない形**(`export const { f } = …` の分割代入・`export * from '…'`)は名前の集合に入らない。
 * 入口の export(Route Handler の口)のように「数え漏れ = 検査の素通り」になる呼び手は、`unreadableExportForms` で
 * その形の有無を別に見て fail-closed にする(4 回目 C4-6)。**CommonJS の口**(`exports.GET = …`・`module.exports = …`・
 * `Object.assign(exports, …)`・`require(…)`)も同じく数えられない形として返す(Next.js は CommonJS の `exports.GET` を口として配る。5 回目 C5-4)。
 */

import ts from 'typescript';

/** 文に `export` の修飾子が付いているか。 */
function hasExportModifier(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** 1 つの文が値として export している名前。 */
function exportedNames(statement: ts.Statement): readonly string[] {
  const exported = hasExportModifier(statement);
  if (exported && ts.isFunctionDeclaration(statement) && statement.name !== undefined) return [statement.name.text];
  if (exported && (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name !== undefined) return [statement.name.text];
  if (exported && ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) return [statement.name.text];
  if (exported && ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly) return [statement.name.text];
  if (exported && ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) => (ts.isIdentifier(declaration.name) ? [declaration.name.text] : []));
  }
  const clause = ts.isExportDeclaration(statement) && !statement.isTypeOnly ? statement.exportClause : undefined;
  if (clause !== undefined && ts.isNamedExports(clause)) {
    return clause.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text);
  }
  if (clause !== undefined && ts.isNamespaceExport(clause)) return [clause.name.text];
  return [];
}

/** 名前を数えられない export の形 1 つ(文の先頭の 1 行を添える)。 */
export interface UnreadableExportForm {
  /** 形の名前(`destructuring` = 分割代入の変数 / `star` = `export * from` / `commonjs` = `exports` / `module` / `require` への参照)。 */
  readonly kind: 'destructuring' | 'star' | 'commonjs';
  /** 文の綴り(先頭の 1 行。長ければ切る)。 */
  readonly text: string;
}

/** 文の綴りの先頭の 1 行(指摘に添える)。 */
function headline(statement: ts.Statement, file: ts.SourceFile): string {
  const line = statement.getText(file).split('\n', 1)[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/** 1 つの文が、名前を数えられない export の形か。 */
function unreadableForm(statement: ts.Statement, file: ts.SourceFile): UnreadableExportForm | null {
  if (hasExportModifier(statement) && ts.isVariableStatement(statement)) {
    const patterned = statement.declarationList.declarations.some((declaration) => !ts.isIdentifier(declaration.name));
    return patterned ? { kind: 'destructuring', text: headline(statement, file) } : null;
  }
  if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause === undefined) {
    return { kind: 'star', text: headline(statement, file) };
  }
  return null;
}

/**
 * 1 本のモジュールの本文から、**名前を数えられない export の形**を返す(`export const { f } = …` / `export const [f] = …` /
 * `export * from '…'`)。`exportedValueNames` はこれらの名前を返せないので、数え漏れが素通りになる呼び手が使う。
 *
 * @param fileName ファイル名(AST の診断用)
 * @param source 本文
 * @returns 形の一覧(出現順。無ければ空)
 */
export function unreadableExportForms(fileName: string, source: string): readonly UnreadableExportForm[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const forms = file.statements.flatMap((statement) => {
    const form = unreadableForm(statement, file);
    return form === null ? [] : [form];
  });
  return [...forms, ...commonJsForms(file)];
}

/** CommonJS の口になる名前(自由な識別子として現れたら数えられない形)。 */
const COMMONJS_NAMES: ReadonlySet<string> = new Set(['exports', 'module', 'require']);

/**
 * 識別子が「名前の参照」として現れているか(`a.exports` の `.exports`・`{ exports: 1 }` のキー・宣言の名前・import / export の指定子は参照ではない)。
 * 宣言の名前(`const module = …` など)も参照ではないが、同じ名前をその後で使えば参照として数える(fail-closed。CommonJS の名前を局所の名前に使わない)。
 */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isPropertySignature(parent)) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isBindingElement(parent)) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
  return true;
}

/**
 * 本文の中の CommonJS の口(`exports` / `module` / `require` の参照)を、出現順に 1 文 1 件で返す(どの深さの式の中でも見る)。
 * Next.js は CommonJS の `route.js` の `exports.GET` を口として配るが、`export` の構文木を数える検査には見えない(5 回目 C5-4)。
 */
function commonJsForms(file: ts.SourceFile): UnreadableExportForm[] {
  const forms: UnreadableExportForm[] = [];
  for (const statement of file.statements) {
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isIdentifier(node) && COMMONJS_NAMES.has(node.text) && isReference(node)) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
    if (found) forms.push({ kind: 'commonjs', text: headline(statement, file) });
  }
  return forms;
}

/**
 * 1 本のモジュールの本文から、値として export している名前を返す。
 *
 * @param fileName ファイル名(AST の診断用)
 * @param source 本文
 * @returns export している名前の集合
 */
export function exportedValueNames(fileName: string, source: string): ReadonlySet<string> {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  return new Set(file.statements.flatMap(exportedNames));
}
