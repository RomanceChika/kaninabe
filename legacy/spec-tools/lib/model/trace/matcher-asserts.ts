/**
 * テストの断片から「matcher で終わる `expect(...)`」だけを構文木で数える純粋関数。
 *
 * **なぜ字句で数えないのか。** `expect(x)` だけの文は何も主張しない —— matcher(`.toBe(...)` 等)を
 * 呼んで初めて検査になる。以前の A16 は `expect(` という字面を数えたので、保証テストの 3 行を
 * `expect(isCronAuthorized(undefined, null));`(matcher 無し)に書き換えても「assert あり」と
 * 数えられ、秘密が未設定でも `Bearer undefined` で Cron の口が開く本物のバグが、保証台帳が
 * `enforced` と言う見張りテストを素通りした(網の穴探し 2026-10-06 の M31。カバレッジも 100% のまま)。
 *
 * 数えるのは「`expect(...)` を根に持ち、**matcher の呼び出しで終わる**メンバ連鎖」である。
 * 間に `.not` / `.resolves` / `.rejects` を挟んでよい(`expect(p).rejects.toThrow()` /
 * `expect(x).not.toBe(1)`)。連鎖の途中で止まるもの(`expect(x);` / `expect(x).not;` /
 * `expect(x).resolves;`)と、matcher を呼ばないもの(`expect(x).toBe;`)は数えない。
 *
 * ファイル I/O は行わない(純粋関数)。切り出した断片が構文として壊れていても、TypeScript の
 * パーサは回復するので、壊れた断片の中の読める部分だけが数えられる。
 *
 * **まず TS として読み、構文エラーが出たときだけ TSX で読み直す**(束 ㉓-a2 P2)。テストの断片は
 * 型の山括弧(`const f = <T>(x: T) => x;` / `<any>foo`)を書くことがあるが、TSX で固定して読むと
 * 山括弧が JSX の開始と取り違えられ、以降の `expect(...)` が 1 つも数えられずに「assert を 1 つも
 * 持たない」という誤報になる。逆に JSX の断片(`<div />`)は TS のままでは構文エラーになるので、
 * そのときだけ TSX に倒す(エラーの少ないほうを採る。同数なら TS)。
 */

import ts from 'typescript';

/** matcher の手前に挟んでよい修飾(`expect(x).not.toBe(...)` の `not` 等)。 */
const MODIFIERS: ReadonlySet<string> = new Set(['not', 'resolves', 'rejects']);

/**
 * 断片を関数の本体として読ませる前置き。
 *
 * `{ … }` だけだとトップレベルの `await expect(...)` が識別子と取り違えられうるので、`async` の
 * 矢印関数の本体として包む(`await` が正しい文脈に入る)。**包んだ分だけ位置がずれる**ので、
 * 返す位置からはこの長さを引く。
 */
const WRAP_PREFIX = '(async () => ';

/** パーサが報告した構文エラーの数(`parseDiagnostics` は公開型に無いので、形を確かめて読む)。 */
function syntaxErrorCount(file: ts.SourceFile): number {
  const diagnostics = (file as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  return diagnostics?.length ?? 0;
}

/**
 * 断片を読む。TS で構文エラーが出なければそれを採り、出たときだけ TSX でも読んでエラーの少ないほうを採る。
 *
 * @param text 前置きで包んだ断片
 * @returns 構文木
 */
function parseFragment(text: string): ts.SourceFile {
  const asTs = ts.createSourceFile('fragment.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (syntaxErrorCount(asTs) === 0) return asTs;
  const asTsx = ts.createSourceFile('fragment.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return syntaxErrorCount(asTsx) < syntaxErrorCount(asTs) ? asTsx : asTs;
}

/** メンバ参照(`a.b` / `a['b']`)の「名前」。名前が静的に決まらない形は null。 */
function memberName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

/** `node` を「連鎖の次の段の対象」として持つメンバ参照(でなければ null)。 */
function nextLink(node: ts.Node): ts.PropertyAccessExpression | ts.ElementAccessExpression | null {
  const parent = node.parent;
  const isLink =
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node;
  return isLink ? parent : null;
}

/** この `expect(...)` の連鎖が、matcher の呼び出しで終わっているか。 */
function endsInMatcherCall(expectCall: ts.CallExpression): boolean {
  let current: ts.Node = expectCall;
  for (;;) {
    const link = nextLink(current);
    if (link === null) return false;
    const name = memberName(link);
    if (name !== null && MODIFIERS.has(name)) {
      current = link;
      continue;
    }
    const call = link.parent;
    return ts.isCallExpression(call) && call.expression === link;
  }
}

/** `expect(...)` の呼び出し(識別子 `expect` を直接呼ぶ形)か。 */
function isExpectCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'expect';
}

/**
 * 断片の中で、matcher の呼び出しで終わる `expect(...)` の位置を集める。
 *
 * @param fragment テストの断片(`{ … }` の本体。コメント・文字列を潰さない生のテキスト)
 * @returns 各 assert の `expect` の開始位置(断片の先頭からの 0 始まり index。出現順)
 */
export function matcherAssertionOffsets(fragment: string): readonly number[] {
  const text = `${WRAP_PREFIX}${fragment})`;
  const file = parseFragment(text);
  const offsets: number[] = [];
  const visit = (node: ts.Node): void => {
    if (isExpectCall(node) && endsInMatcherCall(node)) offsets.push(node.getStart(file) - WRAP_PREFIX.length);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return offsets;
}
