/**
 * ジェネレーターレジストリ。
 * 新しいジェネレーターの追加は「DocGenerator 実装モジュールを作り、ここに 1 行足す」だけ
 * (検証器の ALL_VERIFIERS と同じ規約)。
 *
 * **コアの生成器(`CORE_GENERATORS`)は後段の名前を知らない。** 具体のスタックに属する生成器(例: ホストの Cron の契約に属する
 * 見張りテスト)は後段が登録し(`lib/target-api/contract.ts` の `Target.generators`)、全部入りの一覧は組み立ての根が選んだ後段の
 * 登録をコアの一覧のあとに足して作る(`allGenerators`。後段の型は読まない = 生成器の層と後段の登録の契約が互いを読まない)。
 */

import type { DocGenerator } from '../gen-kit/generator.js';
import { BOOK_GENERATORS } from './book-generators.js';
import { stateMachineGenerator } from '../generate/render/state-machine.js';
import { roleTableGenerator } from '../generate/render/role-table.js';
import { globalRolesGenerator } from '../generate/render/code-roles.js';
import { fieldTableGenerator } from '../generate/render/field-table.js';
import { accessMatrixGenerator } from '../generate/render/access-matrix.js';
import { invariantTableGenerator } from '../generate/render/invariant-table.js';
import { actionsIndexGenerator } from '../generate/render/actions-index.js';
import { actionInputsGenerator } from '../generate/render/code-action-inputs.js';
import { queryListGenerator } from '../generate/render/query-list.js';
import { queryWindowsGenerator } from '../generate/render/code-query-windows.js';
import { queryFragmentsGenerator } from '../generate/render/code-query-fragments.js';
import { screenListGenerator } from '../generate/render/screen-list.js';
import { screenNavGraphGenerator } from '../generate/render/screen-nav-graph.js';
import { screenWireframeGenerator } from '../generate/render/screen-wireframe.js';
import { zodSchemaGenerator } from '../generate/render/code-zod.js';
import { transitionTableGenerator } from '../generate/render/code-transitions.js';
import { stateMachinesIndexGenerator } from '../generate/render/code-state-machines-index.js';
import { vocabularyIdsGenerator } from '../generate/render/code-vocabulary-ids.js';
import { snapshotMapGenerator } from '../generate/render/code-snapshots.js';
import { stateLabelGenerator } from '../generate/render/code-labels.js';
import { createRulesGenerator } from '../generate/render/code-creates.js';
import { deleteRulesGenerator } from '../generate/render/code-deletes.js';
import { writeRulesGenerator } from '../generate/render/code-writes.js';
import { rlsExpectationsGenerator } from '../generate/render/code-rls-expectations.js';
import { rlsPoliciesGenerator } from '../generate/render/code-rls-policies.js';
import { ddlGenerator } from '../generate/render/code-ddl.js';
import { apiBaseGenerator } from '../generate/render/code-api-base.js';
import { grantsGenerator } from '../generate/render/code-grants.js';
import { apiViewsGenerator } from '../generate/render/code-api-views.js';
import { rlsWorldsGenerator } from '../generate/render/code-rls-worlds.js';
import { rlsBehaviourTestsGenerator } from '../generate/render/code-rls-behaviour-tests.js';
import { harnessAdaptersGenerator } from '../generate/render/code-harness-adapters.js';
import { dataTableRlsTestsGenerator } from '../generate/render/data-table-rls-tests.js';
import { eqWorldsGenerator } from '../generate/render/code-eq-worlds.js';
import { equivalenceTestsGenerator } from '../generate/render/code-equivalence-tests.js';
import { dataTableEqTestsGenerator } from '../generate/render/data-table-eq-tests.js';
import { eqSaveTestsGenerator } from '../generate/render/code-eq-save-tests.js';
import { usecaseEqTestsGenerator } from '../generate/render/usecase-eq-tests.js';
import { testIdsGenerator } from '../generate/render/code-testids.js';
import { screenRoutesGenerator } from '../generate/render/code-screens.js';
import { navigationVisibilityGenerator } from '../generate/render/code-navigation-visibility.js';
import { designTokensGenerator } from '../generate/render/code-design-tokens.js';
import { actionBodyGenerator } from '../generate/render/action-body.js';
import { queryBodyGenerator } from '../generate/render/query-body.js';
import { screenBodyGenerator } from '../generate/render/screen-body.js';
import { tokenTablesGenerator } from '../generate/render/token-tables.js';
import { dataTableBodyGenerator } from '../generate/render/data-table-body.js';
import { dataTableListGenerator } from '../generate/render/data-table-list.js';
import { dataTableExpectationsGenerator } from '../generate/render/code-data-table-expectations.js';
import { sendLimitsGenerator } from '../generate/render/code-send-limits.js';
import { lockExpectationsGenerator } from '../generate/render/code-lock-expectations.js';
import { indexExpectationsGenerator } from '../generate/render/code-index-expectations.js';
import { rpcBodiesGenerator } from '../generate/render/code-rpc-bodies.js';
import { rpcExpectationsGenerator } from '../generate/render/code-rpc-expectations.js';
import { apiExpectationsGenerator } from '../generate/render/code-api-expectations.js';
import { personalExpectationsGenerator } from '../generate/render/code-personal-expectations.js';
import { sessionProfileGenerator } from '../generate/render/code-session-profile.js';
import { transitionWritesGenerator } from '../generate/render/code-transition-writes.js';
import { notificationBodyGenerator } from '../generate/render/notification-body.js';
import { notificationExpectationsGenerator } from '../generate/render/code-notifications.js';
import { jobBodyGenerator } from '../generate/render/job-body.js';
import { jobExpectationsGenerator } from '../generate/render/code-jobs.js';
import { configBodyGenerator } from '../generate/render/config-body.js';
import { configExpectationsGenerator } from '../generate/render/code-config.js';
import { externalExpectationsGenerator } from '../generate/render/code-external-expectations.js';
import { paidEntriesGenerator } from '../generate/render/code-paid-entries.js';
import { authBodyGenerator } from '../generate/render/auth-body.js';
import { authExpectationsGenerator } from '../generate/render/code-auth.js';
import { invariantStatementsGenerator } from '../generate/render/code-invariants.js';
import { frameworkGuaranteeBodyGenerator, guaranteeBodyGenerator } from '../generate/render/guarantee-body.js';
import { externalBodyGenerator } from '../generate/render/external-body.js';
import { actionAttributesGenerator } from '../generate/render/code-action-attributes.js';
import { lintExceptionsGenerator } from '../generate/render/code-lint-exceptions.js';
import { sdkHomesGenerator } from '../generate/render/code-sdk-homes.js';
import { structureExpectationsGenerator } from '../generate/render/code-structure-expectations.js';
import { usecasesGenerator } from '../generate/render/code-usecases.js';
import { usecaseRpcGenerator } from '../generate/render/code-usecase-rpc.js';
import { usecasePlansGenerator } from '../generate/render/code-usecase-plans.js';
import { operationPlansGenerator } from '../generate/render/code-operation-plans.js';
import { runtimeBindingsGenerator } from '../generate/render/code-runtime-bindings.js';
import { operationInputsGenerator } from '../generate/render/code-operation-inputs.js';
import { usecaseInputsGenerator } from '../generate/render/code-usecase-inputs.js';
import { constraintInvariantsGenerator } from '../generate/render/code-constraint-invariants.js';
import { usecaseAppGenerator } from '../generate/render/code-usecase-app.js';
import { platformOpsAppGenerator } from '../generate/render/code-platform-ops-app.js';
import { platformOpsTestsGenerator } from '../generate/render/code-platform-ops-tests.js';
import { platformPartsGenerator } from '../generate/render/code-platform-parts.js';
import { operationAppGenerator } from '../generate/render/code-operation-app.js';
import { operationTestsGenerator } from '../generate/render/code-operation-tests.js';
import { actionTestCasesGenerator } from '../generate/render/action-test-cases.js';
import { computeExamplesGenerator } from '../generate/render/code-compute-examples.js';
import { actionComputeExampleCasesGenerator } from '../generate/render/action-compute-example-cases.js';
import { usecaseFormGenerator } from '../generate/render/code-usecase-form.js';
import { screenDetailsGenerator } from '../generate/render/code-screen-details.js';
import { screenFormsGenerator } from '../generate/render/code-screen-forms.js';
import { screenTablesGenerator } from '../generate/render/code-screen-tables.js';
import { rpcSignaturesGenerator } from '../generate/render/code-rpc-signatures.js';
import { inboundRouteGenerator } from '../generate/render/code-inbound-route.js';
import { inboundRpcGenerator } from '../generate/render/code-inbound-rpc.js';

/** コアの生成器(後段が登録する生成器を含まない)。 */
export const CORE_GENERATORS: readonly DocGenerator[] = [
  roleTableGenerator,
  globalRolesGenerator,
  fieldTableGenerator,
  stateMachineGenerator,
  accessMatrixGenerator,
  invariantTableGenerator,
  // book 系は人間の唯一の入口 docs/book/(ハンドブック)の各ページを丸ごと(wholeFile)出す。
  // 一覧の正は book-generators.ts(ハンドブックだけを出す入口と共有する)
  ...BOOK_GENERATORS,
  queryListGenerator,
  queryBodyGenerator,
  actionsIndexGenerator,
  actionInputsGenerator,
  actionBodyGenerator,
  screenBodyGenerator,
  tokenTablesGenerator,
  dataTableBodyGenerator,
  dataTableListGenerator,
  notificationBodyGenerator,
  jobBodyGenerator,
  configBodyGenerator,
  authBodyGenerator,
  guaranteeBodyGenerator,
  frameworkGuaranteeBodyGenerator,
  externalBodyGenerator,
  screenListGenerator,
  screenNavGraphGenerator,
  screenWireframeGenerator,
  zodSchemaGenerator,
  transitionTableGenerator,
  stateMachinesIndexGenerator,
  vocabularyIdsGenerator,
  snapshotMapGenerator,
  stateLabelGenerator,
  invariantStatementsGenerator,
  createRulesGenerator,
  writeRulesGenerator,
  deleteRulesGenerator,
  rlsExpectationsGenerator,
  rlsPoliciesGenerator,
  ddlGenerator,
  apiBaseGenerator,
  grantsGenerator,
  apiViewsGenerator,
  rlsWorldsGenerator,
  rlsBehaviourTestsGenerator,
  dataTableRlsTestsGenerator,
  eqWorldsGenerator,
  equivalenceTestsGenerator,
  dataTableEqTestsGenerator,
  eqSaveTestsGenerator,
  usecaseEqTestsGenerator,
  // ハーネスのアダプタ 6 本(生成テストが呼ぶ住所。束 ①-d 手 2)。
  harnessAdaptersGenerator,
  queryWindowsGenerator,
  queryFragmentsGenerator,
  dataTableExpectationsGenerator,
  sendLimitsGenerator,
  lockExpectationsGenerator,
  indexExpectationsGenerator,
  rpcBodiesGenerator,
  rpcExpectationsGenerator,
  apiExpectationsGenerator,
  personalExpectationsGenerator,
  sessionProfileGenerator,
  transitionWritesGenerator,
  notificationExpectationsGenerator,
  jobExpectationsGenerator,
  configExpectationsGenerator,
  externalExpectationsGenerator,
  paidEntriesGenerator,
  authExpectationsGenerator,
  testIdsGenerator,
  screenRoutesGenerator,
  navigationVisibilityGenerator,
  designTokensGenerator,
  actionAttributesGenerator,
  lintExceptionsGenerator,
  sdkHomesGenerator,
  structureExpectationsGenerator,
  usecasesGenerator,
  usecaseRpcGenerator,
  usecasePlansGenerator,
  operationPlansGenerator,
  operationInputsGenerator,
  runtimeBindingsGenerator,
  usecaseInputsGenerator,
  constraintInvariantsGenerator,
  usecaseAppGenerator,
  platformOpsAppGenerator,
  platformOpsTestsGenerator,
  operationAppGenerator,
  operationTestsGenerator,
  actionTestCasesGenerator,
  computeExamplesGenerator,
  actionComputeExampleCasesGenerator,
  usecaseFormGenerator,
  screenFormsGenerator,
  screenTablesGenerator,
  screenDetailsGenerator,
  platformPartsGenerator,
  rpcSignaturesGenerator,
  inboundRouteGenerator,
  inboundRpcGenerator,
];

/**
 * 全部入りの生成器の一覧: コアの生成器のあとに、選んだ後段が登録した生成器を足す。
 * 後段を選ばない構成では(空を渡す)、後段が登録する生成器の出力(例: Cron 起動口の見張りテスト)は出ない。
 *
 * @param fromTargets 選んだ後段が登録した生成器(組み立ての根が `targetGenerators(選んだ後段)` で集めて渡す)
 */
export function allGenerators(fromTargets: readonly DocGenerator[]): readonly DocGenerator[] {
  return [...CORE_GENERATORS, ...fromTargets];
}
