/**
 * 入力の読めた分を取り出す(`CatalogInput` の部分のモデルの読み方)。
 *
 * 読込済みならその値・**仕様を落とした阻害**(`partial` つき)なら読めた分・それ以外(未選択・読めない阻害)は undefined。
 * `inputValue`(読込済みだけ)と違い、阻害のとき読めた分が残るので、検査はこれを**全体か部分か**を `input.state === 'loaded'` で見分けて使う。
 *
 * 部分のモデルが言えるのは「読めた分についての**真の検出**」だけである(読めた画面が掛かる関門の宣言漏れ・読めた走査の `emits` が未宣言の通知を指す、など)。
 * 「無いこと」(その画面が無い・その走査が無い・誰も使っていない)は欠けた分があれば偽になるので、部分のモデルから言わない。
 *
 * `input-state.ts` に足さず別のファイルにした理由: `input-state.ts` は約束事のモデル検査 C24(IdempotentCreate)の閉包に入っており、足すと C24 の hash が動く。
 * 閉包の外の葉に置けば、約束事を触らずに済む。
 */

import type { CatalogInput } from './input-state.js';

/**
 * 入力の読めた分: 読込済みなら全体・仕様を落とした阻害なら部分・それ以外は undefined。
 *
 * @param input 入力の状態
 */
export function readableValue<T>(input: CatalogInput<T>): T | undefined {
  if (input.state === 'loaded') return input.value;
  return input.state === 'blocked' ? input.partial : undefined;
}
