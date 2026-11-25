/**
 * 生成テスト(と、生成テストが引く住所に置く配線)の置き場を、置き場の配置から引く口(生成テストを書く生成器・`test_cases` の生成ブロックを書く生成器が共有する)。
 *
 * 置き場は文脈の配置(アプリの枠の後段が与える `ProductLayout`)の役割が決める。**実装の木を持たない製品は置き場が無いことが事実**なので何も出さない(null)。
 * 実装の木があるのに配置が決められなければ、黙って 0 本にせず前提の失敗で止める(`layout-placement.ts`。名指す先は配置の定義の検査 `LAYOUT_DEFINITION_CHECK`)。
 * `test_cases` の生成ブロックが指す `implementation` のパスも**同じ口**から引く(テストを書く側と指す側で綴りの正が 2 つにならない)。
 * 文脈つきの口(`operationTestPlacerOf` ほか 5 つ)は、生成器 5 本と `test_cases` の生成ブロックの生成器 5 本が共有する(置き場を決められないときに指す仕様の木も、ここが持つ)。
 */

import type { SourceLocation } from '../../kernel/source-location.js';
import { specPath } from '../../model/product/paths.js';
import type { GenerateContext } from '../../gen-kit/generator.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import { LAYOUT_DEFINITION_CHECK, placedPath } from '../layout-placement.js';

/** 生成テストの置き場の役割(`layout.ts` の語彙のうち、生成器が書くテストと配線の分)。 */
export type GeneratedTestRole =
  | 'operation-test'
  | 'compute-example-test'
  | 'eq-test'
  | 'eq-save-test'
  | 'rls-test'
  | 'harness-adapter'
  | 'save-harness-adapter'
  | 'cron-route-test'
  | 'browser-defense-test'
  | 'paid-entry-test';

/** 置き場を決められないときの説明(違反に出る)。 */
export interface TestPlacementOrigin {
  /** 人が読む出どころ(例: `操作の生成ユニットテスト`)。 */
  readonly what: string;
  /** 出どころの仕様の位置(置き場そのものは仕様に書かれないので、そのテストの元の仕様の木・宣言の位置)。 */
  readonly location: SourceLocation;
}

/**
 * 前提の失敗が名指す先。生成テストの置き場を配置から読む検査の群は無く(A6 は仕様が指すテストと実在するテストの注釈の突合で、配置の欠落を読まない)、
 * 配置に無い役割・基準が辿れない配置を止めるのは選ぶ根の 1 回の配置の定義の検査である。
 */
const TEST_TRACE_VERIFIER = LAYOUT_DEFINITION_CHECK;

/**
 * 役割 1 つの置き場を引く関数を返す(キー → リポジトリルート相対のパス)。
 *
 * @param layout 生成の文脈の配置
 * @param roots 製品の根(`app` だけ見る)
 * @param role 生成テストの置き場の役割
 * @param origin 置き場を決められないときの説明
 * @returns キー → パス。実装の木を持たない製品は null(呼び手が先に何も出さずに返す)
 */
export function testPlacerOf(
  layout: ProductLayout,
  roots: Pick<ProductRoots, 'app'>,
  role: GeneratedTestRole,
  origin: TestPlacementOrigin,
): ((key: string) => string) | null {
  if (roots.app === null) return null;
  return (key) =>
    placedPath(layout, roots, {
      role,
      ...keyOf(role, key),
      what: origin.what,
      location: origin.location,
      verifier: TEST_TRACE_VERIFIER,
    });
}

/** キーを持たない役割(`cron-route-test` / `browser-defense-test` / `paid-entry-test`)は、置き場の解決にキーを渡さない(キーの形が `none`)。 */
function keyOf(role: GeneratedTestRole, key: string): { readonly key?: string } {
  return role === 'cron-route-test' || role === 'browser-defense-test' || role === 'paid-entry-test' ? {} : { key };
}

/**
 * 生成ユニットテスト(`operation-test`)の置き場を引く関数(キーは操作 ID)。`test_cases` の生成ブロック(`action-test-cases.ts`)も同じ口を通る。
 *
 * @param ctx 生成の文脈(`roots` と `layout` を読む)
 * @returns 操作 ID → リポジトリルート相対のパス。実装の木を持たない製品は null
 */
export function operationTestPlacerOf(ctx: GenerateContext): ((op: string) => string) | null {
  return testPlacerOf(ctx.layout, ctx.roots, 'operation-test', {
    what: '操作の生成ユニットテスト',
    location: { file: specPath(ctx.roots, 'backend/actions') },
  });
}

/**
 * 例の表のテスト(`compute-example-test`)の置き場を引く関数(キーは純関数の参照)。`test_cases` の生成ブロック(`action-compute-example-cases.ts`)も同じ口を通る。
 *
 * @param ctx 生成の文脈(`roots` と `layout` を読む)
 * @returns 純関数の参照 → リポジトリルート相対のパス。実装の木を持たない製品は null
 */
export function computeExampleTestPlacerOf(ctx: GenerateContext): ((ref: string) => string) | null {
  return testPlacerOf(ctx.layout, ctx.roots, 'compute-example-test', {
    what: '計算値の例の表の生成テスト',
    location: { file: specPath(ctx.roots, 'backend/actions') },
  });
}

/**
 * 一致の証明(`eq-test`)の置き場を引く関数(キーは集約名)。data_table の `test_cases` の生成ブロック(`data-table-eq-tests.ts`)も同じ口を通る。
 *
 * @param ctx 生成の文脈(`roots` と `layout` を読む)
 * @returns 集約名 → リポジトリルート相対のパス。実装の木を持たない製品は null
 */
export function eqTestPlacerOf(ctx: GenerateContext): ((aggregate: string) => string) | null {
  return testPlacerOf(ctx.layout, ctx.roots, 'eq-test', {
    what: '集約の一致の証明の生成テスト',
    location: { file: specPath(ctx.roots, 'domain') },
  });
}

/**
 * 保存点の一致の証明(`eq-save-test`)の置き場を引く関数(キーはユースケース名)。usecase_spec の `test_cases` の生成ブロック(`usecase-eq-tests.ts`)も同じ口を通る。
 *
 * @param ctx 生成の文脈(`roots` と `layout` を読む)
 * @returns ユースケース名 → リポジトリルート相対のパス。実装の木を持たない製品は null
 */
export function eqSaveTestPlacerOf(ctx: GenerateContext): ((usecase: string) => string) | null {
  return testPlacerOf(ctx.layout, ctx.roots, 'eq-save-test', {
    what: 'ユースケースの保存点の一致の証明の生成テスト',
    location: { file: specPath(ctx.roots, 'frontend/usecases') },
  });
}

/**
 * RLS の挙動テスト(`rls-test`)の置き場を引く関数(キーは表名)。data_table の `test_cases` の生成ブロック(`data-table-rls-tests.ts`)も同じ口を通る。
 *
 * @param ctx 生成の文脈(`roots` と `layout` を読む)
 * @returns 表名 → リポジトリルート相対のパス。実装の木を持たない製品は null
 */
export function rlsTestPlacerOf(ctx: GenerateContext): ((table: string) => string) | null {
  return testPlacerOf(ctx.layout, ctx.roots, 'rls-test', {
    what: '表の RLS の挙動の生成テスト',
    location: { file: specPath(ctx.roots, 'backend/data/tables') },
  });
}
