/**
 * ジェネレーターテスト用の GenerateContext。
 *
 * 生成器は「モデルを読んで文字列を作る」だけなのでガードサービスを差し替える必要が無く、
 * 検証器テストのスタブと違い実物(createGuardServices)をそのまま使う。
 */

import type { GenerateContext } from '../../lib/gen-kit/generator.js';
import type { QuerySpec } from '../../lib/model/query/types.js';
import { createGuardServices } from '../../lib/guard/services.js';
import { loadedGates } from '../../lib/relations/screen-reachability/index.js';
import { TEST_LAYOUT, TEST_PLATFORM } from './platform.js';
import { TEST_ROOTS } from './product-roots.js';

/** 関門を持たない(読込済みの空の)関門の入力の状態。`GenerateContext.gates` は必須で、関門に依らないテストはこれを渡す。 */
export const NO_GATES = loadedGates([]);

/** 全ジェネレーターテストで共有してよい(状態を持たない)。 */
export const GEN_CTX: GenerateContext = { guards: createGuardServices(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES };

/**
 * query_spec を読み込み済みの GenerateContext を作る。
 *
 * 読み取り経路を参照する生成器(可視性の要約の依存 query 列・クエリ一覧)のテスト用。
 *
 * @param queries 読み込み済みとして渡す query_spec
 * @returns 生成器に渡す文脈
 */
export function genContextWithQueries(queries: readonly QuerySpec[]): GenerateContext {
  return { ...GEN_CTX, queries: { available: true, queries } };
}
