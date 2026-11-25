/**
 * 生成物に埋め込む HTML 断片の共通ヘルパー。
 *
 * ハンドブック(docs/book/)は VitePress で閲覧され、Markdown 中の生 HTML は
 * **空行を含まない連続したブロック**でないと途中で Markdown 解釈に戻ってしまう
 * (markdown-it の HTML ブロック規則)。断片を組み立てる各レンダラーが同じ罠を
 * 踏まないよう、結合とエスケープをここに 1 つだけ置く。
 */

/**
 * HTML のテキスト・属性値に埋め込む文字列をエスケープする。
 *
 * @param text 仕様由来の文字列(画面名・ルートなど)
 * @returns エスケープ済みの文字列
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 見出しテキストからアンカー(スラッグ)を作る。
 *
 * VitePress(github-slugger 系)は snake_case の `_` もハイフンに寄せるため、
 * `### workshop_detail` のアンカーは `#workshop-detail` になる。見出しへリンクを張る
 * 生成器(遷移図の click 指令・一覧表)はこの写像を通す。
 *
 * @param text 見出しのテキスト(画面名など)
 * @returns アンカー名(先頭の `#` を含まない)
 */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

