/**
 * ハンドブックの章から、**検証の結果(警告)と変異の目録に依る部分だけ**を切り出す
 * (ハンドブックだけを出す入口と全部入りの `generate` の出力を比べるための道具。`--check`〔`book-entry-check.ts`〕とテストが同じ 1 本を使う)。
 *
 * 入口は検証も変異も回さないので、その 2 つに依る部分だけが全部入りと違うはずである。本は HTML を直接書き出すので、比べ方は 1 種類だけ:
 * **生成器が印(`data-dep="verify"`)を付けた要素を中身ごと切り出す**(`cutVerification`)。印を付ける側(`html/face-parts.ts` の `verified`)が、
 * 依る部分を要素で包む。許す差の範囲は印で固定され、印の外は 1 バイトも違ってはいけない(語句の正規化・「行ごと捨てる」はしない)。
 * 切り出した印の数は章ごとに数えて返し、`--check` の出力に出る。HTML でない資材(CSS・script・JSON)は印を持たないので、行に割るだけで比べる。
 */

/** 切り出した後の本文と、切り出した印の数。 */
export interface VerificationCut {
  readonly lines: readonly string[];
  /** 切り出した要素(印の付いたもの)の数。 */
  readonly fragments: number;
}

/**
 * 検証に依る部分を切り出した本文(行の配列)と、切り出した印の数。
 *
 * @param text 章(HTML)・資材の本文
 */
export function cutVerification(text: string): VerificationCut {
  return text.startsWith('<!doctype html>') ? cutHtmlVerification(text) : { lines: text.split('\n'), fragments: 0 };
}

/** HTML の本の、検証の結果に依る部分の印(`html/face-parts.ts` の `verified`)。 */
const HTML_DEP = ' data-dep="verify"';

/**
 * HTML の本の章から、検証の結果に依る部分を切り出す。**切り出すのは印(`data-dep="verify"`)の付いた要素だけ**で、要素を中身ごと 1 つの記号に置き換える。
 * 印の外は 1 バイトも違ってはいけない(語句の正規化はしない。印を付ける側が、依る部分を要素で包む)。
 * 生成器が組んだ HTML なので、同じ名前のタグの開きと閉じを数えれば要素の終わりが決まる。比べやすいよう、タグの境目で行に割る。
 *
 * @param text 章の HTML
 */
function cutHtmlVerification(text: string): VerificationCut {
  let out = '';
  let fragments = 0;
  let index = 0;
  for (;;) {
    const mark = text.indexOf(HTML_DEP, index);
    if (mark === -1) break;
    const start = text.lastIndexOf('<', mark);
    const tag = /^<([a-z0-9]+)/.exec(text.slice(start))?.[1];
    // 読めない印は切らずに残す(残りをそのまま比べるので、検証に依る違いは食い違いとして表に出る)。
    if (tag === undefined) break;
    const tokens = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g');
    tokens.lastIndex = start;
    let depth = 0;
    let end = -1;
    for (let token = tokens.exec(text); token !== null; token = tokens.exec(text)) {
      depth += token[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        end = token.index + token[0].length;
        break;
      }
    }
    if (end === -1) break;
    out += `${text.slice(index, start)}〔検証〕`;
    fragments += 1;
    index = end;
  }
  out += text.slice(index);
  return { lines: out.replace(/></g, '>\n<').split('\n'), fragments };
}
