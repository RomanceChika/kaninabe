/**
 * 枠の設定ファイル(Next.js の `next.config.*`)の**既定の export の鍵が許可表の中だけ**かを、構文木で見る(J2 の続き。7 回目 C7-4)。
 *
 * 以前は禁止の欄(`pageExtensions`)を字面の正規表現 1 本で探していた。設定ファイルは実行される TypeScript / JavaScript なので、
 * 識別子の Unicode エスケープ(`pageExtensions`)・計算した鍵(`[k]`)・別ファイルからの import(`export default base`)で
 * 同じ欄を字面に出さずに書けた。**拒否の字面ではなく許可表で閉じる**: 静的に読める形だけを受け、読めない形は全部 error にする。
 *
 * 受ける形(これ以外は全部 error):
 *
 * | 形 | 扱い |
 * |---|---|
 * | `export default { … }`(`as` / `satisfies` / 括弧は剥がす) | 鍵を見る |
 * | `const x = { … }; export default x;`(同じファイルの最上位の `const`) | 鍵を見る。`x` を宣言と export 以外で触る(`x.rewrites = …` / `Object.assign(x, …)`)と error |
 * | `module.exports = { … }`(CommonJS の `.js`) | 同上 |
 * | 鍵 = エスケープの無い識別子か文字列 | 許可表にあれば通す |
 * | 計算した鍵・スプレッド・数の鍵・get / set・エスケープを含む鍵 | error |
 * | import した値・関数の呼び出し(`withX(config)`)・関数(`(phase) => ({…})`)・`export { x as default }` | error(静的に鍵を読めない) |
 *
 * 入れ子の値(`typescript: { tsconfigPath }`)の中身は見ない(許可表の欄は、どれも口の母集合を変えない欄だけを載せる)。
 * ただし**値の形を固定した欄**(`fixedMembers`。Next.js では `headers` と `poweredByHeader`)は、その欄の文全体が表の綴りと字句の並びで
 * 一致しなければ error にする(空白・コメント・引用符の種類は問わない)。`headers()` が生成物の 1 本だけを返す形を外れて
 * `Cache-Control: public` などを足すと、前段の no-store の上を上書きできる(点検 7 回目 B7-4)。
 * 呼び手が `required` を渡すと、値を固定した欄を**書かない**ことも error にする(欄を消すと守りのヘッダが黙って消える。点検 16 回目 C16-3)。
 */

import ts from 'typescript';

/** ファイル名からスクリプトの種類を決める。 */
function scriptKindOf(file: string): ts.ScriptKind {
  if (/\.[cm]?js$/u.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** `as` / `satisfies` / 括弧 / 型の主張を剥がす。 */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/** `module.exports = X` の右辺(その形でなければ undefined)。 */
function commonJsExport(statement: ts.Statement): ts.Expression | undefined {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const expression = statement.expression;
  if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return undefined;
  const left = expression.left;
  if (ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.expression) && left.expression.text === 'module' && left.name.text === 'exports') return expression.right;
  return undefined;
}

/** 既定の export の式(最上位の `export default X` か `module.exports = X`)。読めない形・複数は理由。 */
function defaultExportOf(source: ts.SourceFile): ts.Expression | string {
  const found: ts.Expression[] = [];
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement) && statement.isExportEquals !== true) found.push(statement.expression);
    const cjs = commonJsExport(statement);
    if (cjs !== undefined) found.push(cjs);
    if (ts.isExportDeclaration(statement)) return '`export { … }` で既定の export を書いている(静的に鍵を読めない)';
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true) {
      return '既定の export が関数・クラスの宣言(静的に鍵を読めない)';
    }
  }
  if (found.length === 0) return '既定の export が見つからない(`export default { … }` の形で書く)';
  if (found.length > 1) return '既定の export が複数ある';
  return found[0] as ts.Expression;
}

/** 最上位の `const 名前 = 初期値` の初期値(無ければ undefined)。 */
function topLevelConst(source: ts.SourceFile, name: string): ts.Expression | undefined {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.initializer;
    }
  }
  return undefined;
}

/** ファイルの中で、その名前の識別子が現れる回数(宣言と export も含む)。 */
function identifierCount(source: ts.SourceFile, name: string): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

/** 鍵の静的な綴り(エスケープの無い識別子か文字列)。読めない鍵は理由。 */
function staticKey(member: ts.ObjectLiteralElementLike, source: ts.SourceFile): { key: string } | { problem: string } {
  if (ts.isSpreadAssignment(member)) return { problem: `スプレッド(${member.getText(source)})` };
  if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) return { problem: `get / set(${member.name.getText(source)})` };
  const name = member.name;
  if (ts.isIdentifier(name)) {
    return name.getText(source) === name.text ? { key: name.text } : { problem: `エスケープを含む識別子の鍵(${name.getText(source)})` };
  }
  if (ts.isStringLiteral(name)) {
    const raw = name.getText(source);
    return raw.slice(1, -1) === name.text ? { key: name.text } : { problem: `エスケープを含む文字列の鍵(${raw})` };
  }
  return { problem: `静的でない鍵(${name.getText(source)})` };
}

/**
 * 字句の並び(空白・コメントを捨て、文字列のリテラルは値で比べる)。値の形を固定した欄の突き合わせに使う。
 *
 * @param text 本文の断片
 * @returns 字句の綴りの列
 */
export function tokensOf(text: string): readonly string[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const tokens: string[] = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const isString = kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral;
    tokens.push(isString ? JSON.stringify(scanner.getTokenValue()) : scanner.getTokenText());
  }
  return tokens;
}

/**
 * 枠の設定ファイルの既定の export が、許可表の鍵だけを持つ同じファイルのオブジェクトのリテラルか。違えば理由(通れば null)。
 *
 * @param file 設定ファイルの名前(スクリプトの種類を決める)
 * @param text 設定ファイルの本文
 * @param allowedKeys 許す鍵の表
 * @param fixedMembers 値の形を固定した欄(鍵 → その欄の文全体の綴り)。書くならこの綴りと字句の並びで一致しなければならない(省略は固定しない)
 * @param required true なら `fixedMembers` の欄を全部書くことを要する(書いていない欄は理由に挙げる。点検 16 回目 C16-3)
 */
export function frameConfigKeysProblem(file: string, text: string, allowedKeys: readonly string[], fixedMembers: Readonly<Record<string, string>> = {}, required = false): string | null {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  // `parseDiagnostics` は公開型に無いので、交差型で形を足して読む(matcher-asserts.ts と同じ読み方)。
  const parseErrors = (source as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (parseErrors.length > 0) return '構文として読めない';
  const exported = defaultExportOf(source);
  if (typeof exported === 'string') return exported;
  let target = unwrap(exported);
  if (ts.isIdentifier(target)) {
    const name = target.text;
    const initializer = topLevelConst(source, name);
    if (initializer === undefined) return `既定の export の \`${name}\` が同じファイルの最上位の const でない(import した値・let・関数の引数は静的に鍵を読めない)`;
    // 宣言 1 回 + export 1 回より多く現れれば、どこかで書き足している(`x.rewrites = …` / `Object.assign(x, …)`)かもしれない。
    if (identifierCount(source, name) !== 2) return `既定の export の \`${name}\` を宣言と export のほかで使っている(後から鍵を足せる)`;
    target = unwrap(initializer);
  }
  if (!ts.isObjectLiteralExpression(target)) return '既定の export がオブジェクトのリテラルでない(関数の呼び出し・関数・import した値は静的に鍵を読めない)';
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const member of target.properties) {
    const read = staticKey(member, source);
    if (!('problem' in read)) seen.add(read.key);
    if ('problem' in read) problems.push(read.problem);
    else if (!allowedKeys.includes(read.key)) problems.push(`許可表の外の欄 ${read.key}`);
    else if (Object.hasOwn(fixedMembers, read.key) && tokensOf(member.getText(source)).join(' ') !== tokensOf(fixedMembers[read.key] ?? '').join(' ')) {
      problems.push(`欄 ${read.key} の値が決まった形(${fixedMembers[read.key] ?? ''})でない`);
    }
  }
  if (required) problems.push(...Object.keys(fixedMembers).filter((key) => !seen.has(key)).map((key) => `欄 ${key} が無い(${fixedMembers[key] ?? ''} を書く)`));
  return problems.length === 0 ? null : problems.join('・');
}
