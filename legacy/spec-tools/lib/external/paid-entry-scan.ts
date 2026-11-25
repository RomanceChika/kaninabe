/**
 * 有料の口の Route Handler が、共通の入口 `runPaidEntry` を**構文木の形で**使っているかの走査(X8 の材料。純関数)。
 *
 * 「定数を import している」だけでは執行ではない(設計の凍結案 r5-abuse-freeze.md の 外部レビュー の指摘)。守りたいのは順序である ——
 * 本文を読む前に上限で落とし、課金する前に枠を消費する。順序を `runPaidEntry` が 1 か所で持つので、口に求めるのは次の形だけ:
 *
 *   1. 状態を変えるメソッドの**最後の文**が `return runPaidEntry(request, { … })`(`await` と、出どころの確認の `?? ` の右側は剥がす)。
 *      `runPaidEntry` は `@kaninabe/runtime/http/paid-entry` から値として import したもの(別名可。隠した名前・別モジュールの同名は数えない)
 *   1b. **本体の文の並びは許可表のどれかだけ**(点検 6 回目 B6-1): `return 入口(…)` / `return 関門(request, …) ?? 入口(…)` /
 *      `const r = 関門(request, …); return r ?? 入口(…)` / `const r = 関門(request, …); if (r !== null) return r; return 入口(…)`。
 *      関門は出どころの確認(`refuseCrossOrigin`。形の判定は J2 と同じ `route-origin-guard.ts`)。**それ以外の文**(ヘッダで分岐して別の処理を
 *      返す・ログを書く・`??` の左に任意の式)は赤 —— 入口の前の文は生成テストが送らない要求で分岐できるので、閉世界にならない
 *   2. `maxBodyBytes` は生成した定数表の `PAID_ENTRIES['<この口の URL>'].maxBodyBytes`(数の書き写しをしない)
 *   3. `authorize` は**認証の組み立ての根の `authorizeRole` を、引数 1 つ `PAID_ENTRIES['<この口の URL>'].role` で呼ぶ 1 式だけ**(許可表。
 *      呼び先が手書きの関数・役を捨てる即時呼び出し・引数の足し算は、役を渡していても赤。点検 5 回目 B5-2)
 *   3b. **多要素認証の段**(ASVS V6.8・保証 `fw_mfa_write_boundary`): `bindings` は生成した束(`runtimeBindings`。生成した束のモジュールから import したもの)、
 *      `role` は `PAID_ENTRIES['<この口の URL>'].role`。製品が多要素認証を要求するなら、`resolveMfa` は認証の組み立ての根の `resolveSessionMfa`。
 *      束は生成物だけが作るので、手で書いた値を渡して段を外すことができない。段そのもの(認可の直後・本文を読む前)は `runPaidEntry` が持つ。
 *      オプションの名前は字面でなく実行時の鍵で数え(`bindings` と `'bindings'` は同じ)、同じ名前の重複は読まずに赤にする(後勝ちで上書きされる)
 *   3c. **拒否の行の出力口**: `logger` は認証の組み立ての根の `securityLogger()`(引数なしの呼び出し)。有料の口の拒否を、ほかの入口と同じく
 *      ホストの外への転送(鍵があるとき)に載せる(logging.md §ホストの外への転送)
 *   4. `consume` は、宣言した `meter` の RPC を呼ぶモジュール(`.rpc('<meter>')` が閉包にある)の束縛 `M` を**呼ぶ 1 式だけ**(許可表):
 *      `M` / `M()` / `(id) => M(id)` / `(id) => M()(id)`(`async` と `await` は可)。条件・`void`・カンマ・ブロック・参照するだけの形は赤
 *      (参照しただけで呼ばない消費は、枠を数えずに有料の処理へ進む。点検 5 回目 B5-2)
 *   4b. **残りのオプションの値も許可表**(点検 7 回目 B7-1): 鍵は `PAID_ENTRY_OPTION_KEYS`(実行時パッケージの `PaidEntryOptions` の欄)だけ、
 *      `operation` / `invariant` は文字列の字句、`parse` は import した束縛の識別子(呼ばない)。オブジェクトの値は `runPaidEntry` を呼ぶ**前**
 *      (認可より前)に評価されるので、`operation: await previewOperation(request)` のような呼び出し・`await` を置くと、未ログインの要求でも
 *      任意の処理が走る。上の 1〜4 の欄は形を個別に固定済み
 *   5. `handler` はその場の関数で、**有料の連携に届く束縛(import)は `handler` の中でしか使わない**(外で使えば、枠の消費の前に有料の処理に届く)。
 *      動的 import・再輸出・副作用 import で有料の連携に届く形は、`handler` の中でない限り同じく認めない
 *
 * 束縛の「有料の連携に届く」「枠を消費する RPC を呼ぶ」は、呼び手(X8)が import の閉包で求めて `classOf` で渡す。ここは**形**だけを見る。
 * 純粋関数であり throw しない。
 */

import ts from 'typescript';
import { allowedImports, isShadowed, parseSource, resolveImport } from '../config/import-binding.js';
import type { ImportSpec } from '../config/import-binding.js';
import { MFA_RESOLVER } from '../model/auth/mfa.js';
import { isInside, isReference, literalText, optionsOf, peel, returnedExpression, valueOf } from './paid-entry-ast.js';
import { exportedFunctions, importBindings, unwrap } from '../semantics/guard-ast.js';
import { isAllowedPaidBody } from './paid-entry-body.js';
import { restOptionsAllowed } from './paid-entry-options.js';
import type { FunctionNode } from '../semantics/guard-ast.js';

/** 共通の入口のモジュールの指定子(実行時パッケージの公開の口)。 */
export const PAID_ENTRY_MODULE = '@kaninabe/runtime/http/paid-entry';

/** 共通の入口の名前。 */
export const PAID_ENTRY_FUNCTION = 'runPaidEntry';

/** 生成した定数表の名前。 */
export const PAID_TABLE_NAME = 'PAID_ENTRIES';

/** 有料の口の認可を作る関数の名前(認証の組み立ての根が export する。役を受けて要求の認可を返す)。 */
export const AUTHORIZE_ROLE = 'authorizeRole';

/** 生成した束の名前。 */
export const RUNTIME_BINDINGS_NAME = 'runtimeBindings';

/** 拒否の行の出力口を作る関数の名前(認証の組み立ての根が export する。標準出力 + 鍵があればホストの外へ送る口)。 */
export const SECURITY_LOGGER = 'securityLogger';

/** 形の判定の結果。`wrapped` 以外は直す。 */
export type PaidEntryShape =
  /** 共通の入口で包み、上限・役が生成物から来て、枠の消費が `meter` を呼び、有料の連携は `handler` の中だけ。 */
  | 'wrapped'
  /** メソッドの本体がこのファイルの関数として読めない(再輸出・高階関数の戻り値・分割代入の引数)。 */
  | 'body-unreadable'
  /** 最後の文が `runPaidEntry`(本物の import)の呼び出しを返していない。 */
  | 'not-wrapped'
  /** 本体に、出どころの確認と `return runPaidEntry(…)` 以外の文・式がある(許可表の外。点検 6 回目 B6-1)。 */
  | 'extra-statements'
  /** `runPaidEntry` の第 1 引数がメソッドの受けた要求ではない。 */
  | 'request-not-passed'
  /** 第 2 引数が、スプレッド・算出キー・同じ名前の重複を含まないその場のオブジェクトではない。 */
  | 'options-unreadable'
  /** `maxBodyBytes` が生成した定数表の、この口の URL の値ではない。 */
  | 'limit-not-generated'
  /** `authorize` が、認証の組み立ての根の `authorizeRole(PAID_ENTRIES['<この口>'].role)` の 1 式ではない。 */
  | 'role-not-generated'
  /** `bindings` が、生成した束(`runtimeBindings`)ではない(多要素認証の段を手書きの値で外せる)。 */
  | 'bindings-not-generated'
  /** `role` が、生成した定数表のこの口の `role` ではない(要求の範囲が `roles` のとき、口の役の判定が食い違う)。 */
  | 'role-option-not-generated'
  /** 製品が多要素認証を要求するのに、`resolveMfa` が認証の組み立ての根の `resolveSessionMfa` ではない(全員が止まるか、決め打ちで外れる)。 */
  | 'mfa-resolver-not-wired'
  /** `logger` が、認証の組み立ての根の `securityLogger()` の呼び出しではない(拒否の行がホストの外への転送に載らない)。 */
  | 'logger-not-wired'
  /** `consume` が、宣言した `meter` を呼ぶモジュールの束縛を呼ぶ 1 式ではない。 */
  | 'meter-not-called'
  /** `handler` がその場の関数ではない。 */
  | 'handler-not-inline'
  /** オプションに許可表の外の鍵があるか、`operation` / `invariant` が文字列の字句・`parse` が import した束縛の識別子でない(認可の前に評価される式。B7-1)。 */
  | 'option-not-allowed'
  /** 有料の連携に届く束縛を、`handler` の外で使っている(枠の消費の前に有料の処理に届きうる)。 */
  | 'paid-outside-handler';

/** import の指定子が「有料の連携に届く」「枠を消費する RPC を呼ぶ」のどれか。 */
export interface SpecifierClass {
  readonly paid: boolean;
  readonly meter: boolean;
}

/** 判定の材料。 */
export interface PaidEntryContext {
  /** 生成した定数表のモジュールの指定子(置き場の配置が決める。例: `@/domain/generated/paid-entries`)。 */
  readonly tableModule: string;
  /** 生成した束(`runtimeBindings`)のモジュールの指定子。 */
  readonly bindingsModule: string;
  /** 製品が多要素認証を要求するときの、認証の組み立ての根のモジュールの指定子(要求しない製品・根の配置が無いときは `null` = `resolveMfa` を求めない)。 */
  readonly mfaResolverModule: string | null;
  /** 拒否の行の出力口(`securityLogger`)と認可(`authorizeRole`)を export する、認証の組み立ての根のモジュールの指定子(根の配置が無いときは `''` = 必ず赤)。 */
  readonly loggerModule: string;
  /** この口の URL(定数表の鍵)。 */
  readonly endpoint: string;
  /** import の指定子の分類(呼び手が閉包で求める)。 */
  readonly classOf: (specifier: string) => SpecifierClass;
}

/** ファイル 1 本から引いた材料。 */
interface Scan {
  readonly file: ts.SourceFile;
  readonly bound: ReadonlyMap<string, ImportSpec>;
  readonly specifiers: ReadonlyMap<string, string>;
  readonly ctx: PaidEntryContext;
}

/** `PAID_ENTRIES['<この口の URL>'].<field>` の形か(表は本物の import)。 */
function isGeneratedAccess(expression: ts.Expression, field: string, scan: Scan): boolean {
  const access = unwrap(expression);
  if (!ts.isPropertyAccessExpression(access) || access.name.text !== field) return false;
  const entry = unwrap(access.expression);
  if (!ts.isElementAccessExpression(entry) || literalText(entry.argumentExpression) !== scan.ctx.endpoint) return false;
  const table = unwrap(entry.expression);
  return ts.isIdentifier(table) && resolveImport(table, scan.bound)?.imported === PAID_TABLE_NAME;
}

/** 値が、指定の import(束縛)をそのまま渡す識別子か(生成した束・認証の組み立ての根の関数)。 */
function isImportedName(expression: ts.Expression, imported: string, scan: Scan): boolean {
  const name = unwrap(expression);
  return ts.isIdentifier(name) && resolveImport(name, scan.bound)?.imported === imported;
}

/** 部分木の中で、指定の分類の import の束縛を参照している識別子(隠した名前は除く)。 */
function referencesIn(root: ts.Node, scan: Scan, wanted: 'paid' | 'meter'): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node) && isReference(node)) {
      const specifier = scan.specifiers.get(node.text);
      if (specifier !== undefined && scan.ctx.classOf(specifier)[wanted] && !isShadowed(node, node.text)) found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/** 動的 import・再輸出・副作用 import で、有料の連携に届く指定子を `handler` の外で読んでいるか。 */
function loadsPaidOutside(scan: Scan, handler: ts.Node): boolean {
  const paid = (node: ts.Expression | undefined): boolean => node !== undefined && ts.isStringLiteralLike(node) && scan.ctx.classOf(node.text).paid;
  const visit = (node: ts.Node): boolean => {
    if (ts.isImportDeclaration(node) && node.importClause === undefined && paid(node.moduleSpecifier)) return true;
    if (ts.isExportDeclaration(node) && paid(node.moduleSpecifier)) return true;
    const dynamic = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
    if (dynamic && paid(node.arguments[0]) && !isInside(node, handler)) return true;
    return ts.forEachChild(node, (child) => (visit(child) ? true : undefined)) === true;
  };
  return visit(scan.file);
}

/** 関数として読める節の最初の引数の識別子の名前(受けていなければ undefined、分割代入なら null)。 */
function requestName(fn: FunctionNode): string | null | undefined {
  const parameter = fn.parameters[0]?.name;
  if (parameter === undefined) return undefined;
  return ts.isIdentifier(parameter) ? parameter.text : null;
}

/** 共通の入口の呼び出しか(本物の import に解決できるもの)。 */
function entryCall(expression: ts.Expression, scan: Scan): ts.CallExpression | null {
  const call = peel(expression);
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return null;
  return resolveImport(call.expression, scan.bound)?.imported === PAID_ENTRY_FUNCTION ? call : null;
}

/** 認可が `authorizeRole(PAID_ENTRIES['<この口>'].role)`(認証の組み立ての根の import・引数 1 つ)の 1 式か(許可表)。 */
function isAuthorizeRoleCall(value: ts.Expression | null, scan: Scan): boolean {
  const call = value === null ? null : unwrap(value);
  if (call === null || !ts.isCallExpression(call) || call.typeArguments !== undefined) return false;
  const [role, ...rest] = call.arguments;
  return isImportedName(call.expression, AUTHORIZE_ROLE, scan) && role !== undefined && rest.length === 0 && isGeneratedAccess(role, 'role', scan);
}

/** 式が、meter の RPC を呼ぶモジュールの値の束縛(隠していない識別子)か。 */
function isMeterBinding(expression: ts.Expression, scan: Scan): boolean {
  const name = unwrap(expression);
  if (!ts.isIdentifier(name) || isShadowed(name, name.text)) return false;
  const specifier = scan.specifiers.get(name.text);
  return specifier !== undefined && scan.ctx.classOf(specifier).meter;
}

/** 式が `M` か `M()`(引数なしで消費の関数を作る)か。 */
function isMeterConsumer(expression: ts.Expression, scan: Scan): boolean {
  const inner = unwrap(expression);
  if (isMeterBinding(inner, scan)) return true;
  return ts.isCallExpression(inner) && inner.arguments.length === 0 && isMeterBinding(inner.expression, scan);
}

/**
 * 枠の消費が、meter の束縛を**呼ぶ 1 式**か(許可表): `M` / `M()` / `(id) => M(id)` / `(id) => M()(id)`(`async`・`await` は可)。
 * ブロックの本体・条件・`void`・カンマ・別の値を返す形は数えない(参照しただけで呼ばない消費を通さない。点検 5 回目 B5-2)。
 */
function isMeterConsume(value: ts.Expression | null, scan: Scan): boolean {
  if (value === null) return false;
  const consume = unwrap(value);
  if (!ts.isArrowFunction(consume)) return isMeterConsumer(consume, scan);
  const [parameter, ...more] = consume.parameters;
  if (parameter === undefined || more.length > 0 || !ts.isIdentifier(parameter.name) || parameter.initializer !== undefined || parameter.dotDotDotToken !== undefined) return false;
  if (ts.isBlock(consume.body)) return false;
  let body = unwrap(consume.body);
  if (ts.isAwaitExpression(body)) body = unwrap(body.expression);
  if (!ts.isCallExpression(body) || body.arguments.length !== 1) return false;
  const argument = unwrap(body.arguments[0] as ts.Expression);
  return ts.isIdentifier(argument) && argument.text === parameter.name.text && isMeterConsumer(body.expression, scan);
}

/** オプションの中身の判定(第 2 引数は読めている)。 */
function judgeOptions(options: ReadonlyMap<string, ts.ObjectLiteralElementLike>, scan: Scan): PaidEntryShape {
  const limit = valueOf(options.get('maxBodyBytes'));
  if (limit === null || !isGeneratedAccess(limit, 'maxBodyBytes', scan)) return 'limit-not-generated';
  if (!isAuthorizeRoleCall(valueOf(options.get('authorize')), scan)) return 'role-not-generated';
  const bindings = valueOf(options.get('bindings'));
  if (bindings === null || !isImportedName(bindings, RUNTIME_BINDINGS_NAME, scan)) return 'bindings-not-generated';
  const roleOption = valueOf(options.get('role'));
  if (roleOption === null || !isGeneratedAccess(roleOption, 'role', scan)) return 'role-option-not-generated';
  if (scan.ctx.mfaResolverModule !== null) {
    const resolve = valueOf(options.get('resolveMfa'));
    if (resolve === null || !isImportedName(resolve, MFA_RESOLVER, scan)) return 'mfa-resolver-not-wired';
  }
  const logger = valueOf(options.get('logger'));
  const loggerCall = logger === null ? null : unwrap(logger);
  if (loggerCall === null || !ts.isCallExpression(loggerCall) || loggerCall.arguments.length > 0 || !isImportedName(loggerCall.expression, SECURITY_LOGGER, scan)) return 'logger-not-wired';
  if (!isMeterConsume(valueOf(options.get('consume')), scan)) return 'meter-not-called';
  const handler = options.get('handler');
  const inline = handler !== undefined && (ts.isMethodDeclaration(handler) || (ts.isPropertyAssignment(handler) && (ts.isArrowFunction(unwrap(handler.initializer)) || ts.isFunctionExpression(unwrap(handler.initializer)))));
  if (handler === undefined || !inline) return 'handler-not-inline';
  const outside = referencesIn(scan.file, scan, 'paid').some((reference) => !isInside(reference, handler));
  if (outside || loadsPaidOutside(scan, handler)) return 'paid-outside-handler';
  return restOptionsAllowed(options, scan.specifiers) ? 'wrapped' : 'option-not-allowed';
}

/**
 * 1 本の Route Handler の 1 メソッドが、共通の入口の形になっているかを判定する。
 *
 * @param fileName ファイル名(構文木の種類の判定にだけ使う)
 * @param source 本文
 * @param method メソッド(`POST` など)
 * @param ctx 生成した定数表のモジュール・この口の URL・指定子の分類
 * @returns 判定
 */
export function paidEntryShape(fileName: string, source: string, method: string, ctx: PaidEntryContext): PaidEntryShape {
  const file = parseSource(source, fileName);
  const fn = exportedFunctions(file).find(([name]) => name === method)?.[1];
  const request = fn === undefined ? undefined : requestName(fn);
  if (fn === undefined || fn.body === undefined || request === null || request === undefined) return 'body-unreadable';
  const bound = allowedImports(file, [
    { module: PAID_ENTRY_MODULE, imported: PAID_ENTRY_FUNCTION },
    { module: ctx.tableModule, imported: PAID_TABLE_NAME },
    { module: ctx.bindingsModule, imported: RUNTIME_BINDINGS_NAME },
    ...(ctx.mfaResolverModule === null ? [] : [{ module: ctx.mfaResolverModule, imported: MFA_RESOLVER }]),
    { module: ctx.loggerModule, imported: SECURITY_LOGGER },
    { module: ctx.loggerModule, imported: AUTHORIZE_ROLE },
  ] satisfies readonly ImportSpec[]);
  const specifiers = new Map([...importBindings(file)].map(([local, binding]) => [local, binding.specifier]));
  const scan: Scan = { file, bound, specifiers, ctx };
  const returned = returnedExpression(fn.body);
  const call = returned === undefined ? null : entryCall(returned, scan);
  if (call === null) return 'not-wrapped';
  const [first, second] = call.arguments;
  if (first === undefined || !ts.isIdentifier(first) || first.text !== request) return 'request-not-passed';
  const options = second !== undefined && ts.isObjectLiteralExpression(second) ? optionsOf(second) : null;
  const judged = options === null ? 'options-unreadable' : judgeOptions(options, scan);
  // 入口の呼び出しそのものが健全でも、その前に許可表の外の文があれば包んだことにならない(B6-1)。
  const isEntry = (candidate: ts.CallExpression): boolean => entryCall(candidate, scan) === candidate;
  return judged === 'wrapped' && !isAllowedPaidBody(fn.body, file, request, isEntry) ? 'extra-statements' : judged;
}
