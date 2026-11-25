/**
 * 画面の生成物の**期待木**(`structure-expectations.ts`)に出る、置き場の表示名の文言。
 *
 * 期待木の 1 行は `event`(画面名)・`file`・`export` を持つ。画面名を持たない生成物(画面の部品が共有する
 * CSS・フォームの競合の表示の部品)は、`event` に**置き場の表示名**を入れる。画面名と衝突しない綴り(丸括弧で
 * 囲む)にしてあり、この語は生成物の文字列リテラルとして写るので、出力側の目(`generated-wording.ts`)が
 * 見る断片の全数(`message-fragments.ts` の `messageFragments`)にこの表の語が載る。
 * **値を何も import しない**(文言の層は葉)。
 */

/** 画面の生成物の期待木で、画面名を持たない生成物に付ける置き場の表示名。 */
export const STRUCTURE_WORDING = {
  /** 既定のスタイル 1 枚(画面の部品が共有する CSS)。 */
  default_style: (): string => '(既定のスタイル)',
  /** 競合の表示の部品 1 本(フォームの競合の解き方を出す部品)。 */
  form_conflict: (): string => '(競合の表示の部品)',
} as const;

/**
 * この表が持つ固定の日本語の断片の全数。上の表に語を足すときは、ここにも足す
 * (足さなければ出力側の目が赤になる)。
 *
 * @returns 断片の全数
 */
export function structureFragments(): readonly string[] {
  return [STRUCTURE_WORDING.default_style(), STRUCTURE_WORDING.form_conflict()];
}
