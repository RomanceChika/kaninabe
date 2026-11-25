

/** 章の題。 */
export const DESIGN_TITLE = 'デザイン';

/** ページの導入(定型)。 */
export const LEAD =
  '画面のスタイルはすべてデザイントークン(CSS custom property)経由で書かれ、実装に生値の hex / px は現れない。' +
  'この章はその宣言の写しである。色の行のスウォッチは生成 CSS(assets/tokens.css)の変数を' +
  'その場で塗ったもの。コントラスト表の「実比」は宣言済みの値からの機械計算(検査 G3 と同じ)。' +
  '**contrast にどの組を宣言するかは人間の判断**であり、トークンが部品として組み合わさった見た目は' +
  '下のパーツ見本と、画面の章のスクリーンショットで目視する。';

/** 節の見出しの語。 */
export const DESIGN_WORDS = {
  logo: 'ロゴ',
  path: 'パス: ',
  provisional: '仮のアイコン。',
  parts: 'デザインパーツ見本(実 CSS の写し)',
} as const;

/** テーマの節の見出し(Markdown ではテーマ名が等幅)。 */
export function themeHeading(theme: string): string {
  return `テーマ \`${theme}\` のトークン`;
}

/** ロゴを埋め込めないときの注(SVG 以外)。 */
export function logoUnembedded(icon: string): string {
  return `(${icon} — SVG 以外のため埋め込みは未対応)`;
}
