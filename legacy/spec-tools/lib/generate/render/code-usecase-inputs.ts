/**
 * usecase_spec の保存点 → **保存点の入力スキーマ**(`app/src/domain/generated/usecase-inputs.ts`)。
 *
 * 保存点は複数の操作を 1 度に受け取るので、入力は `{手順の操作 ID}: {その手順の入力}` の
 * オブジェクトになる(複合 RPC の `p_input` と同じ形)。`repeat: true` の手順は配列である。
 *
 * **制約は 1 つも再宣言しない。** 各手順の欄は生成済みの `{entity}InputSchema` から `.pick` で
 * 借りるだけであり、entity_spec が正であることは変わらない(PRIN-0001 / PRIN-0007)。
 * 実行者が供給する欄(`p_actor_id` 由来・「自分として」)は解決器が入力から外しているので、
 * ここにも現れない —— クライアントから渡された実行者 ID を信用しない(PRIN-0009)。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { BuiltSave } from '../../usecase/plan-build.js';
import { buildSavePlans, stopOnBuildProblems } from '../../usecase/plan-build.js';
import { preconditionFailure } from '../../kernel/generator-precondition.js';
import { findEntityFields } from '../../semantics/domain-index.js';
import { generatedFile, docComment, generatedHeader, toCamelCase, toPascalCase, tsString } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';
import { createPickSpreads, splitCreateKeys } from './create-input-pick.js';
import type { CreateInputPick } from './create-input-pick.js';

/** 出力先(1 ファイルに全保存点ぶん)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'usecase-inputs.ts');

/**
 * 全 usecase_spec の保存点から入力スキーマを生成するジェネレーター。
 * 出力は `app/src/domain/generated/usecase-inputs.ts`(ファイル全体)。
 */
export const usecaseInputsGenerator: DocGenerator = {
  id: 'code-usecase-inputs',

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
    return [{ file: outputFile(ctx.roots), content: renderFile(built.saves, model, ctx.roots), wholeFile: true }];
  },
};

/** 入力を持つ手順 1 つ(鍵・集約・欄・繰り返し)。 */
interface InputStep {
  /** 入力の鍵(usecase_spec の `as`。書かなければ操作 ID)。 */
  readonly alias: string;
  /** 操作 ID(エラーの文面に出す)。 */
  readonly op: string;
  readonly entity: string;
  /**
   * 生成 zod スキーマの置き場(`{集約}.schema.ts`)。
   *
   * **集約ディレクトリ名とエンティティ名は一致しないことがある**(`program` の entity は
   * `program_item`)。ファイル名は集約、export 名はエンティティで決まる(`code-zod.ts`)。
   */
  readonly module: string;
  readonly keys: readonly string[];
  readonly repeat: boolean;
  /** `id`(対象そのものの識別子)を含むか。行スキーマから借りる欄である。 */
  readonly needsId: boolean;
  /** 欄の借りる先の振り分け(作成入力の部品 / 行スキーマから任意で借りる位置の欄。`create-input-pick.ts`)。 */
  readonly split: CreateInputPick;
}

/** ファイル全体を組み立てる。 */
function renderFile(saves: readonly BuiltSave[], domain: SpecModel, roots: ProductRoots): string {
  const specFiles = [...new Set(saves.map((save) => specPath(roots, `frontend/usecases/${save.usecase.relPath}`)))].sort(
    (a, b) => a.localeCompare(b),
  );
  const stepsBySave = saves.map((save) => ({ save, steps: inputStepsOf(save, domain) }));
  const allSteps = stepsBySave.flatMap(({ steps }) => steps);
  const modules = [...new Set(allSteps.map((step) => step.module))].sort((a, b) => a.localeCompare(b));
  const imports = modules.map((module) => {
    const steps = allSteps.filter((step) => step.module === module);
    const names = [...new Set(steps.filter((step) => step.split.given.length > 0).map((step) => `${toCamelCase(step.entity)}InputSchema`))];
    for (const step of steps) {
      if (step.needsId || step.split.positional.length > 0) names.push(`${toCamelCase(step.entity)}RowSchema`);
    }
    return `import { ${[...new Set(names)].sort((a, b) => a.localeCompare(b)).join(', ')} } from './${module}.schema';`;
  });

  return [
    generatedHeader(specFiles),
    '',
    "import { z } from 'zod';",
    ...imports,
    '',
    docComment([
      '保存点の入力スキーマ。鍵は手順の別名(`as`。書かなければ操作 ID。複合 RPC の `p_input` と',
      '同じ形)であり、`repeat: true` の手順は配列になる。入力を 1 つも持たない手順は鍵ごと現れない。',
      '',
      '**Server Action と 1 画面フォームはここを共有する**(server-actions.md)。',
      '画面が事前に検証していてもサーバー側の検証は省略しない —— クライアントの検証は',
      'UX であり関門ではない(PRIN-0009)。',
    ]),
    ...stepsBySave.flatMap(({ save, steps }) => renderSave(save, steps)),
  ].join('\n');
}

/** 保存点 1 つぶん(手順ごとの欄のスキーマ + 保存点全体のスキーマ)。 */
function renderSave(save: BuiltSave, steps: readonly InputStep[]): readonly string[] {
  const base = `${toCamelCase(save.usecase.name)}${toPascalCase(save.plan.save.id)}`;
  const stepEntries = steps.map((step) => `  ${tsString(step.alias)}: ${pickExpression(step)},`);
  const saveEntries = steps.map(
    (step) =>
      `  ${tsString(step.alias)}: ${step.repeat ? `z.array(${base}StepSchemas[${tsString(step.alias)}])` : `${base}StepSchemas[${tsString(step.alias)}]`},`,
  );
  return [
    '',
    docComment([
      `${save.usecase.name} の保存点「${save.plan.save.label}」の手順ごとの入力スキーマ。`,
      '1 画面フォームが欄の制約(必須・最大長・選択肢)をここから読む。',
    ]),
    `export const ${base}StepSchemas = {\n${stepEntries.join('\n')}\n} as const;`,
    '',
    docComment([`${save.usecase.name}.${save.plan.save.id} の保存点全体の入力スキーマ。`]),
    `export const ${base}InputSchema = z.strictObject({\n${saveEntries.join('\n')}\n});`,
    '',
    docComment([`${save.usecase.name}.${save.plan.save.id} の入力の型。`]),
    `export type ${toPascalCase(save.usecase.name)}${toPascalCase(save.plan.save.id)}Input = z.infer<typeof ${base}InputSchema>;`,
    '',
  ];
}

/**
 * その手順の欄を生成スキーマから借りる式(`.pick` の shape と、対象の識別子だけ行スキーマから)。**閉世界**(`z.strictObject`。点検 25 回目
 * O25-2 / B の X3): 作成の欄の部品(`{entity}InputSchema`)は開いた object なので、借りた shape を包み直す —— 開いたままだと、作成の口から
 * 外した欄(`supplied_by: db` の発表順)を手順の要素に足した要求が黙って剥がされる。宣言に無い鍵は `unrecognized_keys` で断る。
 */
function pickExpression(step: InputStep): string {
  const entries = [
    ...createPickSpreads(step.entity, step.split),
    // 対象そのものの識別子は作成入力に無い(auto: true)ので、行スキーマの同じ欄を借りる。
    ...(step.needsId ? [`id: ${toCamelCase(step.entity)}RowSchema.shape.id`] : []),
  ];
  return entries.length === 0 ? 'z.strictObject({})' : `z.strictObject({ ${entries.join(', ')} })`;
}

/** 入力を 1 つ以上持つ手順を、宣言順に取り出す。 */
function inputStepsOf(save: BuiltSave, domain: SpecModel): readonly InputStep[] {
  const steps: InputStep[] = [];
  save.plan.steps.forEach((step, index) => {
    const keys = save.facts.steps[index]?.inputKeys ?? [];
    if (keys.length === 0) return;
    const known = new Set((findEntityFields(domain, step.entity) ?? []).map((field) => field.name));
    for (const key of keys) {
      if (key === 'id' || known.has(key)) continue;
      // `input` の欄が entity_spec に実在することは A3 が先に見ている。
      preconditionFailure('A3', [
        {
          message: `手順 ${step.op} の入力欄 ${key} が ${step.entity} の entity_spec にありません`,
          suggestion: 'action_spec の input と entity_spec の fields を揃える(綴りか、足し忘れ)',
          counterexample: { usecase: save.usecase.name, save: save.plan.save.id, step: step.op, field: key },
          location: { file: save.usecase.location.file, pointer: `saves.${save.plan.save.id}` },
        },
      ]);
    }
    steps.push({
      alias: step.alias,
      op: step.op,
      entity: step.entity,
      module: step.aggregate,
      keys,
      repeat: step.repeat,
      needsId: keys.includes('id'),
      split: splitCreateKeys(keys, findEntityFields(domain, step.entity) ?? []),
    });
  });
  return steps;
}
