/**
 * テストケースの共通の語彙の**値の入口**(`lib/testcase/` の外から値を読むときはここだけ)。
 *
 * `lib/testcase/` は、仕様種のどれにも属さない葉(`test_cases` の形・`app/` の走査結果の型・意味クラスの値域・
 * 全仕様種を横断する台帳の構造・仕様の `test_cases` と `@tc` の突合)である。入口は **2 つ**: 値(関数・定数)はここ、
 * **型だけは型の入口 `types.ts`** を読む。型だけの import が値の入口を読むと、値の実装(台帳の組み立て・突合)まで
 * 実行時の依存の閉包と C24 の写し元の閉包に入り、テストケースの層のどこを触っても RPC のモデルの hash が動く
 * (前段 `lib/model/**` も型だけなので `types.ts` を読む)。
 *
 * 外から実際に使われている値だけを再輸出する(使われていない名前は出さない。足りなければ、使う側が必要になった日に
 * ここへ 1 行足す)。層の中どうしは自由に読み合ってよい。外からの深い import は C28 が赤にする
 * (`lib/gates/lib-layers.ts` の `LAYER_ENTRANCES`)。
 */

export { COVERAGE_CLASS_HINTS } from './coverage.js';
export { buildTcRegistry } from './registry.js';
export { COVERAGE_CLASSES, SPEC_KIND_LIST, isCoverageClass } from './types.js';
export { checkTestCaseTrace, groupByTcId } from './test-trace-match.js';
export { ownerOf } from './owner.js';
export type { LedgerOwner, OwnedTcRegistryEntry } from './owner.js';
export { notRequestedFrameworkScan } from './types-scan-framework.js';
export type { FrameworkScan, ScanScopeState, ScanWithFramework } from './types-scan-framework.js';
export { assertionFindings } from './assertion-match.js';
