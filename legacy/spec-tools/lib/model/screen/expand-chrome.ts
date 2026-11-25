/**
 * 共有クロームの遷移を、継承する画面へ展開する純粋モジュール(ロード時のマクロ展開)。
 *
 * chrome に置いた部品(共通ヘッダのログアウトボタンなど)から出る遷移は、そのままでは
 * 「どの画面からどこへ行けるか」に現れない。かといって継承する画面すべてに同じ 2 行を
 * 書き写すのは、chrome を導入した動機(23 画面への書き写しを避ける)を裏切る。
 *
 * そこで**モデル構築の時点で展開**し、以降の検査(S2 / S3)と生成(遷移図)は
 * 展開後のモデルだけを見る。検査側に「chrome を継承しているかもしれない」という分岐が
 * 生えないので、遷移に関する規則は 1 つで済む。
 *
 * 展開された遷移は `viaChrome` を持ち、指摘のときに「直すのは chrome の側だ」と示せる。
 * ファイル I/O は行わない(呼ぶのは loader)。
 */

import type { ChromeSpec, ScreenSpec } from './types.js';

/**
 * chrome の navigations を、それを継承する画面の navigations の**後ろ**に足す。
 *
 * 後ろに足すのは、画面自身の宣言を先に読ませるためである(重複したときに
 * 「先行した宣言」として画面側が示され、上書きの向きが人間に分かりやすい)。
 * 重複そのものは足したうえで S2 / S7 相当の検査がエラーにする — ここでは黙って畳まない。
 *
 * @param screens 読み込んだ画面
 * @param chromes 読み込んだ共有クローム
 * @returns 遷移を展開した画面(chrome を継承しない画面はそのまま)
 */
export function expandChromeNavigations(
  screens: readonly ScreenSpec[],
  chromes: readonly ChromeSpec[],
): readonly ScreenSpec[] {
  const byId = new Map(chromes.map((chrome) => [chrome.id, chrome]));
  return screens.map((screen) => {
    const chrome = screen.chrome === undefined ? undefined : byId.get(screen.chrome.id);
    // 実在しない chrome は S2 が指摘する。ここでは展開せずに素通しする。
    if (chrome === undefined || chrome.navigations.length === 0) return screen;
    const inherited = chrome.navigations.map((navigation) => ({
      ...navigation,
      viaChrome: chrome.id,
    }));
    return { ...screen, navigations: [...screen.navigations, ...inherited] };
  });
}
