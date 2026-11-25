/**
 * usecase_spec の保存点 → **1 画面フォーム**(`app/src/components/usecase/generated/*.tsx`)。
 *
 * ADR-0011 §3 の 1 段目(見せ方で吸収する)の実装である。保存点の入力は「手順ごとの
 * 入力オブジェクト」なので、画面も**手順ごとの欄の束を 1 枚に並べて 1 回送る**形に決まる
 * ——並べ方に集約ごとの個性は無い。したがって手で書く場所を残さない。
 *
 * **この生成器はアプリの語彙を 1 語も持たない**(W1)。欄の名前・表示名・選択肢はすべて
 * 仕様からの生成物(`usecase-inputs.ts` の zod・`{entity}FieldLabels`・`{entity}EnumLabels`)を
 * 実行時に引く。
 * 参照(`ref`)の欄は画面が決める値なので入力欄を出さず、`initial` で受け取る。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { BuiltSave } from '../../usecase/plan-build.js';
import { buildSavePlans, stopOnBuildProblems } from '../../usecase/plan-build.js';
import { controlKindOf } from './form-control-kind.js';
import { findField } from '../../semantics/domain-index.js';
import { generatedHeader } from '../../gen-kit/code-emit.js';
import { formFilePathOf, saveKeyOf } from './usecase-app-names.js';
import type { FormControlKind, FormStep } from './usecase-form-body.js';
import { renderFormBody } from './usecase-form-body.js';
import { bodyModulesOf } from '../body-modules.js';
import type { BodyModules } from '../body-modules.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/**
 * 全 usecase_spec の保存点から 1 画面フォームを生成するジェネレーター。
 * 出力は配置の `ui-component`(いまの Next.js の配置では `app/src/components/usecase/generated/{name}.{save}-form.tsx`。ファイル全体)。
 * 実装の木を宣言していない製品では 1 本も出さない(置き場が無いのが事実)。**実装の木があるのに配置が役割を解決できなければ、黙って 0 本にせず
 * 前提の失敗で止める**(`app-placement.ts`)。
 */
export const usecaseFormGenerator: DocGenerator = {
  id: 'code-usecase-form',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const built = buildSavePlans({
      domain: model,
      guards: ctx.guards,
      actions: ctx.actions ?? null,
      dataTables: ctx.dataTables,
      usecases: ctx.usecases,
    });
    if (built.problems.length > 0) stopOnBuildProblems(built.problems);
    if (ctx.roots.app === null) return [];
    return built.saves.map((save) => {
      const location = { file: specPath(ctx.roots, `frontend/usecases/${save.usecase.relPath}`) };
      return {
        file: formFilePathOf(save, ctx.layout, ctx.roots, location),
        content: renderForm(save, model, ctx.roots, bodyModulesOf(ctx, { what: `保存点 ${saveKeyOf(save)} の 1 画面フォーム`, location })),
        wholeFile: true,
      };
    });
  },
};

/** フォーム 1 枚を組み立てる。 */
function renderForm(save: BuiltSave, domain: SpecModel, roots: ProductRoots, modules: BodyModules): string {
  const steps = formStepsOf(save, domain);
  const specFile = specPath(roots, `frontend/usecases/${save.usecase.relPath}`);
  return ["'use client';", '', generatedHeader([specFile]), '', ...renderFormBody(save, steps, roots, modules)].join('\n');
}

/**
 * 手順ごとの欄の割り当て。
 *
 * **見た目の種類は entity_spec の型から決まる**(仕様は「どの部品で入れるか」を持たないので、
 * この対応は実装の判断である —— 判断の置き場をここ 1 か所にすることで、保存点ごとに
 * 揺れない)。参照の欄は入力欄を出さず、画面が `initial` で渡す。
 */
function formStepsOf(save: BuiltSave, domain: SpecModel): readonly FormStep[] {
  const steps: FormStep[] = [];
  save.plan.steps.forEach((step, index) => {
    const keys = save.facts.steps[index]?.inputKeys ?? [];
    if (keys.length === 0) return;
    const controls: { field: string; kind: FormControlKind }[] = [];
    const supplied: string[] = [];
    for (const key of keys) {
      const field = findField(domain, step.entity, key);
      const kind = field === null ? null : controlKindOf(field.type.kind);
      if (kind === null) supplied.push(key);
      else controls.push({ field: key, kind });
    }
    steps.push({
      alias: step.alias,
      label: step.label,
      op: step.op,
      entity: step.entity,
      repeat: step.repeat,
      controls,
      supplied,
      hasEnumLabels: controls.some((control) => control.kind === 'select'),
    });
  });
  return steps;
}
