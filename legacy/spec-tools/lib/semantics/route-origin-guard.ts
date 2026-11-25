/**
 * Route Handler の 1 メソッドが**最初の文で出どころの関門を呼び、その結果を返している**かを AST で判定する(J2 の続きが使う)。
 *
 * 文字列の検索(import の指定子と呼び出しの名前が本文のどこかにあるか)では、関門を後置した実装(認証を先に呼ぶ)・
 * 関門の結果を捨てる実装・コメントに書いただけの実装が通る。ここは構文木で形を 1 つに絞る ——
 *
 *   (A) 最初の文が `return 関門(要求, …) ?? <本体>;`(式の本体のアロー関数なら、式そのものがこの形)
 *   (B) 最初の文が `const 名前 = 関門(要求, …);`、2 つ目の文が `if (名前 !== null) return 名前;`
 *       (`!= null`・`null !== 名前`・`if (名前)` も同じ。`then` は `return 名前;` 1 文か、それだけを包むブロック。`else` は無い)。
 *       2 つ目の文が `return 名前 ?? <本体>;` でもよい
 *
 * 「関門」「メソッドの本体」の求め方は H6 と共通の `guard-ast.ts`(関門 = 指定のモジュールから値として import した指定の名前・
 * 別名の import・名前空間の import の `ns.名前`。本体 = そのファイルの export した関数。別のモジュールからの再輸出・高階関数の戻り値は
 * **本体が読めない**として返す —— 読めないものを閉じていると数えない)。
 * 「要求」は、そのメソッドの最初の引数の識別子(分割代入の引数は読めないので数えない)。
 * 関門に渡す**ほかの引数は副作用を持てない**(import した識別子・字句と、それだけで組んだオブジェクトと配列。括弧と型の注記は外す)。
 * 性質の参照(`holder.policy`)は getter / Proxy で関門より先にコードが走りうるので認めない(外部レビュー)。
 * 引数の中の呼び出し・`await`・代入などは関門より先に走るので、`refuseCrossOrigin(request, (writeAudit(), policy))` は
 * 閉じていない(外部レビュー。`fetch` の観測には現れない局所の副作用もある)。純粋関数であり throw しない。
 */

import ts from 'typescript';
import { exportedFunctions, guardCall, importBindings, parseModule, unwrap } from './guard-ast.js';
import type { Binding, GuardSpec } from './guard-ast.js';

/** 関門の判定の結果。 */
export type OriginGuardShape =
  /** 最初の文で関門を呼び、その結果を返している。 */
  | 'guarded'
  /** メソッドの本体がこのファイルの関数として読めない(再輸出・高階関数の戻り値・引数が識別子でない)。 */
  | 'body-unreadable'
  /** 関門を(指定のモジュールから import して)呼んでいない。コメントに書いただけもここ。 */
  | 'not-called'
  /** 関門を呼んでいるが、最初の文ではない(先に別のことをしている)。 */
  | 'not-first'
  /** 最初の文で関門を呼んでいるが、その結果を返していない(捨てている・`if` で返していない)。 */
  | 'result-not-returned'
  /** 形は閉じているが、関門に渡すほかの引数が副作用を持つ(呼び出し・`await`・代入など。関門より先に走る)。 */
  | 'argument-has-effect';

/** 関門の綴り(モジュールの指定子と名前)。 */
export interface OriginGuardSpelling {
  readonly module: string;
  readonly name: string;
}

/** 出どころを確かめる部品の綴り(実行時パッケージの公開の口。J2 と X8 の正はここ 1 か所)。 */
export const REQUEST_ORIGIN_GUARD: OriginGuardSpelling = { module: '@kaninabe/runtime/http/request-origin', name: 'refuseCrossOrigin' };

/** 判定に要る、ファイルから引いた材料(関門と、要求の引数の名前)。 */
interface Context {
  readonly bindings: ReadonlyMap<string, Binding>;
  readonly guard: GuardSpec;
  readonly request: string;
  /** 偽なら、ほかの引数の副作用を見ない(`argument-has-effect` の言い分けにだけ使う)。 */
  readonly pureArguments: boolean;
}

/** 副作用を持たない引数か(import した識別子・字句と、それだけで組んだオブジェクトと配列)。 */
function isPureArgument(node: ts.Expression, bindings: ReadonlyMap<string, Binding>): boolean {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node)) {
    return isPureArgument(node.expression, bindings);
  }
  if (ts.isIdentifier(node)) return bindings.get(node.text)?.kind === 'named';
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true;
  if (ts.isArrayLiteralExpression(node)) return node.elements.every((element) => isPureArgument(element, bindings));
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every(
      (property) =>
        (ts.isShorthandPropertyAssignment(property) && isPureArgument(property.name, bindings)) ||
        (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name) && isPureArgument(property.initializer, bindings)),
    );
  }
  return false;
}

/** 式が「要求を最初の引数に渡した関門の呼び出し」か。 */
function isGuardCall(expression: ts.Node, ctx: Context): boolean {
  const call = guardCall(expression, ctx.bindings, ctx.guard);
  const [first, ...rest] = call?.arguments ?? [];
  if (first === undefined || !ts.isIdentifier(first) || first.text !== ctx.request) return false;
  return !ctx.pureArguments || rest.every((argument) => isPureArgument(argument, ctx.bindings));
}

/** 形 (A): `関門(…) ?? 本体`。 */
function isCoalescedGuard(expression: ts.Expression, ctx: Context): boolean {
  const value = unwrap(expression);
  return ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && isGuardCall(value.left, ctx);
}

/** `null` の字句か。 */
function isNull(expression: ts.Expression): boolean {
  return unwrap(expression).kind === ts.SyntaxKind.NullKeyword;
}

/** 名前の識別子か。 */
function isName(expression: ts.Expression, name: string): boolean {
  const value = unwrap(expression);
  return ts.isIdentifier(value) && value.text === name;
}

/** `if` の条件が「名前が null でない」か(`!== null` / `!= null` / 逆向き / 真偽そのもの)。 */
function isNotNullCondition(condition: ts.Expression, name: string): boolean {
  const value = unwrap(condition);
  if (isName(value, name)) return true;
  if (!ts.isBinaryExpression(value)) return false;
  const op = value.operatorToken.kind;
  if (op !== ts.SyntaxKind.ExclamationEqualsEqualsToken && op !== ts.SyntaxKind.ExclamationEqualsToken) return false;
  return (isName(value.left, name) && isNull(value.right)) || (isNull(value.left) && isName(value.right, name));
}

/** `return 名前;` 1 文(ブロックで包んでもよい)か。 */
function returnsName(statement: ts.Statement, name: string): boolean {
  if (ts.isBlock(statement)) return statement.statements.length === 1 && returnsName(statement.statements[0] as ts.Statement, name);
  return ts.isReturnStatement(statement) && statement.expression !== undefined && isName(statement.expression, name);
}

/** 形 (B) の 2 文目(`if (名前 !== null) return 名前;` か `return 名前 ?? 本体;`)か。 */
function returnsGuardResult(statement: ts.Statement, name: string): boolean {
  if (ts.isIfStatement(statement)) {
    return statement.elseStatement === undefined && isNotNullCondition(statement.expression, name) && returnsName(statement.thenStatement, name);
  }
  if (!ts.isReturnStatement(statement) || statement.expression === undefined) return false;
  const value = unwrap(statement.expression);
  return ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && isName(value.left, name);
}

/** 形 (B) の 1 文目(`const 名前 = 関門(…)`)なら、その名前。 */
function guardedConst(statement: ts.Statement, ctx: Context): string | null {
  if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0) return null;
  const [declaration, ...rest] = statement.declarationList.declarations;
  if (declaration === undefined || rest.length > 0 || !ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return null;
  return isGuardCall(declaration.initializer, ctx) ? declaration.name.text : null;
}

/** 関門の呼び出しが本体のどこかにあるか(最初の文でないときの言い分けに使う。入れ子の関数の中も数える)。 */
function containsGuardCall(node: ts.Node, ctx: Context): boolean {
  if (ts.isCallExpression(node) && isGuardCall(node, ctx)) return true;
  return ts.forEachChild(node, (child) => (containsGuardCall(child, ctx) ? true : undefined)) ?? false;
}

/** 文の並びの判定。 */
function judgeStatements(statements: readonly ts.Statement[], ctx: Context): OriginGuardShape {
  const [first, second] = statements;
  if (first !== undefined && ts.isReturnStatement(first) && first.expression !== undefined && isCoalescedGuard(first.expression, ctx)) return 'guarded';
  const name = first === undefined ? null : guardedConst(first, ctx);
  if (name !== null) {
    return second !== undefined && returnsGuardResult(second, name) ? 'guarded' : 'result-not-returned';
  }
  if (first !== undefined && containsGuardCall(first, ctx)) return 'result-not-returned';
  return statements.some((statement) => containsGuardCall(statement, ctx)) ? 'not-first' : 'not-called';
}

/**
 * 1 本の Route Handler の 1 メソッドが、最初の文で関門を呼び、その結果を返しているかを判定する。
 *
 * @param fileName ファイル名(AST の診断用)
 * @param source 本文
 * @param method メソッド(`POST` など)
 * @param guard 関門の綴り
 * @returns 判定
 */
export function originGuardShape(fileName: string, source: string, method: string, guard: OriginGuardSpelling): OriginGuardShape {
  const file = parseModule(fileName, source);
  const fn = exportedFunctions(file).find(([name]) => name === method)?.[1];
  if (fn === undefined || fn.body === undefined) return 'body-unreadable';
  const parameter = fn.parameters[0]?.name;
  if (parameter !== undefined && !ts.isIdentifier(parameter)) return 'body-unreadable';
  // 要求を受け取らない本体は、関門に要求を渡せない。
  if (parameter === undefined) return 'not-called';
  const strict: Context = { bindings: importBindings(file), guard: { module: guard.module, names: [guard.name] }, request: parameter.text, pureArguments: true };
  const shape = judgeBody(fn.body, strict);
  // 引数の副作用を見なければ閉じている形は、その旨を名指す(呼んでいない・後置と取り違えない)。
  if (shape !== 'guarded' && judgeBody(fn.body, { ...strict, pureArguments: false }) === 'guarded') return 'argument-has-effect';
  return shape;
}

/**
 * 関門の前置きの部品(X8 が、有料の口の本体を「関門の前置き + `return 共通の入口(…)`」だけに絞るのに使う。点検 6 回目 B6-1)。
 * 判定の規則は上の形 (A) / (B) と同じ関数で持つ —— J2 が認める前置きと X8 が認める前置きを食い違わせない。
 */
export interface OriginGuardParts {
  /** 式が「要求を最初の引数に渡し、ほかの引数が副作用を持たない関門の呼び出し」か。 */
  readonly isGuardCall: (expression: ts.Expression) => boolean;
  /** 文が `const 名前 = 関門(…);` なら、その名前。 */
  readonly guardedConst: (statement: ts.Statement) => string | null;
  /** 文が `if (名前 !== null) return 名前;`(同値の書き方を含む)か。 */
  readonly returnsIfPresent: (statement: ts.Statement, name: string) => boolean;
}

/**
 * ファイルの import の束縛と要求の名前から、関門の前置きの部品を組む。
 *
 * @param file 構文木
 * @param request メソッドが受けた要求の引数の名前
 * @param guard 関門の綴り
 * @returns 部品
 */
export function originGuardParts(file: ts.SourceFile, request: string, guard: OriginGuardSpelling): OriginGuardParts {
  const ctx: Context = { bindings: importBindings(file), guard: { module: guard.module, names: [guard.name] }, request, pureArguments: true };
  return {
    isGuardCall: (expression) => isGuardCall(expression, ctx),
    guardedConst: (statement) => guardedConst(statement, ctx),
    returnsIfPresent: (statement, name) => ts.isIfStatement(statement) && returnsGuardResult(statement, name),
  };
}

/** 本体(文の並びか式)の判定。 */
function judgeBody(body: ts.ConciseBody, ctx: Context): OriginGuardShape {
  if (ts.isBlock(body)) return judgeStatements(body.statements, ctx);
  if (isCoalescedGuard(body, ctx)) return 'guarded';
  return containsGuardCall(body, ctx) ? 'result-not-returned' : 'not-called';
}
