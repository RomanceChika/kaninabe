/**
 * 実行計画 1 本 → **ユニットテスト**(`app/src/operation/__tests__/generated/**`)の生成器。
 *
 * 仕様: 束 ⑰ 設計 §6 / ADR-0012 ③(一致の証明は生成する)
 *
 * ## なぜテストを生成するのか
 *
 * 束 ⑰-2 までで、操作の**実装**は仕様からの生成物になった。しかしテストは手書きのまま
 * 残っていた(56 ファイル・9,858 行)。同じ仕様を人がもう一度読んで書き写している状態であり、
 * 書き漏らしは A7 が「宣言が足りない」と言うまで見えない。実行計画が「何を読み・どのロールを
 * どう解決し・どのガードを見るか」を仕様から決められる以上、**その宣言を満たす場面**も
 * 仕様から決められる(`lib/usecase/plan-scenario.ts`)。計算値(`computes`)の純関数は
 * 生成物ではないので、生成テストも本物を import して実行する(`operation-computes-names.ts`)。
 *
 * 生成されるのは「A7 が要求する意味クラスのそれぞれについて、FactReader と RpcCaller の
 * fake に対して計画を 1 回実行し、結末を突き合わせる」テストである。場面の値は仕様から
 * 解いたものであり、**期待もまた仕様から導いた独立の読み**である(実行時の評価器を呼んで
 * 比べているのではない)。`generate:check` の対象に入れ、先頭に AUTO-GENERATED のヘッダを
 * 置く(実装側の生成物と同じ扱い)。`runner: manual` の操作には計画が無いのでテストも
 * 生成されず、手書きのままである。規約どおりファイル I/O はしない純粋関数。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { buildOperationPlans } from '../../usecase/operation-plan.js';
import type { PlanScenario } from '../../usecase/plan-scenario.js';
import { SCENARIO_NOW, buildPlanScenarios } from '../../usecase/plan-scenario.js';
import { sessionProfileOf } from '../../usecase/plan-scenario-actors.js';
import type { PlanProperty } from '../../usecase/plan-scenario-property.js';
import { buildPlanProperty } from '../../usecase/plan-scenario-property.js';
import { deriveRequiredCoverage } from '../../trace/required-coverage.js';
import { generatedHeader, renderLiteral, tsString, type Literalizable, type LiteralValue } from '../../gen-kit/code-emit.js';
import { splitOperation } from './operation-app-names.js';
import { computeRefsOf } from './operation-computes-names.js';
import { bodyModulesOf, type BodyModules } from '../body-modules.js';
import { testCaseIdOf } from './operation-test-names.js';
import { operationTestPlacerOf } from './test-placement.js';
import { GENERATED_SUITE_SUFFIX, SCENARIO_TITLES } from '../../messages/messages.js';
import { specPath } from '../../model/product/paths.js';
import { RUNTIME_TEMPLATE_MODULE } from './runtime-modules.js';
import { mfaEnforced, scenarioMfaLines } from './mfa-entry.js';

/** 操作 1 本ぶんの場面(生成器と `action-test-cases.ts` が同じ導出を共有する)。 */
export interface OperationScenarios {
  readonly op: string;
  readonly specFile: string;
  /** 計画が実行する定型 RPC の名前(場面はどれも同じ計画を実行する)。 */
  readonly rpc: string;
  readonly scenarios: readonly PlanScenario[];
  /** 「計画の判定 = エンジンの判定」を振って確かめる性質(行を読まない計画では null)。 */
  readonly property: PlanProperty | null;
  /**
   * セッションが運ぶ欄の既定の一式(`entity_spec` の `session: true` を型から埋めたもの)。
   *
   * 場面が `true` にするのはロールの根拠になる欄だけで、残りはここが埋める。仕組み側の
   * コードがアプリの欄名を持たないための 1 手である(独立レビュー 6-A)。
   */
  readonly sessionProfile: Readonly<Record<string, LiteralValue>>;
  /** その計画が要求する計算値の純関数の名前(重複なし・名前順)。 */
  readonly computeRefs: readonly string[];
  /** 多要素認証を要求する製品か(サインインした実行者の場面を済ませたセッションで実行する。`scenarioMfaLines`)。 */
  readonly mfaVerified: boolean;
}

/**
 * 全 action_spec について、生成テストの場面を組み立てる。
 *
 * @param model ドメイン仕様
 * @param ctx 生成の文脈(ガード解析・action_spec・data_table・ジョブカタログ)
 * @returns 操作ごとの場面(操作 ID 順)
 */
export function operationScenarios(model: SpecModel, ctx: GenerateContext): readonly OperationScenarios[] {
  const built = buildOperationPlans({
    domain: model,
    guards: ctx.guards,
    actions: ctx.actions,
    dataTables: ctx.dataTables,
    jobs: ctx.jobs,
  });
  const specs = new Map((ctx.actions?.actions ?? []).map((action) => [action.handles.raw, action]));
  const sessionProfile = sessionProfileOf(model);
  return built.operations.flatMap((operation) => {
    const action = specs.get(operation.op);
    if (action === undefined) return [];
    const coverage = deriveRequiredCoverage(action, model);
    const scenarioInput = {
      operation,
      domain: model,
      guards: ctx.guards,
      required: coverage.required.map((entry) => entry.cls),
      roles: coverage.roles.map((entry) => entry.role),
    };
    return [
      {
        op: operation.op,
        // 生成物のヘッダが示す「正」= その操作の action_spec。
        specFile: specPath(ctx.roots, `backend/actions/${operation.plan.usecase.relPath}`),
        rpc: operation.plan.rpcName,
        scenarios: buildPlanScenarios(scenarioInput),
        property: buildPlanProperty(scenarioInput),
        sessionProfile,
        computeRefs: computeRefsOf(operation.plan.steps),
        mfaVerified: mfaEnforced(ctx.auth?.flow?.mfa),
      },
    ];
  });
}

/** 全 action_spec からユニットテストを生成するジェネレーター(場面も性質も導けない操作には出さない。空の describe はテスト実行系が落とし何も見ない。fix27 A2)。 */
export const operationTestsGenerator: DocGenerator = {
  id: 'code-operation-tests',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const place = operationTestPlacerOf(ctx);
    if (place === null) return [];
    return operationScenarios(model, ctx).filter((entry) => entry.scenarios.length > 0 || entry.property !== null).map((entry) => ({
      file: place(entry.op),
      content: renderTestFile(entry, bodyModulesOf(ctx, { what: `操作 ${entry.op} の生成ユニットテスト`, location: { file: entry.specFile } })),
      wholeFile: true,
    }));
  },
};

/** テストファイル 1 本。 */
function renderTestFile(entry: OperationScenarios, modules: BodyModules): string {
  const { aggregate, event } = splitOperation(entry.op);
  const depth = '../../../'; // __tests__/generated/{集約}/ から src/operation/ まで
  return [
    generatedHeader([entry.specFile]),
    '',
    "import { describe, expect, it } from 'vitest';",
    `import { operationPlans } from '${modules.generated('operation-plans')}';`,
    `import { runPlanOperation } from '${RUNTIME_TEMPLATE_MODULE}';`,
    `import { planHarness } from '${depth}__tests__/plan-harness';`,
    ...(entry.property === null ? [] : [`import { assertPlanMatchesEngine } from '${depth}__tests__/plan-property';`]),
    ...entry.computeRefs.map((ref) => `import { ${ref} } from '${modules.computes(ref)}';`),
    '',
    '/** この操作の実行計画(生成物)。テストは計画を差し替えず、そのまま実行する。 */',
    `const PLAN = operationPlans[${tsString(entry.op)}];`,
    '',
    '/** 実行器に計画を渡したもの(hooks を要求する計画は生成に乗らないので空で足りる)。 */',
    `const run = runPlanOperation(PLAN, {}${entry.computeRefs.length === 0 ? '' : `, { ${entry.computeRefs.join(', ')} }`});`,
    '',
    ...(entry.scenarios.some((scenario) => scenario.expect.kind === 'ok' && scenario.expect.id === null)
      ? ['/** 冪等キーの形(呼び出しごとに 1 つ作る値なので、値ではなく形だけを見る)。 */', 'const UUID = /^[0-9a-f-]{36}$/u;', '']
      : []),
    `describe(${tsString(`${aggregate}.${event}${GENERATED_SUITE_SUFFIX}`)}, () => {`,
    ...entry.scenarios.flatMap((scenario) => renderScenario(entry, scenario)),
    ...renderProperty(entry),
    '});',
    '',
  ].join('\n');
}

/** 場面 1 つ = `it()` 1 本。 */
function renderScenario(entry: OperationScenarios, scenario: PlanScenario): readonly string[] {
  const tcId = testCaseIdOf(entry.op, scenario.index);
  return [
    `  // @spec ${scenario.specIds.join(' @spec ')} @tc ${tcId}`,
    `  it(${tsString(scenario.title)}, async () => {`,
    `    const { deps, calls } = planHarness({`,
    `      rows: ${literal(scenario.rows)},`,
    `      outcome: ${outcomeLiteral(scenario)},`,
    `      now: ${tsString(SCENARIO_NOW)},`,
    `    });`,
    '',
    `    const result = await run(deps, {`,
    `      actorId: ${scenario.actorId === null ? 'null' : tsString(scenario.actorId)},`,
    `      actorClaims: ${claimsOf(entry, scenario.claims, scenario.actorId)},`,
    ...scenarioMfaLines(entry.mfaVerified, scenario.actorId),
    `      input: ${literal(scenario.input)},`,
    `    });`,
    '',
    ...expectation(entry.op, scenario),
    `    expect(calls).toHaveLength(${scenario.calls ? 1 : 0});`,
    ...(scenario.calls
      ? [
          `    expect(calls[0]?.rpc).toBe(${tsString(entry.rpc)});`,
          // **名前つき引数まで見る。** 関数名だけを見ていたころは、値を別の引数に載せる
          // 配線の取り違えが緑のまま通っていた(独立レビュー 1-B)。値の出どころは場面
          // そのもの(実行者・行に載せた状態・作った入力)であり、計画の写しではない。
          ...(Object.keys(scenario.args).length === 0
            ? []
            : [`    expect(calls[0]?.args).toMatchObject(${literal(scenario.args)});`]),
        ]
      : []),
    '  });',
    '',
  ];
}

/**
 * 性質の 1 本(操作ごとに 1 つ)。
 *
 * 場面が「その意味クラスになる 1 点」を実行するのに対し、ここは**判断に効く列を全部振って**
 * 「計画の判定 = エンジンの判定」を確かめる。注釈は付けない —— 仕様が要求する意味クラスの
 * 義務は場面の側が果たしており、これはその間を埋める性質だからである。
 */
function renderProperty(entry: OperationScenarios): readonly string[] {
  const property = entry.property;
  if (property === null) return [];
  return [
    `  it(${tsString(SCENARIO_TITLES.planMatchesEngine())}, async () => {`,
    `    await assertPlanMatchesEngine({`,
    `      plan: PLAN,`,
    `      rows: ${literal(property.rows)},`,
    `      actorId: ${tsString(property.actorId)},`,
    `      actorClaims: ${claimsOf(entry, property.claims, property.actorId)},`,
    `      input: ${literal(property.input)},`,
    `      now: ${tsString(SCENARIO_NOW)},`,
    `    });`,
    '  });',
  ];
}

/**
 * セッションの属性(型から決まる一式を土台に、claim のロールが立つ欄だけ上書きする。`true` か立つ値)。
 *
 * 欄名は 1 つも書かない —— 土台は `entity_spec` の `session: true` から作られている。
 */
function claimsOf(
  entry: OperationScenarios,
  claims: Readonly<Record<string, string | boolean>>,
  actorId: string | null,
): string {
  // **ログインした実行者には必ずプロフィールがある。** サインインは実行者の集約に行が
  // あったときだけ `app_metadata.profile` を書くので、「プロフィールがある」は「行がある」の
  // 写しであり、既定のログインロールはそれを根拠に立つ(`@kaninabe/runtime/template/actor`)。行が無い人
  // (= 未ログインとして扱われる人)だけが `null` である。
  if (actorId === null) return 'null';
  const profile: Record<string, LiteralValue> = { ...entry.sessionProfile };
  Object.assign(profile, claims);
  return Object.keys(profile).length === 0 ? 'null' : renderLiteral(profile);
}

/** RPC の fake が返す結末(書けた結果の受領は「要求した効果」と「outbox: 不明」。fake なので効果は空)。 */
function outcomeLiteral(scenario: PlanScenario): string {
  if (scenario.outcome === 'conflict') return "{ kind: 'conflict', op: '' }";
  if (scenario.outcome === 'invariant_violated') {
    const invariant = scenario.expect.kind === 'invariant_violated' ? scenario.expect.invariant : '';
    return `{ kind: 'invariant_violated', invariant: ${tsString(invariant)} }`;
  }
  return "{ kind: 'saved', receipt: { returned: { shape: 'rows', rows: [{}] }, requestedEffects: [], outbox: 'unknown' } }";
}

/** 期待(成功は値まで、拒否は 3 分類と載せる ID まで)。 */
function expectation(op: string, scenario: PlanScenario): readonly string[] {
  const expect = scenario.expect;
  switch (expect.kind) {
    case 'ok':
      // id が冪等キー(呼び出しごとに 1 つ作る値)のときは、値ではなく**形**だけを見る。
      return expect.id === null
        ? [
            `    expect(result.ok).toBe(true);`,
            `    if (!result.ok) return;`,
            `    expect(result.value).toEqual({ id: result.value.id, state: ${literal(expect.state)} });`,
            `    expect(result.value.id).toMatch(UUID);`,
          ]
        : [
            `    expect(result).toEqual({`,
            `      ok: true,`,
            `      value: { id: ${tsString(expect.id)}, state: ${literal(expect.state)} },`,
            `    });`,
          ];
    case 'forbidden':
      return [
        `    expect(result).toEqual({`,
        `      ok: false,`,
        `      error: { kind: 'forbidden', event: ${tsString(op)}, role: ${tsString(expect.role)} },`,
        `    });`,
      ];
    case 'guard_unsatisfied':
      // 理由文は仕様(`otherwise_forbidden` / ガード式の字面)が持つので、分類までを見る。
      return [
        `    expect(result).toMatchObject({`,
        `      ok: false,`,
        `      error: { kind: 'guard_unsatisfied', event: ${tsString(op)}, blockedBy: ${tsString(expect.blockedBy)} },`,
        `    });`,
      ];
    case 'invariant_violated':
      return [
        `    expect(result).toEqual({`,
        `      ok: false,`,
        `      error: { kind: 'invariant_violated', invariant: ${tsString(expect.invariant)} },`,
        `    });`,
      ];
    default:
      return [
        `    expect(result).toEqual({`,
        `      ok: false,`,
        `      error: { kind: 'invalid_input', issues: [{ field: 'changes', code: 'empty' }] },`,
        `    });`,
      ];
  }
}

/** 値を TypeScript のリテラル式にする(字下げは呼び出し側の深さに合わせる)。 */
function literal<T>(value: T & Literalizable<T>, indent = 3): string {
  return renderLiteral(value, indent);
}
