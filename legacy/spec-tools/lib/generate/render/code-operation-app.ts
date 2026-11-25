/**
 * action_spec 1 本 → **Server Action と Composition Root**(app の実装そのもの)の生成器。
 *
 * 保存点について ⑯c-2 が行ったこと(`code-usecase-app.ts`)を、**単発の操作の全数**に広げる
 * ものである(ADR-0012 ④ / 束 ⑰-2)。単発の操作の Server Action には集約ごとの個性が 1 つも
 * 無い —— 「生成 zod で parse → 実行者とセッションの属性を解決 → Composition Root を呼ぶ」の
 * 3 行しかなく、その 3 行は ARCH-BE-0013 の定型そのものである。Composition Root も同じで、
 * 本番の実装を実行器に配線するだけであり、分岐も計算も無い(ARCH-BE-0001)。
 *
 * 認証フロー仕様が多要素認証を要求する製品では、実行者の解決に「セッションが多要素認証を済ませたか」の 1 行が
 * 加わり、組み立ての根がそれを実行器へ渡す(執行は実行器。`mfa-entry.ts`)。外した製品の生成物は変わらない。
 *
 * **手で書ける場所を残すと、その分だけ定型から外れうる。** 実際、束 ⑰-1 の実測では 69 操作の
 * うち 25 本に「仕様に無い知識」が実装だけに住んでいた。生成に乗らない操作は action_spec が
 * `runner: manual` を理由つきで宣言し、その 1 本だけが手書きの余地を持つ(A15 が数える)。
 *
 * **システム専用のイベント(`by` が system だけ)には Server Action を生成しない。** Server Action は
 * 誰でも POST できる公開の入口であり、そこに実行者が system として解決される経路は無いので、
 * 生成しても常に forbidden で終わる死んだ口になる(正典 2 つが同じことを書いている ——
 * action-spec-writing.md §system が起こすイベント / docs/specs/backend/actions/README.md)。
 * Composition Root は作る —— 実行する経路(受信口・走査)から呼ぶ配線はどの操作にも 1 つある。
 *
 * **生成物は `app/src/domain/generated/` の外に出る**(層の配置規約が置き場を決めているため)。
 * したがって `generate:check` の対象に入れ、先頭に AUTO-GENERATED のヘッダを置く。実在と主
 * export の閉世界は `app/src/operation/__tests__/structure/` が `structure-expectations.ts` と
 * 突き合わせる。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { BuiltOperation } from '../../usecase/operation-plan.js';
import { buildOperationPlans } from '../../usecase/operation-plan.js';
import { isSystemOnlyOperation } from '../../usecase/operation-plan-marks.js';
import { docComment, generatedHeader, tsString } from '../../gen-kit/code-emit.js';
import {
  actionExportOf,
  actionFileOf,
  compositionFileOf,
  compositionModuleOf,
  factoryExportOf,
  inputTypeOf,
  operationNameOf,
} from './operation-app-names.js';
import { hooksExportOf } from './operation-hooks-names.js';
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
 * 全 action_spec から Server Action と Composition Root を生成するジェネレーター。
 * 出力は配置の `operation-entry` と `operation-composition`(いまの Next.js の配置では `app/src/app/_actions/{集約}/{イベント}.ts` と
 * `app/src/composition/{集約}/{イベント}.ts`)。実装の木を宣言していない製品では 1 本も出さない(置き場が無いのが事実)。
 * **実装の木があるのに配置が役割を解決できなければ、黙って 0 本にせず前提の失敗で止める**(`app-placement.ts`)。
 */
export const operationAppGenerator: DocGenerator = {
  id: 'code-operation-app',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const built = buildOperationPlans({
      domain: model,
      guards: ctx.guards,
      actions: ctx.actions,
      dataTables: ctx.dataTables,
      jobs: ctx.jobs,
    });
    if (ctx.roots.app === null) return [];
    // 多要素認証の要求(要求を宣言した製品だけ、Server Action が済ませたかを解決して実行器へ渡す。mfa-entry.ts)。
    const mfa = enforcedMfaScope(ctx.auth?.flow?.mfa);
    return built.operations.flatMap((operation) => {
      const location = { file: specFileOf(operation, ctx.roots) };
      const modules = bodyModulesOf(ctx, { what: `操作 ${operation.op} の入口と組み立ての根`, location });
      return [
        // **システム専用のイベントには Server Action を生成しない**(常に forbidden で終わる
        // 死んだ口を作らない)。Composition Root は作る —— 実行する経路(受信口・走査)から呼ぶ
        // 配線はどの操作にも 1 つある。正典: action-spec-writing.md / actions/README.md。
        ...(isSystemOnlyOperation(model, operation.op)
          ? []
          : [
              {
                file: actionFileOf(operation.op, ctx.layout, ctx.roots, location),
                content: renderAction(operation, ctx.roots, compositionModuleOf(operation.op, ctx.layout, location), modules, mfa),
                wholeFile: true,
              },
            ]),
        { file: compositionFileOf(operation.op, ctx.layout, ctx.roots, location), content: renderComposition(operation, ctx.roots, modules, mfa), wholeFile: true },
      ];
    });
  },
};

/** その操作の action_spec(生成物のヘッダが示す「正」)。 */
function specFileOf(operation: BuiltOperation, roots: ProductRoots): string {
  return specPath(roots, `backend/actions/${operation.plan.usecase.relPath}`);
}

/** 人の言葉での操作の名前(手順は 1 つなので、その手順の label)。 */
function labelOf(operation: BuiltOperation): string {
  return operation.plan.steps[0]?.label ?? operation.op;
}

/** Server Action(ARCH-BE-0013 の①パースと結果の返却だけ)。 */
function renderAction(operation: BuiltOperation, roots: ProductRoots, compositionModule: string, modules: BodyModules, mfa: MfaScope | null): string {
  const op = operation.op;
  return [
    "'use server';",
    '',
    generatedHeader([specFileOf(operation, roots)]),
    '',
    `import { toFieldIssues } from '${RUNTIME_FORM_MODULE}';`,
    `import { operationInputSchemas } from '${modules.generated('operation-inputs')}';`,
    `import type { ActionResult } from '${RUNTIME_RESULT_MODULE}';`,
    `import { err } from '${RUNTIME_RESULT_MODULE}';`,
    intentImportLine(RUNTIME_INTENT_MODULE),
    `import { ${authImportNames(mfa)} } from '${modules.auth()}';`,
    `import type { OperationResult } from '${compositionModule}';`,
    `import { ${factoryExportOf(op)} } from '${compositionModule}';`,
    '',
    docComment([
      `${labelOf(operation)} —— 操作 \`${op}\` の Server Action。`,
      '',
      `仕様: ${specFileOf(operation, roots)}`,
      '',
      'この層が担うのは①のパースと結果の返却だけである(ARCH-BE-0013)。`permit`・定型 RPC の',
      '呼び出し・拒否の写像は operation の実行器が持ち、権限や条件を判定する `if` は',
      'ここに 1 つも無い。拒否は返す前に 1 行記録する(logging.md)。実行者はパースより先に解く。',
      '',
      `@param input 操作の入力(形の正は operationInputSchemas[${tsString(op)}])`,
      INTENT_PARAM_DOC,
      '@returns 成功なら結末の id と状態、拒否なら ARCH-BE-0013 の 3 分類',
    ]),
    `export async function ${actionExportOf(op)}(${ACTION_PARAMS}): Promise<ActionResult<OperationResult>> {`,
    ...actionHeadLines(operationNameOf(op)),
    `  const parsed = operationInputSchemas[${tsString(op)}].safeParse(input);`,
    ...parseFailureLines(),
    // `claim` を持つロール(実行者自身の行の欄が根拠のもの)はセッションの profile から立つ。
    // DB は読まない —— サインインが書いた値をそのまま渡す(auth-spec-writing.md §session 属性)。
    ...profileLines(),
    ...actionMfaLines(mfa),
    ...resultLines(`${factoryExportOf(op)}()(actorId, actorClaims, parsed.data${actionMfaArg(mfa)}${INTENT_ARG})`),
    '}',
    '',
  ].join('\n');
}

/** Composition Root(配線だけ)。 */
function renderComposition(operation: BuiltOperation, roots: ProductRoots, modules: BodyModules, mfa: MfaScope | null): string {
  const op = operation.op;
  const hooks = operation.facts.invariantHooks.length === 0 ? '{}' : hooksExportOf(op);
  const hooksImport =
    operation.facts.invariantHooks.length === 0
      ? []
      : [`import { ${hooksExportOf(op)} } from '${modules.operationHooks(op)}';`];
  // 計算値の純関数(手書き)。名前の全数を渡すので、宣言したのに配線し忘れる状態になれない。
  const computeRefs = computeRefsOf(operation.plan.steps);
  const computesImport = computeRefs.map((ref) => `import { ${ref} } from '${modules.computes(ref)}';`);
  return [
    generatedHeader([specFileOf(operation, roots)]),
    '',
    "import 'server-only';",
    "import type { z } from 'zod';",
    `import type { operationInputSchemas } from '${modules.generated('operation-inputs')}';`,
    `import { operationPlans } from '${modules.generated('operation-plans')}';`,
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
    docComment([
      '操作の結末(結末の集約の id と、その後の状態)。Server Action はここから型を引く。',
    ]),
    'export type OperationResult = PlanResult;',
    '',
    docComment([
      `${op} の入力(生成スキーマそのもの。制約の正は entity_spec)。`,
    ]),
    `export type ${inputTypeOf(op)} = z.infer<(typeof operationInputSchemas)[${tsString(op)}]>;`,
    '',
    docComment([
      `${op} の Composition Root。`,
      '',
      `仕様: ${specFileOf(operation, roots)}`,
      '',
      'この層の役割は配線だけである。分岐や計算が出てきたら operation に置く場所を',
      '間違えている(ARCH-BE-0001)。',
      '',
      '@returns 実行者・セッションの属性・入力を受け取り、操作の結果を返す関数',
    ]),
    `export function ${factoryExportOf(op)}(): (`,
    '  actorId: string | null,',
    '  actorClaims: ActorClaims,',
    `  input: ${inputTypeOf(op)},`,
    ...compositionMfaParam(mfa),
    ') => Promise<ActionResult<OperationResult>> {',
    `  const run = runPlanOperation(operationPlans[${tsString(op)}], ${hooks}${computeRefs.length === 0 ? '' : `, { ${computeRefs.join(', ')} }`});`,
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
