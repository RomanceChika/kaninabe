/**
 * 関門のある画面の描画の順を読む(点検 14 回目 B14-1 の仕上げ。ビルドの入口の関所の入力)。
 *
 * Next.js は同じ描画の兄弟を関門の結果を待たずに流す。関門は画面ごとに、描画の最初の `await` でなければ 307 / 404 の本文に値が載る。
 * 形は 2 段である: page の最初の値の `await` が器の描画(`renderXxxScreen`)で、器の最初の `await` が関門。**構文木で読む**(15 回目 C15-6。字面で読むと文字列の中の `/*` で `await` が隠れる)。
 * 読むのは関数の本体の中の `await` を出てくる順に全部で、読めない形は赤の側に倒す。入れ子の関数・分岐の下の `await` も順に数えるが、**関門としては数えない**(関門の前に置けば赤になり、そこで関門を待っても描画を止めない)。
 */

import ts from 'typescript';

/** 関数の中の `await` 1 つ。 */
interface AwaitRead {
  /** 相手の綴り(呼び出しは呼ぶ先、ほかは式の字面)。 */
  readonly name: string;
  /** 関数の本体の直の流れでなく、入れ子の関数や分岐の下にある。 */
  readonly nested: boolean;
}

/** page の `await` のうち値を読まない 1 つ(動的セグメントの受け取り)。 */
const PARAMS_AWAIT = /^(?:props\.)?params$/;

/** 器の描画の関数の名前の形。 */
const RENDER_NAME = /^render[A-Z]\w*Screen$/;

/** `node` が `body` の直の流れの外か(関数・分岐・繰り返し・`try`・三項・短絡の下)。 */
function underBranchOrFunction(node: ts.Node, body: ts.Node): boolean {
  for (let current = node.parent; current !== body; current = current.parent) {
    if (ts.isFunctionLike(current) || ts.isIfStatement(current) || ts.isIterationStatement(current, false) || ts.isSwitchStatement(current) || ts.isTryStatement(current) || ts.isConditionalExpression(current)) return true;
    if (ts.isBinaryExpression(current) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(current.operatorToken.kind)) return true;
  }
  return false;
}

/** 関数の本体の `await` を出てくる順に全部読む。 */
function awaitsIn(body: ts.Node, file: ts.SourceFile): readonly AwaitRead[] {
  const found: AwaitRead[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isAwaitExpression(node)) {
      const target = ts.isCallExpression(node.expression) ? node.expression.expression : node.expression;
      found.push({ name: target.getText(file), nested: underBranchOrFunction(node, body) });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

/** 文字列からファイルの構文木を作る。 */
function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('module.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** 文の修飾子に `kind` があるか。 */
function hasModifier(statement: ts.FunctionDeclaration, kind: ts.SyntaxKind): boolean {
  return statement.modifiers?.some((modifier) => modifier.kind === kind) === true;
}

/** 最上位の `export async function` のうち `match` に当たるものの本体。 */
function exportedAsyncBody(file: ts.SourceFile, match: (statement: ts.FunctionDeclaration) => boolean): ts.Block | undefined {
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body !== undefined && hasModifier(statement, ts.SyntaxKind.ExportKeyword) && hasModifier(statement, ts.SyntaxKind.AsyncKeyword) && match(statement)) return statement.body;
  }
  return undefined;
}

/** page の描画の読み取り。 */
export interface PageRender {
  /** 器の描画の関数の名前。 */
  readonly render: string;
  /** その関数を import する指定子。 */
  readonly specifier: string;
}

/** 名前を import する指定子(無ければ undefined)。 */
function importSpecifierOf(file: ts.SourceFile, name: string): string | undefined {
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.some((element) => element.name.text === name)) return statement.moduleSpecifier.text;
  }
  return undefined;
}

/**
 * page が待つ器の描画を読む。
 *
 * @param source `page.tsx` の中身
 * @returns 器の描画(最初の値の `await` が器でない・import が読めないなら null)
 */
export function pageRender(source: string): PageRender | null {
  const file = parse(source);
  const body = exportedAsyncBody(file, (statement) => hasModifier(statement, ts.SyntaxKind.DefaultKeyword));
  const first = body === undefined ? undefined : awaitsIn(body, file).find((read) => !PARAMS_AWAIT.test(read.name));
  if (first === undefined || first.nested || !RENDER_NAME.test(first.name)) return null;
  const specifier = importSpecifierOf(file, first.name);
  return specifier === undefined ? null : { render: first.name, specifier };
}

/**
 * 器の最初の `await` が関門かを読む。
 *
 * @param source 器のファイルの中身
 * @param render 器の描画の関数の名前
 * @param symbols 関門の実装の名前(順に)
 * @returns 順が守られていれば true
 */
export function shellAwaitsGates(source: string, render: string, symbols: readonly string[]): boolean {
  const file = parse(source);
  const body = exportedAsyncBody(file, (statement) => statement.name?.text === render);
  if (body === undefined || symbols.length === 0) return false;
  const awaited = awaitsIn(body, file);
  return symbols.every((symbol, index) => awaited[index]?.name === symbol && awaited[index].nested === false);
}
