/**
 * action_spec 1 本 → **単発の操作の実行計画**(`app/src/domain/generated/operation-plans.ts`)。
 *
 * 「1 操作 = 手順が 1 つの保存点」(束 ⑰ 設計 §0)。導出器は保存点とまったく同じものを使い
 * (`lib/usecase/operation-plan.ts` が薄く包む)、値が満たす型も同じ `RunPlan` である。
 *
 * ## 導出できない操作をこの束ではエラーにしない
 *
 * 規約に乗らない引数を持つ RPC を呼ぶ操作(一括の並べ替え・写しの作成・個人情報の消去など)は
 * 計画が組み立てられない。それらは `runner: manual`(理由つき)を宣言して手書きのまま残す形に
 * するが、**宣言はまだ 1 本も無い**(束 ⑰-2 で入れる)。宣言が無いうちに生成時エラーにすると
 * 並走できないので、この束では**載せられたものだけを載せる**。`runner` の宣言が済んだら
 * A15 を error に格上げし、ここも「計画が無く `runner` も無い操作があればエラー」にする。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { BuiltOperation } from '../../usecase/operation-plan.js';
import { buildOperationPlans } from '../../usecase/operation-plan.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral, tsString } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import { planImports, renderStepLiteral } from './usecase-plan-types.js';
import { renderNamedParams } from './operation-plan-params.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';

/** 出力先(1 ファイルに全操作ぶん)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'operation-plans.ts');

/**
 * 全 action_spec から単発の操作の実行計画を生成するジェネレーター。
 * 出力は `app/src/domain/generated/operation-plans.ts`(ファイル全体)。
 */
export const operationPlansGenerator: DocGenerator = {
  id: 'code-operation-plans',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const built = buildOperationPlans({
      domain: model,
      guards: ctx.guards,
      actions: ctx.actions,
      dataTables: ctx.dataTables,
      jobs: ctx.jobs,
    });
    if (built.operations.length === 0) return [];
    return [{ file: outputFile(ctx.roots), content: renderFile(built.operations, ctx.roots), wholeFile: true }];
  },
};

/** ファイル全体を組み立てる。 */
function renderFile(operations: readonly BuiltOperation[], roots: ProductRoots): string {
  const specFiles = [...new Set(operations.map((op) => specPath(roots, `backend/actions/${op.plan.usecase.relPath}`)))].sort(
    (a, b) => a.localeCompare(b),
  );
  const entries = operations.map((operation) => `  ${tsString(operation.op)}: ${renderPlan(operation)},`);
  return [
    generatedHeader(specFiles),
    '',
    ...planImports(
      operations.flatMap((operation) => operation.plan.steps),
      ['RunPlan'],
    ),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      '単発の操作の実行計画(操作 ID → 計画)。',
      '',
      '**保存点の計画(`usecase-plans.ts`)と同じ形である** —— 1 操作は手順が 1 つの保存点に',
      'すぎない。違うのは 2 点だけで、どちらも計画が運ぶ:',
      '',
      '  - 状態を**予測しない**(先行手順が無いので、読んだ値が実際の状態そのもの)',
      '  - 呼ぶのは複合 RPC ではなく定型 RPC(`call.kind: named`。引数は署名どおりの名前付き)',
      '',
      '**ここに無い操作は計画が導出できなかったものである**(規約に乗らない引数を持つ RPC を',
      '呼ぶ操作など)。一覧と理由は `npm run verify` の A15 が出す。',
    ]),
    `export const operationPlans = ${frozen(`{\n${entries.join('\n')}\n} as const satisfies Readonly<Record<string, RunPlan>>`)};`,
    '',
    docComment(['計画が導出できた操作 ID の値域。']),
    'export type OperationPlanKey = keyof typeof operationPlans;',
    '',
  ].join('\n');
}

/** 操作 1 つの計画(オブジェクトリテラル)。 */
function renderPlan(operation: BuiltOperation): string {
  const facts = operation.facts;
  const steps = operation.plan.steps.map((step, index) => renderStepLiteral(step, facts.steps[index]));
  return [
    '{',
    `    usecase: ${tsString(operation.plan.usecase.name)},`,
    `    save: ${tsString(operation.plan.save.id)},`,
    `    rpc: ${tsString(operation.plan.rpcName)},`,
    `    call: ${renderNamedParams(operation)},`,
    `    reads: ${renderLiteral(facts.reads.map((read) => ({ ...read })), 2)},`,
    `    expectedKeys: ${renderLiteral([...facts.expectedKeys], 2)},`,
    `    invariantHooks: ${renderLiteral([...facts.invariantHooks], 2)},`,
    `    result: ${renderLiteral({ ...facts.result }, 2)},`,
    `    steps: [\n${steps.join('\n')}\n    ],`,
    '  }',
  ].join('\n');
}
