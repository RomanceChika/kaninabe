/**
 * 実行計画を **DB なしで評価する純関数の公開の入口**(`@kaninabe/runtime/template/evaluate`)。
 *
 * 仕様: docs/rules/decisions/common/ADR-0013-framework-runtime-package.md(公開する入口は名指し)
 *       docs/design/runtime-package.md §9-14(入口の実測)
 *
 * 実行器(`./run-plan.ts`)は 1 つの関数で、読む → 判断する → 引数を組む → RPC を呼び出す、を
 * 実行する。**判断と引数の組み立てだけは DB も `server-only` も要らない純関数**で、実行器の外から
 * 引く利用者が 3 つある。
 *
 *   - 仕様側(ハンドブックの結果表)— 4 題材の仕様に対して**同じ判断**を引く(第 2 の判定器を置かない)
 *   - 一致の証明のハーネス(`@kaninabe/runtime/testing/save/oracle`)— 仕様から導いた期待の側で同じ判断を引く
 *   - 実行器自身のユニットテスト — 引数の組み立てと配線漏れの拒否を単体で実行する
 *
 * 3 者とも引きたいのは**内部のファイル(`run-plan-decide-core` / `-facts` / `-args`)の名前ではなく
 * この判断そのもの**である。だから入口はこのファイル 1 つにし、内部ファイルの改名・統合が
 * 利用側の変更にならないようにする。**ここに足すときは `exports-manifest.json` の差分として
 * レビューに出る**(入口を増やす = 公開の面を増やす)。
 *
 * 実行する側(`runPlanOperation`)は `@kaninabe/runtime/template` にある。ここは**再輸出だけ**で、
 * 実装を持たない。
 */

export type { DecideContext, PlanStepOutcome, RawStepDecision } from './run-plan-decide-core';
export { decidePlanWith, decideStepWith, envOf, planActorRolesWith } from './run-plan-decide-core';
export type { PlanInputMap, Resolution } from './run-plan-facts';
export { factValue } from './run-plan-facts';
export { namedArgs } from './run-plan-args';
