/**
 * 仕様の自由文の中の「例 …」を、本文から分ける(ブックの出し方だけ。仕様の文は変えない)。
 *
 * 仕様の筆者は説明の文の中に例示を括弧や読点で挟む(`(例 …)` / `。例 …`)。そのまま出すと、例示が決まりごとの
 * 一部に読める(例の値が既定の値に見える)。そこで本文と例示を分け、例示は `例` のラベル行に出す。
 * 分けるのは「例」の直前が `(` / `（` / `。` / `、` / 文頭 のものだけで、例示の終わりは `)` / `）` / `。` / 文末。
 * 例が無い文は、そのまま本文に返す。純粋関数で、投げない。
 */

/** 本文と例示。 */
export interface ProseWithExamples {
  /** 例示を取り除いた本文(括弧が空になったら畳む)。 */
  readonly body: string;
  /** 取り出した例示(出てきた順)。 */
  readonly examples: readonly string[];
}

/** 「例 …」の見つけ方。直前の区切りと例示の本文を分けて拾う。 */
const EXAMPLE = /(^|[(（。、])例[ 　]+([^)）。]+)/g;

/**
 * 文から「例 …」を取り出す。
 *
 * @param text 仕様の自由文(1 行)
 * @returns 例示を除いた本文と、取り出した例示
 */
export function splitExamples(text: string): ProseWithExamples {
  const examples: string[] = [];
  const stripped = text.replace(EXAMPLE, (_whole, lead: string, example: string) => {
    examples.push(example.trim());
    // 括弧の開きは残す(空になれば下で畳む)。文頭・句点・読点は取り去る。
    return lead === '(' || lead === '（' ? lead : '';
  });
  const body = stripped
    .replace(/[(（]\s*[)）]/g, '')
    .replace(/。\s*([)）])/g, '$1')
    .replace(/([(（])\s*。/g, '$1')
    .replace(/。{2,}/g, '。')
    .trim();
  return { body: examples.length === 0 ? text : body, examples };
}
