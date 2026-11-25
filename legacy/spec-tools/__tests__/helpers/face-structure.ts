/**
 * 人向けの表示の章の**構造**を、生成された markdown から機械で見る(目視の代わり)。
 *
 * 視覚の原則(book-human-face.md §7-4)は「見た目」の話だが、守られているかは構造から言える:
 * 読み方の印の種類・見出しの深さ・1 画面の要素種・既定で開く項目の数・ラベルの語の値域。
 * ここは**問題の一覧**を返す純関数で、空なら構造は規則どおりである。生成した章(フィクスチャと本番の
 * 両方)に当て、壊したときに本当に落ちること(わざと壊す確認)も同じ関数で固定する。
 */

/** HTML の断片を、文の文字列にする(等幅は M12 と同じ `` `…` `` に戻し、タグと実体参照を落とす)。 */
function sentenceText(html: string): string {
  return html
    .replace(/<span class="bf-term-tip"[^>]*>.*?<\/span>/g, '')
    .replace(/<span class="bf-mono">(.*?)<\/span>/g, '`$1`')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 生成器が出した定型文(人が書いた値でも、仕様の原文でもない文)を、生成した章から集める。
 *
 * 対象は 4 か所: 節の頭の箇条(`bf-pts bf-blk` の項目)・パンくずと図の下の注(`bf-note`)・
 * ライフサイクルの図のキャプション(`bf-flow-cap`)・読み方の印の凡例(`bf-legend` の説明)。ラベル行の値(`bf-kv`)は仕様の原文と宣言の写しなので含めない。
 * 文体の規則(M12 と同じ。設計メモ §7-6)を当てる入力になる。
 */
export function boilerplateSentences(markdown: string): string[] {
  const found: string[] = [];
  for (const block of markdown.matchAll(/<ul class="bf-pts bf-blk">(.*?)<\/ul>/g)) {
    for (const item of (block[1] ?? '').matchAll(/<li>(.*?)<\/li>/g)) found.push(sentenceText(item[1] ?? ''));
  }
  for (const note of markdown.matchAll(/<p class="bf-note">(.*?)<\/p>/g)) found.push(sentenceText(note[1] ?? ''));
  for (const caption of markdown.matchAll(/<figcaption class="bf-flow-cap">(.*?)<\/figcaption>/g)) found.push(sentenceText(caption[1] ?? ''));
  for (const legend of markdown.matchAll(/<ul class="bf-legend">(.*?)<\/ul>/g)) {
    for (const row of (legend[1] ?? '').matchAll(/<li><span class="bf-mark[^"]*">[^<]*<\/span><span>(.*?)<\/span><\/li>/g)) {
      found.push(sentenceText(row[1] ?? ''));
    }
  }
  return found;
}

