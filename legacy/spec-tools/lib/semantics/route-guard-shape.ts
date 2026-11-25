/**
 * Route Handler(`route.ts`)の**全部の HTTP メソッドが出口の関所 `guardRoute` で包まれているか**を AST で判定する(J2 の続きが使う。
 * 点検 10 回目 B10-1)。
 *
 * 関所(`@kaninabe/runtime/http/route-guard`)は口が返した応答の `Location` / `Refresh` と、投げた転送の合図を外へ出す直前に見る実行時の
 * 1 か所である。綴りを追う lint の規則と違い、口の中の書き方に関係なく効く —— ただし**口が包まれているときだけ**。そこで包む形を
 * 1 つに閉じる:
 *
 *   `export const GET = guardRoute(<矢印関数か関数式>);`
 *   `export const POST = guardRoute(<矢印関数か関数式>, { externalOrigins: <import した名前> });`  ← 外の行き先の表は許した口だけ
 *   `export const GET = guardRoute(<矢印関数か関数式>, { attachmentTypes: [{ type: '<型>', reason: '<理由>' }] });`  ← ダウンロードの宣言(字面の型と理由)
 *
 * `guardRoute` は指定のモジュールから値として import した名前(別名の import・名前空間の `ns.guardRoute` も可)。それ以外の形
 * (`export async function GET`・`export const GET = handler`・`export { h as GET }`・`export { GET } from '…'`・関所でない包み)は
 * 包まれていると数えない(fail-closed)。外の行き先の表(`externalOrigins`)は呼び手が許した口(認証の `start` = IdP の認可の URL への 303)
 * だけが持て、値は import した名前 1 つ(要求ごとに読む関数。引数の中で呼び出し・計算をしない)に限る。ダウンロードの宣言(`attachmentTypes`)はどの口も
 * 持てるが、値は `{ type, reason }` の文字列リテラルの行を 1 行以上並べた配列のリテラルに限る(点検 11 回目 B11-3。宣言できる型の閉じた表は関所が実行時に見る)。
 * 純粋関数であり throw しない。
 */

import ts from 'typescript';
import { HTTP_METHODS } from './route-exports.js';
import type { HttpMethod } from './route-exports.js';
import { ROUTE_GUARD, guardCall, importBindings, parseModule } from './guard-ast.js';
import type { Binding } from './guard-ast.js';

/** 包みの形の問題。 */
export type RouteGuardProblemKind =
  /** 関所で包んでいない(関数の宣言・別の値・名前の付け替えの export・再輸出・関所でない呼び出し)。 */
  | 'unguarded'
  /** 関所の第 1 引数が、このファイルの矢印関数・関数式でない(本体を読めない)。 */
  | 'handler-unreadable'
  /** 外の行き先の表を、許していない口が持っている。 */
  | 'options-not-allowed'
  /** 関所の第 2 引数の形が閉じていない(`externalOrigins: <import した名前>` と `attachmentTypes: <字面の宣言の配列>` 以外・引数が 3 つ以上)。 */
  | 'options-shape';

/** 1 メソッドの問題。 */
export interface RouteGuardProblem {
  readonly method: HttpMethod;
  readonly kind: RouteGuardProblemKind;
}

/** 文に `export` の修飾子が付いているか。 */
function isExported(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/** `externalOrigins` の値が import した名前 1 つか。 */
function closedOrigins(property: ts.ObjectLiteralElementLike, bindings: ReadonlyMap<string, Binding>): boolean {
  const named = (name: ts.Identifier): boolean => bindings.get(name.text)?.kind === 'named';
  if (ts.isShorthandPropertyAssignment(property)) return named(property.name);
  return ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer) && named(property.initializer);
}

/** プロパティの値が、空白だけでない文字列リテラルか。 */
function literalText(property: ts.ObjectLiteralElementLike | undefined): boolean {
  if (property === undefined || !ts.isPropertyAssignment(property)) return false;
  return ts.isStringLiteralLike(property.initializer) && property.initializer.text.trim() !== '';
}

/** `attachmentTypes` の値が `[{ type: '…', reason: '…' }, …]` の字面(1 行以上)か。 */
function closedAttachments(property: ts.ObjectLiteralElementLike): boolean {
  if (!ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) return false;
  const rows = property.initializer.elements;
  return rows.length > 0 && rows.every((row) => {
    if (!ts.isObjectLiteralExpression(row) || row.properties.length !== 2) return false;
    return ['type', 'reason'].every((key) => literalText(row.properties.find((item) => item.name !== undefined && ts.isIdentifier(item.name) && item.name.text === key)));
  });
}

/** 第 2 引数の欄の名前(読めない欄は null)。 */
function optionName(property: ts.ObjectLiteralElementLike): string | null {
  return (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && ts.isIdentifier(property.name) ? property.name.text : null;
}

/** 第 2 引数が閉じた形か(欄は `externalOrigins` と `attachmentTypes` だけで各 1 回。どちらかは要る)。 */
function closedOptions(node: ts.Expression, bindings: ReadonlyMap<string, Binding>): boolean {
  if (!ts.isObjectLiteralExpression(node) || node.properties.length === 0) return false;
  const names = node.properties.map(optionName);
  if (new Set(names).size !== names.length) return false;
  return node.properties.every((property) => {
    const name = optionName(property);
    if (name === 'externalOrigins') return closedOrigins(property, bindings);
    return name === 'attachmentTypes' && closedAttachments(property);
  });
}

/** 第 2 引数が外の行き先の表を持つか。 */
function hasExternalOrigins(node: ts.Expression): boolean {
  return ts.isObjectLiteralExpression(node) && node.properties.some((property) => optionName(property) === 'externalOrigins');
}

/** `export const M = <式>` の式の問題(問題が無ければ null)。 */
function initializerProblem(init: ts.Expression | undefined, bindings: ReadonlyMap<string, Binding>, allowExternal: boolean): RouteGuardProblemKind | null {
  const call = init === undefined ? undefined : guardCall(init, bindings, ROUTE_GUARD);
  if (call === undefined) return 'unguarded';
  const [handler, options, ...rest] = call.arguments;
  if (handler === undefined || !(ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) return 'handler-unreadable';
  if (options === undefined) return null;
  if (rest.length > 0 || !closedOptions(options, bindings)) return 'options-shape';
  return allowExternal || !hasExternalOrigins(options) ? null : 'options-not-allowed';
}

/**
 * 1 本の Route Handler の本文から、HTTP メソッドの export ごとの包みの問題を返す。
 *
 * @param fileName ファイル名(AST の診断用)
 * @param source 本文
 * @param allowExternal 外の行き先の表(`externalOrigins`)を持ってよい口か(認証の `start` の口だけ)
 * @returns 問題(メソッドの出現順。全部包まれていれば空)
 */
export function routeGuardProblems(fileName: string, source: string, allowExternal: boolean): readonly RouteGuardProblem[] {
  const file = parseModule(fileName, source);
  const bindings = importBindings(file);
  const methods: ReadonlySet<string> = new Set(HTTP_METHODS);
  const problems: RouteGuardProblem[] = [];
  const push = (name: string, kind: RouteGuardProblemKind | null): void => {
    if (kind !== null && methods.has(name)) problems.push({ method: name as HttpMethod, kind });
  };
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement) && statement.name !== undefined) push(statement.name.text, 'unguarded');
    if ((ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && isExported(statement) && statement.name !== undefined) push(statement.name.text, 'unguarded');
    if ((ts.isModuleDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) && isExported(statement) && ts.isIdentifier(statement.name)) push(statement.name.text, 'unguarded');
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      // `let` / `var` は後から差し替えられるので、包んでいても数えない(`const` だけ)。
      const constant = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) push(declaration.name.text, constant ? initializerProblem(declaration.initializer, bindings, allowExternal) : 'unguarded');
      }
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause !== undefined) {
      const clause = statement.exportClause;
      const names = ts.isNamedExports(clause) ? clause.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text) : [clause.name.text];
      for (const name of names) push(name, 'unguarded');
    }
  }
  return problems;
}
