/**
 * usecase_spec の保存点 → **Server Action と composition**(app の実装そのもの)の生成器。
 *
 * 決定性の格上げ ④ の初実例である。保存点の Server Action には集約ごとの個性が 1 つも無い ——
 * 「生成 zod で parse → 実行者を解決 → composition を呼ぶ」の 3 行しかなく、その 3 行は
 * ARCH-BE-0013 の定型そのものである。手で書ける場所を残すと、その分だけ定型から外れうる。
 *
 * 認証フロー仕様が多要素認証を要求する製品では、実行者の解決に「セッションが多要素認証を済ませたか」の 1 行が
 * 加わり、組み立ての根がそれを実行器へ渡す(執行は実行器。`mfa-entry.ts`)。外した製品の生成物は変わらない。
 *
 * **生成物は `app/src/domain/generated/` の外に出る**(層の配置規約が置き場を決めているため)。
 * したがって `generate:check` の対象に入れ、先頭に AUTO-GENERATED のヘッダを置く。
 * 実在と主 export の閉世界は `app/src/operation/__tests__/structure/` が
 * `structure-expectations.ts` の `expectedUsecaseFiles` と突き合わせる。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { SourceLocation } from '../../kernel/source-location.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { BuiltSave } from '../../usecase/plan-build.js';
import { buildSavePlans, stopOnBuildProblems } from '../../usecase/plan-build.js';
import { docComment, generatedHeader, toPascalCase, tsString } from '../../gen-kit/code-emit.js';
import { hooksExportName, hooksModuleOf, saveActionFileOf, saveBase, saveCompositionFileOf, saveCompositionModuleOf, saveKeyOf, savePascal } from './usecase-app-names.js';
import { computeRefsOf } from './operation-computes-names.js';
import { bodyModulesOf } from '../body-modules.js';
import type { BodyModules } from '../body-modules.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import { enforcedMfaScope } from '../../model/auth/mfa.js';
import type { MfaScope } from '../../model/auth/mfa.js';
import { actionMfaArg, actionMfaLines, authImportNames, compositionMfaParam, compositionRunLine } from './mfa-entry.js';
import { ACTION_PARAMS, INTENT_ARG, INTENT_PARAM_DOC, actionHeadLines, intentImportLine, parseFailureLines, profileLines, resultLines } from './refusal-log-entry.js';
import {
  RUNTIME_FORM_MODULE,
  RUNTIME_INTENT_MODULE,
  RUNTIME_RESULT_MODULE,
  RUNTIME_TEMPLATE_MODULE,
} from './runtime-modules.js';

/**
 * 全 usecase_spec の保存点から Server Action と composition を生成するジェネレーター。
 * 出力は配置の `save-entry` と `save-composition`(いまの Next.js の配置では `app/src/app/_actions/usecase/{name}/{save}.ts` と
 * `app/src/composition/usecase/{name}/{save}.ts`)。実装の木を宣言していない製品では 1 本も出さない(置き場が無いのが事実)。
 * **実装の木があるのに配置が役割を解決できなければ、黙って 0 本にせず前提の失敗で止める**(`app-placement.ts`)。
 */
export const usecaseAppGenerator: DocGenerator = {
  id: 'code-usecase-app',

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
    // 多要素認証の要求(単発の操作と同じ配線。mfa-entry.ts)。
    const mfa = enforcedMfaScope(ctx.auth?.flow?.mfa);
    return built.saves.flatMap((save) => {
      const location = { file: specPath(ctx.roots, `frontend/usecases/${save.usecase.relPath}`) };
      const modules = bodyModulesOf(ctx, { what: `保存点 ${saveKeyOf(save)} の入口と組み立ての根`, location });
      return [
        {
          file: saveActionFileOf(save, ctx.layout, ctx.roots, location),
          content: renderAction(save, ctx.roots, saveCompositionModuleOf(save, ctx.layout, location), modules, mfa),
          wholeFile: true,
        },
        { file: saveCompositionFileOf(save, ctx.layout, ctx.roots, location), content: renderInteractor(save, ctx.roots, ctx.layout, location, modules, mfa), wholeFile: true },
      ];
    });
  },
};

/** Server Action(ARCH-BE-0013 の①パースと結果の返却だけ)。 */
function renderAction(save: BuiltSave, roots: ProductRoots, compositionModule: string, modules: BodyModules, mfa: MfaScope | null): string {
  const base = saveBase(save);
  const specFile = specPath(roots, `frontend/usecases/${save.usecase.relPath}`);
  return [
    "'use server';",
    '',
    generatedHeader([specFile]),
    '',
    `import { toFieldIssues } from '${RUNTIME_FORM_MODULE}';`,
    `import { ${base}InputSchema } from '${modules.generated('usecase-inputs')}';`,
    `import type { ActionResult } from '${RUNTIME_RESULT_MODULE}';`,
    `import { err } from '${RUNTIME_RESULT_MODULE}';`,
    intentImportLine(RUNTIME_INTENT_MODULE),
    `import { ${authImportNames(mfa)} } from '${modules.auth()}';`,
    `import type { UsecaseResult } from '${compositionModule}';`,
    `import { create${savePascal(save)} } from '${compositionModule}';`,
    '',
    docComment([
      `${save.usecase.goal} —— 保存点「${save.plan.save.label}」の Server Action。`,
      '',
      `仕様: ${specFile}(保存点 ${save.plan.save.id})`,
      '',
      'この層が担うのは①のパースと結果の返却だけである(ARCH-BE-0013)。手順の `permit`・',
      '複合 RPC の呼び出し・拒否の写像は operation の実行器が持ち、権限や条件を判定する',
      '`if` はここに 1 つも無い。拒否は返す前に 1 行記録する(logging.md)。実行者はパースより先に解く。',
      '',
      `@param input 保存点の入力(鍵は手順の操作 ID。形の正は ${base}InputSchema)`,
      INTENT_PARAM_DOC,
      '@returns 成功なら保存点の結末、拒否なら ARCH-BE-0013 の 3 分類',
    ]),
    `export async function ${base}Action(${ACTION_PARAMS}): Promise<ActionResult<UsecaseResult>> {`,
    ...actionHeadLines(base),
    `  const parsed = ${base}InputSchema.safeParse(input);`,
    ...parseFailureLines(),
    // `claim` を持つロール(実行者自身の行の欄が根拠のもの)はセッションの profile から立つ。
    // DB は読まない —— サインインが書いた値をそのまま渡す(auth-spec-writing.md §session 属性)。
    ...profileLines(),
    ...actionMfaLines(mfa),
    ...resultLines(`create${savePascal(save)}()(actorId, actorClaims, parsed.data${actionMfaArg(mfa)}${INTENT_ARG})`),
    '}',
    '',
  ].join('\n');
}

/** composition(Composition Root。配線だけ)。 */
function renderInteractor(save: BuiltSave, roots: ProductRoots, layout: ProductLayout, location: SourceLocation, modules: BodyModules, mfa: MfaScope | null): string {
  const specFile = specPath(roots, `frontend/usecases/${save.usecase.relPath}`);
  const hooks = save.facts.invariantHooks.length === 0 ? '{}' : hooksExportName(save);
  const hooksImport =
    save.facts.invariantHooks.length === 0
      ? []
      : [`import { ${hooksExportName(save)} } from '${hooksModuleOf(save, layout, location)}';`];
  // 計算値の純関数(手書き)。保存点の手順が `computes` を宣言していれば、単発の操作と同じ
  // 形で配線する —— 配線の形が 2 つに割れると、同じ宣言が保存点でだけ黙って落ちる。
  const computeRefs = computeRefsOf(save.plan.steps);
  const computesImport = computeRefs.map((ref) => `import { ${ref} } from '${modules.computes(ref)}';`);
  return [
    generatedHeader([specFile]),
    '',
    "import 'server-only';",
    `import type { ${toPascalCase(save.usecase.name)}${toPascalCase(save.plan.save.id)}Input } from '${modules.generated('usecase-inputs')}';`,
    `import { usecasePlans } from '${modules.generated('usecase-plans')}';`,
    `import type { ActionResult } from '${RUNTIME_RESULT_MODULE}';`,
    `import { createDbPorts } from '${modules.dbPorts()}';`,
    `import { systemClock } from '${modules.clock()}';`,
    // 製品が渡す宣言の束(ADR-0013)。実行器はロール ID を持たないので、配線がここで渡す。
    `import { runtimeBindings } from '${modules.generated('runtime-bindings')}';`,
    `import type { ActorClaims, PlanResult } from '${RUNTIME_TEMPLATE_MODULE}';`,
    `import { runPlanOperation } from '${RUNTIME_TEMPLATE_MODULE}';`,
    ...hooksImport,
    ...computesImport,
    '',
    docComment(['保存点の結末(id と予測した最終状態)。Server Action はここから型を引く。']),
    'export type UsecaseResult = PlanResult;',
    '',
    docComment([
      `${save.usecase.name}.${save.plan.save.id} の Composition Root。`,
      '',
      `仕様: ${specFile}`,
      '',
      'この層の役割は配線だけである。分岐や計算が出てきたら operation に置く場所を',
      '間違えている(ARCH-BE-0001)。',
      '',
      '@returns 実行者と保存点の入力を受け取り、保存の結果を返す関数',
    ]),
    `export function create${savePascal(save)}(): (`,
    '  actorId: string | null,',
    '  actorClaims: ActorClaims,',
    `  input: ${toPascalCase(save.usecase.name)}${toPascalCase(save.plan.save.id)}Input,`,
    ...compositionMfaParam(mfa),
    ') => Promise<ActionResult<UsecaseResult>> {',
    `  const run = runPlanOperation(usecasePlans[${tsString(`${save.usecase.name}.${save.plan.save.id}`)}], ${hooks}${computeRefs.length === 0 ? '' : `, { ${computeRefs.join(', ')} }`});`,
    '  const deps = {',
    '    ...createDbPorts(),',
    '    clock: systemClock,',
    '    bindings: runtimeBindings,',
    '  };',
    compositionRunLine(mfa),
    '}',
    '',
  ].join('\n');
}
