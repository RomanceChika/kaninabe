/**
 * 色の計算(WCAG の相対輝度とコントラスト比)。
 *
 * トークン化した色は機械が読める値になるので、「見た目の良し悪し」ではなく
 * 「読めるかどうか」だけは計算で決められる。G3 がこの関数を使う。
 *
 * 出典: WCAG 2.2 の relative luminance / contrast ratio の定義。
 */

/** `#rgb` / `#rrggbb` を受け付ける形。 */
const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * hex 文字列として妥当か。
 *
 * @param value 判定する文字列
 * @returns `#rgb` か `#rrggbb` なら true
 */
export function isHex(value: string): boolean {
  return HEX_PATTERN.test(value);
}

/**
 * hex を 0〜255 の RGB に分解する。
 *
 * @param hex `#rgb` または `#rrggbb`
 * @returns 各成分。妥当でない入力は null
 */
export function parseHex(hex: string): readonly [number, number, number] | null {
  if (!isHex(hex)) return null;
  const body = hex.slice(1);
  const full =
    body.length === 3
      ? body
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : body;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** sRGB の 1 成分(0〜255)を線形化する。 */
function linearize(channel: number): number {
  const ratio = channel / 255;
  return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
}

/**
 * 相対輝度(0 = 黒 / 1 = 白)。
 *
 * @param hex `#rgb` または `#rrggbb`
 * @returns 相対輝度。妥当でない入力は null
 */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (rgb === null) return null;
  const [r, g, b] = rgb;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * 2 色のコントラスト比(1〜21)。順序に依存しない。
 *
 * @param a 片方の色
 * @param b もう片方の色
 * @returns コントラスト比。どちらかが妥当でなければ null
 */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
