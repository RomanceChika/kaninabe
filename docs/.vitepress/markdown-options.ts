/**
 * ハンドブックの Markdown の描画の設定(VitePress の `markdown` のうち、注入を防ぐ部分)。
 *
 * `attrs`: markdown-it-attrs の `{…}` の記法は、既定では任意の属性(`v-html` `onclick` `:title` `@click` `style` ほか)を要素に足せる。
 * 生成した章に仕様の文字列が入るので、**付けてよい属性を `id` だけ**にする(見出しのアンカー `{#anchor}` のため)。生成側の無害化
 * (`legacy/spec-tools/lib/generate/book-sanitize.ts`)と二重に守る。設定と描画のテストが同じ値を読む。
 */
export const BOOK_MARKDOWN_OPTIONS = {
  attrs: { allowedAttributes: ['id'] },
}
