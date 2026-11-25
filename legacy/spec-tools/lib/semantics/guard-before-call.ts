/**
 * **export した関数が、ある呼び出しの前に関門の部品を呼んで、拒否ならそこで返しているか**を AST で求める(H6 の手書きの Server Action が使う)。
 *
 * 手書きの口に「最初に関門を通す」ことを求める検査は、字面(`includes`)で見ると コメントの中の名前・呼んでも結果を捨てる形・
 * 本体の**あと**で呼ぶ形でも通ってしまう。ここは構文木で、export した関数ごとに次を見る(import の束縛・export した関数・
 * 関門の呼び出しの求め方は J2 と共通の `guard-ast.ts`)。
 *
 *   - **関門**: 関門のモジュール(`guard.module`)から import した名前(`guard.names`。別名・名前空間の import も可)の呼び出し
 *   - **本体**: 呼び手が本体と言う import(`isTarget(指定子)`)の束縛を根に持つ呼び出し(`create()(…)` や `ns.f()` の形も含む)
 *   - 関門は関数本体の**いちばん外の文**で呼ばれ、結果が使われていること —— `const r = 関門(…)` のあとに `if (… r …) { … return … }` が
 *     ある形か、`if (関門(…)) { … return … }` の形。どちらも、**本体を呼ぶ最初の文より前**に終わっていること
 *
 * 限界(安全側に倒す): 本体の呼び出しは入れ子の関数の中まで探す(早く見つかるほど厳しい)が、関門は入れ子の関数の中を数えない。
 * 分岐の中・`try` の中で呼んだ関門は数えない(いちばん外の文だけ)。拒否の値が返り値になっているかまでは追わない(`return` があれば数える)。
 * **値の出どころ(任意)**: `source` を渡すと、関門の `source.argumentIndex` 番目の引数が spread も算出のキーも持たない
 * オブジェクトの字句で(後から値を上書きできない。外部レビュー)、その性質 `source.property` の値が、`source.module` から import した
 * `source.name` の呼び出し(`await` 可)そのものか、関門より前のいちばん外の文で `const v = 呼び出し` と受けた識別子であることも求める
 * (H6 の手書きの入口: `actorMfa: true` と決め打ちで渡すと、形は閉じていても実セッションの aal1 を防げない。外部レビュー)。
 * 満たさなければ `unsourced`。
 * 純粋関数であり throw しない。
 */

import ts from 'typescript';
import { contains, exportedFunctions, guardCall, importBindings, parseModule } from './guard-ast.js';
import type { Binding, FunctionNode, GuardSpec } from './guard-ast.js';

export type { GuardSpec } from './guard-ast.js';

/** export した関数 1 つの判定。`no_target` は本体の呼び出しが見つからない(何の前に関門があるべきか決められない)。 */
export type GuardState = 'guarded' | 'unguarded' | 'no_target' | 'unsourced';

/** 関門に渡す値の出どころの要求(性質の名前と、その値を作るべき関数の import)。 */
export interface GuardSource {
  /** 値を渡す引数の位置(0 始まり)。 */
  readonly argumentIndex: number;
  readonly property: string;
  readonly module: string;
  readonly name: string;
}

/** export した関数 1 つと、その判定。 */
export interface ExportGuard {
  readonly name: string;
  readonly state: GuardState;
}

/** 呼び出しの根の識別子(`f()` / `f()()` / `ns.f()` / `(await f)()` の `f` / `ns`)。 */
function calleeRoot(expression: ts.Expression): ts.Identifier | undefined {
  let current: ts.Expression = expression;
  for (;;) {
    if (ts.isIdentifier(current)) return current;
    if (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) current = current.expression;
    else if (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
    else return undefined;
  }
}

/** 判定に要る、ファイルから引いた材料。 */
interface Context {
  readonly bindings: ReadonlyMap<string, Binding>;
  readonly guard: GuardSpec;
  readonly isTarget: (specifier: string) => boolean;
  readonly source: GuardSource | undefined;
}

/** `node` の中(入れ子の関数は除く)の関門の呼び出し。 */
function guardCallsIn(node: ts.Node, ctx: Context): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (current: ts.Node): void => {
    if (ts.isFunctionLike(current)) return;
    if (ts.isCallExpression(current) && isGuardCall(current, ctx)) found.push(current);
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/** 式が出どころの関数の呼び出し(`await` と括弧は外す)か。 */
function isSourceCall(expression: ts.Expression, ctx: Context, source: GuardSource): boolean {
  let current = expression;
  while (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) current = current.expression;
  if (!ts.isCallExpression(current) || !ts.isIdentifier(current.expression)) return false;
  const binding = ctx.bindings.get(current.expression.text);
  return binding?.kind === 'named' && binding.specifier === source.module && binding.imported === source.name;
}

/** 関門の呼び出しが、出どころの要求を満たすか(`earlier` = 関門の文より前のいちばん外の文)。 */
function isSourced(call: ts.CallExpression, earlier: readonly ts.Statement[], ctx: Context, source: GuardSource): boolean {
  const fromConst = (name: string): boolean =>
    earlier.some(
      (statement) =>
        ts.isVariableStatement(statement) &&
        (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
        statement.declarationList.declarations.some(
          (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer !== undefined && isSourceCall(declaration.initializer, ctx, source),
        ),
    );
  const object = call.arguments[source.argumentIndex];
  if (object === undefined || !ts.isObjectLiteralExpression(object)) return false;
  // spread・算出のキー・メソッドなどの、名前を読み切れない性質があれば、値が上書きされうるので満たさない。
  const readable = object.properties.every(
    (property) => ts.isShorthandPropertyAssignment(property) || (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))),
  );
  if (!readable) return false;
  const values = object.properties.flatMap((property): ts.Expression[] => {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === source.property) return [property.name];
    if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === source.property) return [property.initializer];
    return [];
  });
  return values.length === 1 && values.every((value) => isSourceCall(value, ctx, source) || (ts.isIdentifier(value) && fromConst(value.text)));
}

/** 関門の呼び出しか。 */
function isGuardCall(node: ts.Node, ctx: Context): boolean {
  return ts.isCallExpression(node) && guardCall(node, ctx.bindings, ctx.guard) !== undefined;
}

/** 本体の呼び出しか。 */
function isTargetCall(node: ts.Node, ctx: Context): boolean {
  if (!ts.isCallExpression(node)) return false;
  const root = calleeRoot(node.expression);
  const binding = root === undefined ? undefined : ctx.bindings.get(root.text);
  return binding !== undefined && ctx.isTarget(binding.specifier);
}

/** `if (…) { … return … }`(条件が `test` を満たし、then の側に return がある)。 */
function isReturningIf(statement: ts.Statement, test: (node: ts.Node) => boolean): boolean {
  return ts.isIfStatement(statement) && contains(statement.expression, test, false) && contains(statement.thenStatement, ts.isReturnStatement, false);
}

/** 関門の結果を入れた変数の名前(`const r = 関門(…)` の形のとき)。 */
function guardVariable(statement: ts.Statement, ctx: Context): string | undefined {
  if (!ts.isVariableStatement(statement)) return undefined;
  for (const declaration of statement.declarationList.declarations) {
    const init = declaration.initializer;
    if (ts.isIdentifier(declaration.name) && init !== undefined && contains(init, (node) => isGuardCall(node, ctx), false)) return declaration.name.text;
  }
  return undefined;
}

/** いちばん外の文の並びで、関門が本体より前に「呼ばれて、拒否なら返る」形になっているか。 */
function stateOf(statements: readonly ts.Statement[], ctx: Context): GuardState {
  const target = statements.findIndex((statement) => contains(statement, (node) => isTargetCall(node, ctx), true));
  if (target === -1) return 'no_target';
  const sourced = (index: number): GuardState => {
    const source = ctx.source;
    if (source === undefined) return 'guarded';
    const calls = guardCallsIn(statements[index] as ts.Statement, ctx);
    return calls.every((call) => isSourced(call, statements.slice(0, index), ctx, source)) ? 'guarded' : 'unsourced';
  };
  for (const [index, statement] of statements.slice(0, target).entries()) {
    if (isReturningIf(statement, (node) => isGuardCall(node, ctx))) return sourced(index);
    const variable = guardVariable(statement, ctx);
    if (variable === undefined) continue;
    const refersTo = (node: ts.Node): boolean => ts.isIdentifier(node) && node.text === variable;
    if (statements.slice(index + 1, target).some((later) => isReturningIf(later, refersTo))) return sourced(index);
  }
  return 'unguarded';
}

/** 関数の本体の文(式の本体は 1 文として扱う)。 */
function bodyStatements(fn: FunctionNode): readonly ts.Statement[] {
  const body = fn.body;
  if (body === undefined) return [];
  return ts.isBlock(body) ? body.statements : [ts.factory.createExpressionStatement(body)];
}

/**
 * 1 本のモジュールの、export した関数ごとの判定を返す。
 *
 * @param fileName ファイル名(AST の診断用)
 * @param source 本文
 * @param guard 関門の部品
 * @param isTarget import の指定子 → 本体の口か
 * @param guardSource 関門に渡す値の出どころの要求(任意)
 * @returns export した関数ごとの判定(ファイルの順)
 */
export function exportedGuards(
  fileName: string,
  source: string,
  guard: GuardSpec,
  isTarget: (specifier: string) => boolean,
  guardSource?: GuardSource,
): readonly ExportGuard[] {
  const file = parseModule(fileName, source);
  const ctx: Context = { bindings: importBindings(file), guard, isTarget, source: guardSource };
  return exportedFunctions(file).map(([name, fn]) => ({ name, state: stateOf(bodyStatements(fn), ctx) }));
}
