/**
 * 凍結の関所(`frozen-constants.ts`)の読み手: 生成物のファイルが外へ出す値を、**構文木で全部**読む(閉じた読み手)。
 *
 * 以前は `export const …` の正規表現と初期化子の先頭の字面で見ていて、別名の先が凍っていない形・`;` を含む型の注釈・
 * `export { }`・文字列で始まる式を 0 件で通した(点検 11 回目 A11-2)。ここでは読める形を閉じる。
 *
 * | 外へ出す形 | 読み方 |
 * |---|---|
 * | `export const` の宣言・`export { 名前 }`・`export { 名前 as 別名 }`・`export default 式` | 初期化子を下の表で判定する |
 * | `export let` / `var`・分割代入・`export *`・`export … from`・`export class` / `enum` / `namespace`・`export import` | 読めない(`unreadable`) |
 * | `export function` | 定数ではないので `constants` に数えず、`exportedFunctions` に名前を返す(関所が読めない形として止める) |
 * | 型の宣言 | 定数ではないので数えない |
 *
 * 初期化子の判定(`as` / `satisfies` / 括弧ははがす):
 *
 * | 式 | 判定 |
 * |---|---|
 * | `deepFreeze(…)` で、引数が下の深いリテラルのとき | `frozen` |
 * | 文字列・テンプレート・数値・真偽値・`null`・`undefined` | `plain` |
 * | 同じファイルの `const` の名前 | その初期化子の判定(別名は名前ではなく先の値で見る) |
 * | 同じファイルの凍った値の `.欄`・`[…]` | その値の判定 |
 * | import した名前・それ以外の全部(呼び出し・`new`・オブジェクト) | `unfrozen`(このファイルの中で読めない値は凍っていると言えない) |
 *
 * **`deepFreeze` の引数の閉じた形**(点検 12 回目 A12-4): 実行時の `deepFreeze` は `Object.values` と `Object.freeze` だけなので、
 * `Map` / `Set` の中身・getter の先・インスタンスの private 欄は凍らない。読める引数は、オブジェクト・配列・原始値のリテラルと同じファイルの
 * `const` の名前(先の値も同じ形)・import した名前とその `.欄`(別のファイルの値は、そのファイルの関所が見る)と、`as` などの包みだけで、`new`・呼び出し・getter・メソッド・spread は `unfrozen` である。
 * `export function` は可変の表を返せるので、安全の表のファイルでは読めない形として数える(`exportedFunctions`)。補助の関数は同名の宣言が
 * ちょうど 1 本で、その字面が `DEEP_FREEZE_HELPER` と同じときだけ認める(後の宣言が勝つ素通しを止める)。
 *
 * **引数の外の閉じ方**(点検 13 回目 A13-6): 最上位の文は宣言・import・export に閉じる。式の文(`t.m = new Map()`・`a.push(…)`・`Object.assign(…)`)・制御の文は、凍らせる前の値へ足せるので
 * 読めない形として数える。`__proto__` の鍵は `Object.values` が辿らない継承の先を作るので深いリテラルに数えない。`deepFreeze` と同名の変数は実行時に補助の関数を差し替えるので、補助の関数を認めない。
 *
 * 型だけの import / export は値を持たないので数えない。純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import ts from 'typescript';
import { DEEP_FREEZE, DEEP_FREEZE_HELPER } from './code-emit.js';

/** 初期化子の判定。 */
export type InitializerState = 'frozen' | 'plain' | 'unfrozen';

/** 外へ出す定数 1 本。 */
export interface ExportedConstant {
  readonly name: string;
  readonly state: InitializerState;
}

/** ファイル 1 本を読んだ結果。 */
export interface FileExports {
  readonly constants: readonly ExportedConstant[];
  /** 読めない形の説明(読めない形は凍っていると言えないので、関所の対象のファイルでは赤にする)。 */
  readonly unreadable: readonly string[];
  /** 最上位に宣言した値の名前(`export { ROLE_GATES as x }` のように外への名前を替えても、一覧の定数を見逃さないため)。 */
  readonly declared: ReadonlySet<string>;
  /** 外へ出す名前のうち読めない形のもの(`export { ROLE_GATES } from …`。一覧の定数を見逃さないため)。 */
  readonly unreadableNames: ReadonlySet<string>;
  /** `DEEP_FREEZE_HELPER` と字面が同じ補助の関数の定義がちょうど 1 本か(同名の素通しの関数を通さない)。 */
  readonly helper: boolean;
  /** 外へ出す関数の名前(宣言順。戻り値は読めないので、安全の表のファイルでは止める)。 */
  readonly exportedFunctions: readonly string[];
}

/** 空白を畳む(補助の関数の字面の比較用)。 */
function squeeze(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** 補助の関数の宣言の字面(ドキュメントコメントを除く)。 */
const HELPER_TEXT = squeeze(DEEP_FREEZE_HELPER.filter((line) => !line.startsWith('/**')).join('\n'));

/** 式を包むだけの構文をはがす。 */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** 原始値のリテラルか。 */
function isPlainLiteral(expression: ts.Expression): boolean {
  if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression) || ts.isBigIntLiteral(expression) || ts.isTemplateExpression(expression)) return true;
  if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword || expression.kind === ts.SyntaxKind.NullKeyword) return true;
  return ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expression.operand);
}

/** 名前の読み先(最上位の `const` と、値の import)。 */
interface Scope {
  readonly locals: ReadonlyMap<string, ts.Expression>;
  readonly imports: ReadonlySet<string>;
}

/** 深いリテラルの要素 1 つか(getter・メソッド・spread は読めない)。 */
function isDeepProperty(property: ts.ObjectLiteralElementLike, scope: Scope, seen: ReadonlySet<string>): boolean {
  if (ts.isShorthandPropertyAssignment(property)) return isDeepIdentifier(property.name.text, scope, seen);
  if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) return false;
  if (property.name.text === '__proto__') return false;
  return isDeepLiteral(property.initializer, scope, seen);
}

/** 同じファイルの `const` の名前で先の値が深いリテラルか、import した名前か(別のファイルの値は、そのファイルの関所が見る)。 */
function isDeepIdentifier(name: string, scope: Scope, seen: ReadonlySet<string>): boolean {
  if (name === 'undefined' || scope.imports.has(name)) return true;
  const target = scope.locals.get(name);
  return target !== undefined && !seen.has(name) && isDeepLiteral(target, scope, new Set([...seen, name]));
}

/** `deepFreeze` が全部を凍らせられる値か(オブジェクト・配列・原始値のリテラルと、その名前だけ)。 */
function isDeepLiteral(expression: ts.Expression, scope: Scope, seen: ReadonlySet<string>): boolean {
  const inner = unwrap(expression);
  if (isPlainLiteral(inner)) return true;
  if (ts.isIdentifier(inner)) return isDeepIdentifier(inner.text, scope, seen);
  if (ts.isPropertyAccessExpression(inner)) return ts.isIdentifier(inner.expression) && scope.imports.has(inner.expression.text);
  if (ts.isArrayLiteralExpression(inner)) return inner.elements.every((element) => !ts.isSpreadElement(element) && isDeepLiteral(element, scope, seen));
  if (ts.isObjectLiteralExpression(inner)) return inner.properties.every((property) => isDeepProperty(property, scope, seen));
  return false;
}

/** 初期化子の判定(`scope.locals` = 最上位の `const` の名前 → 初期化子。`seen` は循環の止め)。 */
function stateOf(expression: ts.Expression, scope: Scope, seen: ReadonlySet<string>): InitializerState {
  const inner = unwrap(expression);
  if (ts.isCallExpression(inner)) {
    const [argument] = inner.arguments;
    const called = ts.isIdentifier(inner.expression) && inner.expression.text === DEEP_FREEZE && inner.arguments.length === 1;
    return called && argument !== undefined && isDeepLiteral(argument, scope, seen) ? 'frozen' : 'unfrozen';
  }
  if (isPlainLiteral(inner)) return 'plain';
  if (ts.isIdentifier(inner)) {
    if (inner.text === 'undefined') return 'plain';
    const target = scope.locals.get(inner.text);
    if (target === undefined || seen.has(inner.text)) return 'unfrozen';
    return stateOf(target, scope, new Set([...seen, inner.text]));
  }
  if (ts.isPropertyAccessExpression(inner) || ts.isElementAccessExpression(inner)) {
    return stateOf(inner.expression, scope, seen) === 'frozen' ? 'frozen' : 'unfrozen';
  }
  return 'unfrozen';
}

/** `export` の修飾子があるか。 */
function isExported(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/** 宣言の名前の全部(分割代入なら中の名前)。 */
function boundNames(name: ts.BindingName): readonly string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isBindingElement(element) ? boundNames(element.name) : []));
}

/** 最上位の `const` の名前 → 初期化子(分割代入の無い宣言だけ)と、最上位の値の名前。 */
function topLevel(file: ts.SourceFile): { readonly locals: ReadonlyMap<string, ts.Expression>; readonly declared: ReadonlySet<string> } {
  const locals = new Map<string, ts.Expression>();
  const declared = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      for (const name of boundNames(declaration.name)) declared.add(name);
      if (isConst && ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) locals.set(declaration.name.text, declaration.initializer);
    }
  }
  return { locals, declared };
}

/** 値の import の名前(型だけの import は値を持たないので数えない)。 */
function importedNames(file: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    const clause = ts.isImportDeclaration(statement) ? statement.importClause : undefined;
    if (clause === undefined || clause.isTypeOnly) continue;
    if (clause.name !== undefined) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    else bindings.elements.filter((element) => !element.isTypeOnly).forEach((element) => names.add(element.name.text));
  }
  return names;
}

/** 構文の誤りの件数(`parseDiagnostics` は公開型に無いので、交差型で形を足して読む。matcher-asserts.ts と同じ読み方)。 */
function syntaxErrors(file: ts.SourceFile): number {
  return (file as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length ?? 0;
}

/**
 * ファイルが外へ出す値を読む。
 *
 * @param fileName 生成物のファイル名
 * @param content ファイルの中身
 * @returns 外へ出す定数・読めない形・補助の関数の有無
 */
export function readFileExports(fileName: string, content: string): FileExports {
  const file = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, false);
  const { locals, declared } = topLevel(file);
  const scope: Scope = { locals, imports: importedNames(file) };
  const constants: ExportedConstant[] = [];
  const unreadable: string[] = [];
  const unreadableNames = new Set<string>();
  const helpers: string[] = [];
  let shadowed = false;
  const exportedFunctions: string[] = [];

  const fromName = (exported: string, local: string): void => {
    const target = locals.get(local);
    constants.push({ name: exported, state: target === undefined ? 'unfrozen' : stateOf(target, scope, new Set([local])) });
  };

  if (syntaxErrors(file) > 0) unreadable.push('構文を読めません');
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      if (statement.name?.text === DEEP_FREEZE) helpers.push(squeeze(statement.getText(file)));
      if (isExported(statement)) exportedFunctions.push(statement.name?.text ?? 'default');
    } else if (ts.isVariableStatement(statement)) {
      if (statement.declarationList.declarations.some((declaration) => boundNames(declaration.name).includes(DEEP_FREEZE))) shadowed = true;
      if (!isExported(statement)) continue;
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of statement.declarationList.declarations) {
        const names = boundNames(declaration.name);
        if (!ts.isIdentifier(declaration.name)) {
          unreadable.push(`分割代入の export(${names.join(', ')})`);
          names.forEach((name) => unreadableNames.add(name));
        } else if (!isConst) {
          unreadable.push(`const でない export ${declaration.name.text}(束縛ごと差し替えられる)`);
          unreadableNames.add(declaration.name.text);
        } else {
          fromName(declaration.name.text, declaration.name.text);
        }
      }
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const named = statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause) ? statement.exportClause.elements.filter((element) => !element.isTypeOnly) : null;
      if (statement.moduleSpecifier !== undefined || named === null) {
        unreadable.push(`別のファイルからの再 export(${statement.getText(file)})`);
        (named ?? []).forEach((element) => unreadableNames.add(element.name.text));
      } else {
        for (const element of named) fromName(element.name.text, (element.propertyName ?? element.name).text);
      }
    } else if (ts.isExportAssignment(statement)) {
      constants.push({ name: 'default', state: stateOf(statement.expression, scope, new Set()) });
    } else if (isExported(statement) && !ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) {
      unreadable.push(`読めない形の export(${statement.getText(file).split('\n')[0] ?? ''})`);
    } else if (!ts.isImportDeclaration(statement) && !ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) {
      unreadable.push(`最上位の読めない文(${statement.getText(file).split('\n')[0] ?? ''})`);
    }
  }
  return { constants, unreadable, declared, unreadableNames, helper: !shadowed && helpers.length === 1 && helpers[0] === HELPER_TEXT, exportedFunctions };
}
