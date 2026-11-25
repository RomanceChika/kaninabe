/**
 * screen_spec から他の仕様(ドメイン仕様・query_spec・他画面)を引くための純粋モジュール。
 *
 * S2〜S6 はいずれも「screen_spec に書かれた名前が何に接地するか」を問う。その引き当てを
 * 各検証器に散らさず、ここに 1 箇所だけ置く(lib/semantics/domain-index.ts と同じ役割)。
 *
 * **置き場は前段**: 画面の宣言(と query_spec の id の一覧)の型だけを読む純粋な照会で、`SUCCESS_SUFFIX` は
 * 画面の到達の判定(関係の層 `lib/relations/screen-reachability/`)も読む。以前は `lib/screen/lookup.ts` にいて、
 * ユースケースの到達の探索が画面のディレクトリを読む形だった(設計メモ framework-modules §13)。
 */

import type { QuerySpecModel } from '../query/types.js';
import type { ChromeSpec, ScreenSpec, ScreenSpecModel } from './types.js';

/** 遷移のきっかけが「操作の結果」であることを表す接尾辞。 */
export const SUCCESS_SUFFIX = '.success';

/** 画面 id → 画面。S2 / S3 / S5 が遷移先・行き先を引くのに使う。 */
export function indexScreens(model: ScreenSpecModel): ReadonlyMap<string, ScreenSpec> {
  return new Map(model.screens.map((screen) => [screen.id, screen]));
}

/** クローム id → クローム。 */
export function indexChromes(model: ScreenSpecModel): ReadonlyMap<string, ChromeSpec> {
  return new Map(model.chromes.map((chrome) => [chrome.id, chrome]));
}

/** query_spec の id 集合(S2 の reads 実在検査に使う)。 */
export function queryIds(queries: QuerySpecModel): ReadonlySet<string> {
  return new Set(queries.queries.map((query) => query.id));
}
