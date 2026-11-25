/**
 * ソースに**生の制御文字**を埋めるのを禁じる（git がバイナリ扱いにして diff が読めなくなる）。
 *
 * 発端は束 ㉔ で、畳みの鍵の区切りに NUL を埋めてしまい**束の中心のファイルがレビューで
 * 1 行も読めなかった**（独立レビュー 2 回目 F4'）。直したつもりで `no-restricted-syntax` の
 * 2 つのセレクタ（`Literal` / `TemplateElement`）に載せたが、それは 3 つの穴を持っていた ——
 * 束 ①-c-d の独立レビューが `--print-config` で実測した。
 *
 *   1. **フラット config の後勝ち。** 同じ `no-restricted-syntax` を別ブロックで再定義すると
 *      配列は合成されず**丸ごと置き換わる**ので、docs 側では `lib/generate/**` と `lib/diff/**`
 *      で制御文字の 2 本が消えていた（そしてその穴の中に生きた違反が住んでいた）。
 *      **規則の名前が別なら、誰の再定義にも消されない。**
 *   2. **リテラルの外は見ない。** コメント・正規表現リテラル・識別子に埋まった制御文字は
 *      AST のセレクタに当たらないが、git の判定は文字が**どこにあるか**を問わない。
 *   3. **母集合が docs だけだった。** `app/**` と `framework/**` は対象外で、実際に
 *      `app/e2e` のウォーカーに NUL が 1 つ住んでいた（`grep` が黙って 0 件を返す状態）。
 *
 * だから**生のテキストを見る**。許すのはタブ・改行・復帰だけで、区切りが要るなら可視文字か
 * **エスケープ表記**を使う。エスケープなら意味は同じ 1 文字で、ソースは ASCII のままである。
 */

/** 禁じる制御文字（タブ・改行・復帰だけを外した閉じた集合）。 */
const CONTROL_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** @type {import("eslint").Rule.RuleModule} */
export const noRawControlChar = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'ソースに生の制御文字を埋めるのを禁じる（git がバイナリ扱いにして diff が読めなくなる）',
    },
    schema: [],
    messages: {
      raw: 'ソースに生の制御文字(U+{{code}})を埋めない —— git がそのファイルをバイナリと判定して diff を 1 行も見せなくなる(束 ㉔ で実際にレビューできなくなった)。区切りが要るなら可視文字か、エスケープ表記(バックスラッシュ u 0000 のような書き方。意味は同じ 1 文字)を使うこと。',
    },
  },
  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const text = sourceCode.getText();
        for (const match of text.matchAll(CONTROL_CHAR)) {
          const index = match.index ?? 0;
          const code = (match[0].codePointAt(0) ?? 0).toString(16).padStart(4, '0').toUpperCase();
          context.report({
            loc: sourceCode.getLocFromIndex(index),
            messageId: 'raw',
            data: { code },
          });
        }
      },
    };
  },
};
