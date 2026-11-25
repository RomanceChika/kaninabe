/**
 * G1(実装の CSS に生値を書かない)が使う 3 つの値域。
 *
 * G1 は元は「知っている悪い形」を列挙する禁止リストだった(単位の正規表現・色名 24 語)。
 * 表に無い書き方(色名 `cyan`・システム色 `ButtonText`・新しい単位 `dvh` / `cqw`)は
 * 静かに素通りしていた(styling.md 旧「既知の穴」)。ここでは逆に「通ってよい形」を
 * 閉じた集合として持ち、そこに無いものはすべて落とす(許可リスト方式への反転)。
 *
 * 3 つの表:
 *   - 単位表(ALLOWED_UNITS)  … 生の長さ・時間の単位として通してよいもの
 *   - 色名表(CSS_NAMED_COLORS) … CSS の名前付き色(全 148 語)。1 語でも一致したら落とす
 *   - システム色(SYSTEM_COLORS) … CSS4 システム色キーワード(現行 + 非推奨)。同じく全部落とす
 *
 * 単位を持たない数値(無単位)は上の 3 表と性質が違うので、別に 2 つの値域を持つ:
 *   - TOKEN_GOVERNED_UNITLESS_PROPERTIES … トークン化されているので無単位のままでは
 *     書けないプロパティ(font-size に `0` を渡す「文字を消す」ハック等の踏み台を塞ぐ)
 *   - UNITLESS_OK_PROPERTIES … CSS の仕様上そもそも単位を持たず、対応するトークンも
 *     存在しないプロパティ(flex の比率・z-index の重なり順等)
 */

/** 生の長さ・時間として通してよい単位(値域)。これ以外の単位は px も dvh も一律で落ちる。 */
export const ALLOWED_UNITS: ReadonlySet<string> = new Set(['%', 'fr', 'vw', 'vh']);

/**
 * CSS Color Module Level 4 の名前付き色(全 148 語。`transparent` を除く)。
 *
 * 1 語でも一致すれば「色を直接書いている」として落とす。用途を問わない —— この語彙が
 * 他の意味で使われることは実質無く、色以外の目的で `tan` や `gray` を書く CSS は無い。
 */
export const CSS_NAMED_COLORS: ReadonlySet<string> = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'grey', 'green',
  'greenyellow', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
  'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
  'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple',
  'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell',
  'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen',
  'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat', 'white',
  'whitesmoke', 'yellow', 'yellowgreen',
]);

/**
 * CSS4 のシステム色キーワード(現行 + 非推奨。ブラウザ / OS のテーマ色を直接引く語)。
 *
 * `ButtonText` や `Canvas` はブラウザのテーマ(ダーク/ライト・OS の配色)に連動するため、
 * このリポジトリの「明るい地 1 組だけの単一テーマ」という前提(styling.md)と両立しない。
 * 旧 G1 はこの表を 1 語も持っていなかった。
 */
export const SYSTEM_COLORS: ReadonlySet<string> = new Set([
  'accentcolor', 'accentcolortext', 'activetext', 'buttonborder', 'buttonface', 'buttontext',
  'canvas', 'canvastext', 'field', 'fieldtext', 'graytext', 'highlight', 'highlighttext',
  'linktext', 'mark', 'marktext', 'selecteditem', 'selecteditemtext', 'visitedtext',
  // 非推奨だが仕様上は今も有効なキーワード。
  'activeborder', 'activecaption', 'appworkspace', 'background', 'buttonhighlight',
  'buttonshadow', 'captiontext', 'inactiveborder', 'inactivecaption', 'inactivecaptiontext',
  'infobackground', 'infotext', 'menu', 'menutext', 'scrollbar', 'threeddarkshadow',
  'threedface', 'threedhighlight', 'threedlightshadow', 'threedshadow', 'window',
  'windowframe', 'windowtext',
]);

/**
 * トークン化されているため、無単位のままでは書けないプロパティ。
 *
 * `font-size: 0`(文字を消す古いハック)のような「単位が無いから G1 の単位検査を素通りする
 * マジック値」を塞ぐ。ここに載る名前はすべて対応するトークングループ(text / leading /
 * tracking / weight / opacity)を持ち、`var(--…)` 以外の値を認める理由が無い。
 */
export const TOKEN_GOVERNED_UNITLESS_PROPERTIES: ReadonlySet<string> = new Set([
  'font-size',
  'line-height',
  'letter-spacing',
  'font-weight',
  'opacity',
]);

/**
 * 対応するトークングループが無く、CSS の仕様上そもそも無単位の数を渡すプロパティ。
 *
 * `flex: 1 1 auto` の比率や `z-index` の重なり順は「意匠」ではなく配置の算法であり、
 * 4px 刻みのようなデザイン上の値域を持たない。`0` はどのプロパティでも常に通す
 * (CSS の仕様上、長さのゼロは単位を要らないため。ここに載せる必要はない)。
 */
export const UNITLESS_OK_PROPERTIES: ReadonlySet<string> = new Set([
  'flex',
  'flex-grow',
  'flex-shrink',
  'order',
  'z-index',
  'aspect-ratio',
]);

/** トークン化されたプロパティごとの誘導文言(governed unitless の Finding.suggestion に使う)。 */
const GOVERNED_PROPERTY_HINTS: Readonly<Record<string, string>> = {
  'font-size': 'text-* のトークンを使う(例: var(--text-md))',
  'line-height': 'leading-* のトークンを使う(例: var(--leading-normal))',
  'letter-spacing': 'tracking-* のトークンを使う(例: var(--tracking-wide))',
  'font-weight': 'weight-* のトークンを使う(例: var(--weight-medium))',
  opacity: 'opacity-* のトークンを使う(無ければ tokens.md の opacity グループに足してから var(--opacity-…) を引く)',
};

/**
 * トークン化されたプロパティに無単位の値を書いたときの誘導文言を返す。
 *
 * @param property CSS プロパティ名(小文字)
 * @returns 対応するトークングループへの誘導文。表に無いプロパティは呼ばない前提
 */
export function governedPropertyHint(property: string): string {
  return GOVERNED_PROPERTY_HINTS[property] ?? 'このプロパティに対応するトークングループを使う';
}
