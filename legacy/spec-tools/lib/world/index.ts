/**
 * 世界の組み立て(一致の証明の場合の列挙・RLS の挙動テストの世界・ポリシーの計画)の**公開の入口**
 * (`lib/world/` の外から読んでよいのはここだけ)。
 *
 * `lib/world/` は、仕様から「起こりうる場合」と「世界(実行者と行)」を数え上げる意味の計算で、SQL の文字列を作らない
 * (`CLOSURE_BANS`)。結果表・ハンドブック・SQL の生成器・検査が読むが、中のファイルを個別には読まず、
 * **外から実際に使われている名前だけ**をここで再輸出する(使われていない名前は出さない。足りなければ、使う側が
 * 必要になった日にここへ 1 行足す)。層の中どうしは自由に読み合ってよい。外からの深い import は C28 が赤にする
 * (`lib/gates/lib-layers.ts` の `LAYER_ENTRANCES`)。
 */

export { MAX_COPY_DEPTH, copiedColumnsOf, copyDeclarationsOf } from './copied-columns.js';
export type { CopiedColumn, CopyDeclarations, UnresolvedCopy } from './copied-columns.js';
export type { EqAxisValue, EqFoldedGuard, EqOperationCases, EqPlacement } from './eq-cases.js';
export { eqCatalog, eqTestCaseIdOf } from './eq-catalog.js';
export type { EqCatalogEntry, EqCatalogInput } from './eq-catalog.js';
export type { EqSaveCaller, EqSaveCases } from './eq-save-cases.js';
export { eqSaveCatalog, eqSaveTestCaseIdOf } from './eq-save-catalog.js';
export type { EqSaveCatalogEntry } from './eq-save-catalog.js';
export type { EqSaveInput, EqSaveStep } from './eq-save-inputs.js';
export type { EqSaveActor, EqSaveWorld } from './eq-save-world.js';
export type { EqActor, EqWorld } from './eq-world-types.js';
export { frameworkFunctionDecls, frameworkTriggerDecls, frameworkTriggerSpecsOf } from './framework-triggers.js';
export type { FrameworkTriggerName, FrameworkTriggerSpec } from './framework-triggers.js';
export { boundaryHelperFields, boundaryHelperName, needsBoundaryHelper } from './rls-boundary.js';
export { deadConditions, helperName, helperRoles, needsHelper, policyPlans, readPlans, sessionPolicyName } from './rls-plan.js';
export type { PolicyGrantee, PolicyPlan } from './rls-plan.js';
export { rlsTestCaseIdOf, rlsWorldCatalog } from './rls-world-catalog.js';
export { SATISFIABLE_FORMALS, remedyOf } from './rls-world-derivable.js';
export { rlsWorldRoles } from './rls-world-roles.js';
export type { RlsWorldRow } from './rls-world-rows.js';
export type { RlsWorld, RlsWorldActor } from './rls-world.js';
