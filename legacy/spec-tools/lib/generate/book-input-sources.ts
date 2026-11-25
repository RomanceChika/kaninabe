/**
 * ハンドブックが写す資材の、置き場の配置の役割 `app-resource` の下の相対パス(製品固有の末尾)。
 *
 * 製品の抜粋元の宣言であって、置き場の役割ではない(置き場の根は配置が決め、末尾だけがここにある)。読み込み(`book-inputs-loader.ts`)と、
 * 写し元の位置を示す生成器(`render/book/book-assets.ts`)が同じ定数を使う —— 読む位置と示す位置が別々の綴りにならない。
 */

/** パーツ見本・SSR プレビューの正にあたる、実装のスタイル。 */
export const UI_CSS_SOURCE = '_styles/ui.module.css';

/** 実装の全体のスタイル。 */
export const GLOBALS_CSS_SOURCE = 'globals.css';

/** 状態 → 意味色の対応の出典にあたる、状態バッジの部品。 */
export const STATE_BADGE_SOURCE = '_components/state-badge.tsx';
