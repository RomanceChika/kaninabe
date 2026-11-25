/**
 * 画面カードの「状態ごとの見え方」— **状態別 SSR プレビュー**の組み立て(純粋関数)。
 *
 * [screen-previews.ts](./screen-previews.ts) がカード上段の「実物」(データがある既定の
 * 1 状態)を組み立てるのに対し、ここは `screen_spec` の `states.requires`(loading / empty /
 * error / not_found)の**宣言ごと**に小さな断片を並べる。母集合は生成物
 * (`screenRoutes[screen].requiredStates`)であり、宣言していない状態はここに出ない
 * (S0 が `states.requires` を値域として検査済み)。
 *
 * 断片は app 側(`cd app && npm run book:previews`)が
 * `docs/book/assets/previews/{画面名}.{状態}.html` に書き出したものを CLI が読んで渡す
 * (`BookInputs.statePreviews`)。宣言していても出せない組(`'use client'` 部品の内部状態・
 * `notFound()` の例外)は断片が無く、代わりに理由(`BookInputs.stateGaps`)を note として出す
 * — 空欄のまま見せると「足し忘れ」と区別が付かない。
 */

import type { RequiredState } from '../../../model/screen/types.js';

/** 状態名 → 章に出す日本語の意味(screen-spec-writing.md §states の語彙と揃える)。 */
export const STATE_MEANINGS: Readonly<Record<RequiredState, string>> = {
  loading: '読み込み中',
  empty: '空(0 件)',
  error: '入力エラー(invalid_input)',
  not_found: '見つからない',
};

