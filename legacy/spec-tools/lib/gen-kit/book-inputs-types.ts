/**
 * ハンドブックが「実装の実物」を写すための入力の型(`GenerateContext.book` の型)。
 *
 * 型だけを置く —— 読むのは CLI の仕事(`lib/generate/book-inputs-loader.ts`)、文字列 → 形の変換は
 * 同じ道具箱の `book-inputs.ts`。`GenerateContext`(`generator.ts`)が持つ型を、ハンドブックの章や
 * 読み込みの口に置くと、生成器の共有文脈が上の層を読む逆向きになるので、道具箱に置く。
 */

/** ハンドブック生成器が使う実装由来の入力(すべて任意。無ければその部分は載らない)。 */
export interface BookInputs {
  /** 本の見た目の CSS(`FRAMEWORK_BOOK_FACE_DIR` の `.css` を名前の順に繋いだもの)。HTML の本が `assets/face.css` として読む。 */
  readonly faceCss?: string;
  /** `app/src/app/_styles/ui.module.css` の中身(パーツ見本・SSR プレビューの正)。 */
  readonly uiCss?: string;
  /** `app/src/app/globals.css` の中身(素の要素の既定。見本の土台)。 */
  readonly globalsCss?: string;
  /** `app/src/app/_components/state-badge.tsx` の中身(状態 → 意味色の対応の出典)。 */
  readonly stateBadgeSource?: string;
  /**
   * `brand.icon` の中身(SVG のときだけ)。
   *
   * ハンドブックの README・design 章に埋め込む実物のロゴ。**SVG(テキスト)のときだけ**読める
   * ―― この読み込み・書き込みのパイプラインは文字列前提(生成物は utf-8 のテキストとして
   * 書き込まれる)なので、PNG 等のバイナリはここでは埋め込まない(既知の穴。styling.md 相当の
   * 位置に書く)。undefined なら README・design 章はロゴを埋め込まず、パスだけを文字で示す。
   */
  readonly brandIconSvg?: string;
  /**
   * 画面名 → SSR プレビューの HTML 断片。
   *
   * 書き出すのは app 側(`cd app && npm run book:previews`)で、鮮度は同じ app の
   * ユニットテストが「いま描いた結果と一致するか」で見る。ここに届く時点で
   * 断片は実装の描画結果そのものである。
   */
  readonly previews?: ReadonlyMap<string, string>;
  /**
   * `{画面名}.{状態}` → 状態別 SSR プレビューの HTML 断片(`states.requires` の宣言ごと)。
   *
   * 出どころ・鮮度の担保は `previews` と同じ(`app/src/app/__screens__/previews-states.tsx` /
   * `app/scripts/book-previews.mts`)。キーは [stateKeyOf](#statekeyof) で組み立てる。
   */
  readonly statePreviews?: ReadonlyMap<string, string>;
  /**
   * 宣言していても状態別プレビューを出せない(画面, 状態)の組(理由つき)。
   *
   * `_state-gaps.json`(app 側が書く)の写しで、章はここに載っている組を
   * 「まだ出せない」の note として表示する(空白のまま見せない)。
   */
  readonly stateGaps?: readonly StateGap[];
}

/** `stateGaps` の 1 行。 */
export interface StateGap {
  readonly screen: string;
  readonly state: string;
  readonly reason: string;
}
