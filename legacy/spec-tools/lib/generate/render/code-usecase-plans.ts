/**
 * usecase_spec の保存点 → **実行計画**(`app/src/domain/generated/usecase-plans.ts`)の生成器。
 *
 * 複合 RPC(`code-usecase-rpc.ts`)が「1 トランザクションでどう書くか」を出すのに対し、
 * ここは「**書く前の `permit`**に何が要るか」を出す —— 手順の種別・参照する規則表・予測状態・
 * ガード変数と文脈ロールの供給元・保存点の外から読む行・適用が要る不変条件である。
 * 解決は SQL 生成器と**同じ解決器**(`lib/usecase/plan-build.ts`)を通るので、両者が食い違わない。
 *
 * 値が満たす型は `@kaninabe/runtime/plan`(仕組み側の手書き。ADR-0013)にあり、**単発の操作の計画
 * (`operation-plans.ts`)と同じ型である** —— 1 操作は手順が 1 つの保存点にすぎない(束 ⑰ 設計 §0)。
 *
 * 決まらないものは**生成時エラー**(反例つき。同じ問いを検査 Y10 が先に立てている)。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { BuiltSave } from '../../usecase/plan-build.js';
import { buildSavePlans, stopOnBuildProblems } from '../../usecase/plan-build.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral, tsString } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import { planImports, renderStepLiteral } from './usecase-plan-types.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';

/** 出力先(1 ファイルに全保存点ぶん)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'usecase-plans.ts');

/**
 * 全 usecase_spec の保存点から実行計画を生成するジェネレーター。
 * 出力は `app/src/domain/generated/usecase-plans.ts`(ファイル全体)。
 */
export const usecasePlansGenerator: DocGenerator = {
  id: 'code-usecase-plans',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const built = buildSavePlans({
      domain: model,
      guards: ctx.guards,
      actions: ctx.actions ?? null,
      dataTables: ctx.dataTables,
      usecases: ctx.usecases,
    });
    if (built.problems.length > 0) stopOnBuildProblems(built.problems);
    if (built.saves.length === 0) return [];
    return [{ file: outputFile(ctx.roots), content: renderFile(built.saves, ctx.roots), wholeFile: true }];
  },
};

/** 保存点の鍵(`{ユースケース名}.{保存点 ID}`)。 */
function planKey(save: BuiltSave): string {
  return `${save.usecase.name}.${save.plan.save.id}`;
}

/** ファイル全体を組み立てる。 */
function renderFile(saves: readonly BuiltSave[], roots: ProductRoots): string {
  const specFiles = [...new Set(saves.map((save) => specPath(roots, `frontend/usecases/${save.usecase.relPath}`)))].sort(
    (a, b) => a.localeCompare(b),
  );
  const entries = saves.map((save) => `  ${tsString(planKey(save))}: ${renderPlan(save)},`);
  return [
    generatedHeader(specFiles),
    '',
    ...planImports(
      saves.flatMap((save) => save.plan.steps),
      ['RunPlan'],
    ),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      '保存点の実行計画(ADR-0011 §4)。「1 保存 = 1 トランザクション」を実行する前に、',
      '各手順の `permit`(canCreate / canFire)を仕様どおり順に立てるための材料である。',
      '',
      '**状態は仕様から予測する**(作成 = initial / 遷移 = 直前の to)。予測が実際と食い違えば、',
      '複合 RPC の中の `where state = expected` が 0 行を返して全体が戻る。',
      '',
      '形は単発の操作の計画(`operation-plans.ts`)と同じ `RunPlan` である —— 1 操作は手順が',
      '1 つの保存点にすぎず、実行器(`_template/run-plan.ts`)はどちらも同じ手順で実行する。',
    ]),
    `export const usecasePlans = ${frozen(`{\n${entries.join('\n')}\n} as const satisfies Readonly<Record<string, RunPlan>>`)};`,
    '',
    docComment(['保存点の鍵の値域。']),
    'export type UsecaseSaveKey = keyof typeof usecasePlans;',
    '',
  ].join('\n');
}

/** 保存点 1 つの計画(オブジェクトリテラル)。 */
function renderPlan(save: BuiltSave): string {
  const facts = save.facts;
  const steps = save.plan.steps.map((step, index) => renderStepLiteral(step, facts.steps[index]));
  return [
    '{',
    `    usecase: ${tsString(save.usecase.name)},`,
    `    save: ${tsString(save.plan.save.id)},`,
    `    rpc: ${tsString(save.plan.rpcName)},`,
    "    call: { kind: 'composite' },",
    `    reads: ${renderLiteral(facts.reads.map((read) => ({ ...read })), 2)},`,
    `    expectedKeys: ${renderLiteral([...facts.expectedKeys], 2)},`,
    `    invariantHooks: ${renderLiteral([...facts.invariantHooks], 2)},`,
    `    result: ${renderLiteral({ ...facts.result }, 2)},`,
    `    steps: [\n${steps.join('\n')}\n    ],`,
    '  }',
  ].join('\n');
}
