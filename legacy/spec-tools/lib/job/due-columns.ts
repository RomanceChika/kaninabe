/**
 * ソースの中で「期限が来たか」の比較に使われている列名を、構文木で集める純粋関数(J2 の `due_from` の接地)。
 *
 * 走査の「いつ」(`due_from: {entity}.{field}`)は、実装の読み取り口(reader)が**その列で絞る**ことで
 * 初めて本当になる。仕様の列名を変えても reader が旧い列のまま動けば、カタログは別の時刻を名指しながら
 * 実装は元の時刻で走る —— 全部緑のまま仕様が嘘になる(網の穴探し 2026-10-06 の M04)。
 *
 * **なぜ「列名の文字列リテラルが現れる」だけでは足りないのか。** 同じ読み取り口が別の目的で同じ綴りを
 * 持つことがある(「まだ始まっていない」を `starts_at` の `gt` で外す、など)。綴りだけを見ると、
 * due_from を `starts_at` に書き換えても通ってしまう。**期限の比較**は「列 ≦ 現在」であり、読み取り口の
 * DB クライアントの語彙ではそれを表す呼び名が決まっている(`lte` / `lt`)。ここで数えるのは
 * **その呼び名の呼び出しの第 1 引数に置かれた文字列リテラル**だけである。
 *
 * 列名を定数に切り出した reader は、リテラルが呼び出しの引数に現れないので数えられない(落ちる側に倒す。
 * 黙って通すよりは「接地の形を直す」を促す方が安全)。ファイル I/O は行わない。
 */

import ts from 'typescript';

/** 期限の比較(列 ≦ 現在)を表す呼び名。読み取り口の DB クライアントの語彙(製品の語ではない)。 */
export const DUE_COMPARATORS: ReadonlySet<string> = new Set(['lte', 'lt']);

/** 呼び出し `x.name(...)` の `name`(メンバ呼び出しでなければ null)。 */
function calledMember(call: ts.CallExpression): string | null {
  const callee = call.expression;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
}

/**
 * 1 本のソースから、期限の比較の列名を集める。
 *
 * @param fileName 構文木の種類を決めるためのファイル名(`x.ts` / `x.tsx`)
 * @param text ソースの本文
 * @returns 期限の比較(`DUE_COMPARATORS`)の呼び出しの第 1 引数にある文字列リテラルの集合
 */
export function dueComparedColumns(fileName: string, text: string): ReadonlySet<string> {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const columns = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const member = calledMember(node);
      const first = node.arguments[0];
      if (member !== null && DUE_COMPARATORS.has(member) && first !== undefined && ts.isStringLiteralLike(first)) {
        columns.add(first.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return columns;
}
