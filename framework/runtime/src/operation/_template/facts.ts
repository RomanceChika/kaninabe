/**
 * 判断材料（facts）の読み取り結果。4 形の定型が共通で使う型。
 *
 * `loadFacts` が答えるのは「**読めたか**」だけである。`null` ではなく判別型にしてあるのは、
 * 「読めなかった」以外の意味（＝可否の判断）をここに載せられないようにするためである。
 * 対象が無い場合と「自分のものではない」場合を返り値で区別しないのは仕様側の意思であり
 * （`access_spec` の `reads` が `own` である以上、存在の有無自体を漏らさない）、
 * その意思をこの 1 つの名前（`not_visible`）が表している。
 *
 * 定型は `not_visible` を一律に `forbidden` へ写す。各操作がその写像を選び直すことはできない。
 */

/** 判断材料を読んだ結果。読めたか、（実行者から見て）見えなかったか。 */
export type FactsLoaded<TFacts> =
  | { readonly kind: 'found'; readonly facts: TFacts }
  | { readonly kind: 'not_visible' };

/**
 * 実行者から見て対象が見えなかったことを表す値。
 *
 * 定型はこれを `forbidden` に写す。**「見えない」と「権限が無い」を区別しない**のは仕様の意思で
 * あって実装の手抜きではない（存在を漏らさないため）。
 */
export const NOT_VISIBLE: { readonly kind: 'not_visible' } = { kind: 'not_visible' };

/**
 * 読めた判断材料を包む。
 *
 * @param facts - 読み取った事実（この操作が判断とその後の書き込みに使うすべて）
 * @returns 読み取り成功を表す値
 */
export function found<TFacts>(facts: TFacts): FactsLoaded<TFacts> {
  return { kind: 'found', facts };
}
