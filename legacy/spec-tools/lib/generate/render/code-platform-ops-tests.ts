/**
 * auth_spec の `platform_ops`(ADR-0019)→ **生成テスト**(認証基盤の操作の権限表・接続・負例・入口の関門)。
 *
 * 期待はすべて宣言から導く。試験の対象は**配線先の本物の組み立て**に偽の部品(実行者・資格・DB の写し)を渡した場面で、場面は製品が手で書く
 * `{配線}.scenario`(`PlatformScenarioFactory`)が返す。生成する試験は 7 つ:
 *
 *   - **権限表** … 各操作 × {未ログイン・有効メンバー・宣言したロールの持ち主・無効化された持ち主}で、許す実行者だけが成功し、ほかは宣言した理由で拒まれ、何も変わらない
 *   - **現在の端末が不明** … `needs: current_session` の操作は、拒まれて本人の持ち物が何も変わらない
 *   - **偽造した ID** … 本人の読みの行から受ける識別子に、別のメンバーの ID・一覧に無い ID・形の壊れた ID を渡しても、誰の持ち物も変わらない(UI の出どころは改竄不能の証明ではない)
 *   - **接続** … 配線先が受ける呼び出し(メソッド・引数の値・型つきの入力の渡し値 true / false)が、宣言した対応表から導いた期待と等しい
 *   - **結果の写し** … 配線先の行が、宣言した対応表どおりの欄の値になり、配線先の応答に余分な(秘密の語を含む)欄があっても画面の値に残らない
 *   - **多要素認証**(要求する製品だけ) … 済ませていないセッションは配線先を呼ぶ前に拒まれる
 *   - **入力のスキーマ・入口の関門の順序** … 宣言した引数だけを受け(余剰の鍵・メンバー ID を弾く)、入口が実行者の解決 → パース → 組み立ての根 → 記録の順で、パースした値だけを渡す
 *
 * 宣言の無い製品・実装の木を持たない製品は何も出さない。アプリの語彙は 1 語も持たない(W1)。
 */

import { posix } from 'node:path';
import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { docComment, generatedHeader, toCamelCase, tsString } from '../../gen-kit/code-emit.js';
import { enforcedMfaScope } from '../../model/auth/mfa.js';
import { LAYOUT_DEFINITION_CHECK, placedPath } from '../layout-placement.js';
import { bodyModulesOf } from '../body-modules.js';
import { appPlacedPath } from './app-placement.js';
import { PLATFORM_OPS_MODULE } from './code-platform-ops-app.js';
import { buildPlatformPlan, callArguments } from './platform-ops-plan.js';
import type { PlatformOpPlan, PlatformPlan } from './platform-ops-plan.js';
import { PLATFORM_TEST_TITLES, toolLines, testLines } from './platform-ops-test-body.js';
import type { PlatformTestKey } from './platform-ops-test-body.js';
import { RUNTIME_PLATFORM_OP_MODULE } from './runtime-modules.js';

/** 一覧に無い ID(形は UUID。どの場面の持ち物でもない)。 */
const UNLISTED_ID = '00000000-0000-4000-8000-00000000dead';

/** 入力のスキーマの試験で使う、UUID の形の識別子。 */
const VALID_UUID = '00000000-0000-4000-8000-000000000001';

/** 余分な欄に載せる印(画面の値に残ってはいけない)。 */
const LEAK_MARKER = 'LEAK-MARKER-7f3a';

/** 認証基盤の操作の生成テストを書くジェネレーター。 */
export const platformOpsTestsGenerator: DocGenerator = {
  id: 'code-platform-ops-tests',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const plan = buildPlatformPlan(ctx.auth);
    const flow = ctx.auth?.flow;
    if (ctx.roots.app === null || plan.ops.length === 0 || flow === undefined || flow === null) return [];
    const location = flow.location;
    const file = placedPath(ctx.layout, ctx.roots, { role: 'platform-op-test', what: '認証基盤の操作の生成テスト', location, verifier: LAYOUT_DEFINITION_CHECK });
    const modules = bodyModulesOf(ctx, { what: '認証基盤の操作の生成テスト', location });
    const entryFile = (op: PlatformOpPlan): string => appPlacedPath(ctx.layout, ctx.roots, { role: 'platform-op-entry', key: op.id, what: `認証基盤の操作 ${op.id} の Server Action`, location });
    const compositionFile = (op: PlatformOpPlan): string => appPlacedPath(ctx.layout, ctx.roots, { role: 'platform-op-composition', key: op.id, what: `認証基盤の操作 ${op.id} の組み立ての根`, location });
    const relativeTo = (target: string): string => posix.relative(posix.dirname(file), target);
    const mfa = enforcedMfaScope(flow.mfa) !== null;
    const roles = [...new Set(plan.ops.flatMap((op) => (op.op.actor.kind === 'role' ? [op.op.actor.role] : [])))];
    return [
      {
        file,
        content: render({ plan, specFile: location.file, tag: (key: PlatformTestKey) => tagOf(flow, file, key), modules, mfa, roles, secretWords: flow.platformOps?.secretWords ?? [], entryPath: (op) => relativeTo(entryFile(op)), compositionPath: (op) => relativeTo(compositionFile(op)) }),
        wholeFile: true,
      },
    ];
  },
};

/** 試験の題に対応する仕様の `test_cases` の 1 件を引き、`@spec … @tc …` の注釈にする(無ければ null)。 */
function tagOf(flow: { readonly id: string; readonly testCases: readonly { readonly id: string; readonly implementation: { readonly file: string; readonly testName: string } }[] }, file: string, key: PlatformTestKey): string | null {
  const found = flow.testCases.find((testCase) => testCase.implementation.file === file && testCase.implementation.testName === PLATFORM_TEST_TITLES[key]);
  return found === undefined ? null : `@spec ${flow.id} @tc ${found.id}`;
}

/** 描画の入力。 */
interface Input {
  readonly plan: PlatformPlan;
  readonly specFile: string;
  readonly modules: ReturnType<typeof bodyModulesOf>;
  readonly mfa: boolean;
  readonly roles: readonly string[];
  readonly secretWords: readonly string[];
  /** 試験の題 → 注釈(`@spec … @tc …`。仕様の `test_cases` がこのファイルのその題を指しているときだけ)。 */
  readonly tag: (key: PlatformTestKey) => string | null;
  readonly entryPath: (op: PlatformOpPlan) => string;
  readonly compositionPath: (op: PlatformOpPlan) => string;
}

/** 実行者の名前(宣言したロールの持ち主 `holder_{ロール}`・無効化された持ち主 `deactivated_{ロール}`)。 */
function holderOf(role: string): string {
  return `holder_${role}`;
}

/** ファイル全体。 */
function render(input: Input): string {
  const { plan, modules } = input;
  const generated = modules.generated(PLATFORM_OPS_MODULE);
  const ports = plan.ports;
  const fieldTables = plan.shapes.map((shape) => `${toCamelCase(shape.name)}Fields`);
  const actorNames = ['logged_out', 'signed_in', ...input.roles.flatMap((role) => [holderOf(role), `deactivated_${role}`])];
  return [
    generatedHeader([input.specFile]),
    '',
    "import { readFileSync } from 'node:fs';",
    "import { describe, expect, it } from 'vitest';",
    `import type { PlatformOpResult, PlatformScenarioSpec, PlatformScenarioWorld } from '${RUNTIME_PLATFORM_OP_MODULE}';`,
    `import type { PlatformOpId } from '${generated}';`,
    `import { ${[...plan.ops.map((op) => `${op.base}InputSchema`), ...fieldTables, 'platformOpRefusals'].sort().join(', ')} } from '${generated}';`,
    ...ports.map((port) => `import { ${port.name.charAt(0).toLowerCase()}${port.name.slice(1)}Scenario } from '${modules.platformScenario(port.name)}';`),
    ...plan.ops.map((op) => `import { ${op.base} } from '${modules.platformComposition(op.id)}';`),
    '',
    docComment([
      '認証基盤の操作(`platform_ops`)の生成テスト(ADR-0019)。',
      '',
      `仕様: ${input.specFile}`,
      '',
      '期待はすべて宣言から導く。試験の対象は配線先の本物の組み立てに偽の部品を渡した場面(製品が手で書く `{配線}.scenario` が返す)で、',
      '権限表・現在の端末・偽造 ID・接続・結果の写し・入力のスキーマ・入口の関門の順序を確かめる。',
    ]),
    `const LEAK_MARKER = ${tsString(LEAK_MARKER)};`,
    `const UNLISTED_ID = ${tsString(UNLISTED_ID)};`,
    '',
    `type ActorName = ${actorNames.map((name) => tsString(name)).join(' | ')};`,
    '',
    docComment(['場面の実行者(未ログイン・有効メンバー・宣言したロールの持ち主・無効化された持ち主)。']),
    'const ACTORS: Readonly<Record<ActorName, PlatformScenarioSpec["actor"]>> = {',
    '  logged_out: null,',
    "  signed_in: { id: 'signed-in-a', activeMember: true, roles: [] },",
    ...input.roles.flatMap((role) => [
      `  ${holderOf(role)}: { id: ${tsString(`holder-${role}`)}, activeMember: true, roles: [${tsString(role)}] },`,
      `  deactivated_${role}: { id: ${tsString(`deactivated-${role}`)}, activeMember: false, roles: [${tsString(role)}] },`,
    ]),
    '};',
    '',
    'const ACTOR_NAMES = Object.keys(ACTORS) as ActorName[];',
    '',
    docComment(['操作の ID → 返す欄の表(宣言順。読みの操作だけ)。']),
    'const SHAPE_FIELDS: Readonly<Record<string, readonly { readonly field: string; readonly prop: string; readonly from: string }[]>> = {',
    ...plan.ops.filter((op) => op.shape !== undefined).map((op) => `  ${tsString(op.id)}: ${toCamelCase(op.shape?.name ?? '')}Fields,`),
    '};',
    '',
    ...toolLines({ leakKeys: input.secretWords.map((word) => `${word}Value`) }),
    '',
    ...plan.ops.flatMap((op) => probeLines(op, input)),
    ...casesLines(plan, input),
    ...schemaLines(plan),
    ...entryLines(plan, input),
    ...testLines({
      mfa: input.mfa,
      tag: input.tag,
      has: {
        currentSession: plan.ops.some((op) => op.op.needsCurrentSession),
        selfRows: plan.ops.some((op) => selfRowsOf(op, plan)),
        reads: plan.ops.some((op) => op.op.kind === 'read'),
      },
    }),
    '',
  ].join('\n');
}

/** 操作 1 つの場面の関数。 */
function probeLines(plan: PlatformOpPlan, input: Input): string[] {
  const typed = plan.inputs.filter((candidate) => !candidate.row);
  const fields = plan.inputs.map((candidate) => {
    if (candidate.row) return `${candidate.prop}: targetOf(world, ${tsString(candidate.source?.of ?? '')}, options.mode ?? 'own')`;
    if (candidate.type === 'boolean') return `${candidate.prop}: variant[${tsString(candidate.prop)}] === true`;
    if (candidate.type === 'number') return `${candidate.prop}: typeof variant[${tsString(candidate.prop)}] === 'number' ? variant[${tsString(candidate.prop)}] : 0`;
    return `${candidate.prop}: String(variant[${tsString(candidate.prop)}] ?? '')`;
  });
  const scenario = `${plan.portFactory}Scenario`;
  const facts = input.mfa ? '{ actorId: spec.actor?.id ?? null, actorMfa: options.mfa ?? true }' : '{ actorId: spec.actor?.id ?? null }';
  return [
    `async function probe${plan.pascal}(spec: PlatformScenarioSpec, options: ProbeOptions = {}): Promise<Probe> {`,
    `  const world = ${scenario}(spec);`,
    `  const { port, calls } = record(world.port, options.leak === true, { ok: ${tsString(plan.port.union.ok)}, value: ${tsString(plan.port.union.value)} });`,
    ...(typed.length === 0 ? [] : ['  const variant = options.variant ?? {};']),
    `  const input = { ${fields.join(', ')} };`,
    `  const result = await settle(() => ${plan.base}(${facts}, input, port));`,
    `  return { result, world, calls, expected: [{ method: ${tsString(plan.op.binding.method)}, args: [${callArguments(plan).join(', ')}] }] };`,
    '}',
    '',
  ];
}

/** 変種(型つきの入力の値の組。真偽値は両方・整数は既定か 0)。 */
function variantsOf(plan: PlatformOpPlan): readonly Record<string, boolean | number>[] {
  const typed = plan.op.args.filter((arg) => arg.kind === 'typed');
  return typed.reduce<readonly Record<string, boolean | number>[]>(
    (acc, arg) => {
      const values: readonly (boolean | number)[] = arg.type === 'bool' ? [true, false] : arg.type === 'int' ? [typeof arg.default === 'number' ? arg.default : 0] : [];
      return acc.flatMap((variant) => values.map((value) => ({ ...variant, [toCamelCase(arg.name)]: value })));
    },
    [{}],
  );
}

/** 許す実行者(宣言から)。 */
function allowedOf(plan: PlatformOpPlan, roles: readonly string[]): readonly string[] {
  const actor = plan.op.actor;
  if (actor.kind === 'self') return ['signed_in', ...roles.flatMap((role) => [holderOf(role), `deactivated_${role}`])];
  return [holderOf(actor.role), ...(actor.activeMember ? [] : [`deactivated_${actor.role}`])];
}

/** 本人の読みの行から受ける識別子か(偽造 ID の試験の対象)。 */
function selfRowsOf(plan: PlatformOpPlan, all: PlatformPlan): boolean {
  return plan.inputs.some((candidate) => candidate.row && all.ops.find((op) => op.id === candidate.source?.of)?.op.actor.kind === 'self');
}

/** 操作の表。 */
function casesLines(all: PlatformPlan, input: Input): string[] {
  return [
    docComment(['操作の表(宣言から導く。許す実行者・変種・場面の関数)。']),
    'const CASES: readonly OpCase[] = [',
    ...all.ops.flatMap((plan) => {
      const selfRows = selfRowsOf(plan, all);
      const hasRows = plan.inputs.some((candidate) => candidate.row);
      return [
        '  {',
        `    id: ${tsString(plan.id)},`,
        `    kind: ${tsString(plan.op.kind)},`,
        `    allowed: [${allowedOf(plan, input.roles).map((name) => tsString(name)).join(', ')}],`,
        `    needsCurrentSession: ${String(plan.op.needsCurrentSession)},`,
        `    selfRows: ${String(selfRows)},`,
        `    defaultMode: ${tsString(hasRows && !selfRows ? 'foreign' : 'own')},`,
        `    variants: ${JSON.stringify(variantsOf(plan))},`,
        `    probe: probe${plan.pascal},`,
        '  },',
      ];
    }),
    '];',
    '',
  ];
}

/** 入力のスキーマの試験の表。 */
function schemaLines(all: PlatformPlan): string[] {
  const valid = (plan: PlatformOpPlan): string =>
    JSON.stringify(Object.fromEntries(plan.inputs.map((candidate) => [candidate.prop, candidate.row ? (candidate.uuid ? VALID_UUID : 'row-id-1') : candidate.type === 'boolean' ? true : candidate.type === 'number' ? 1 : 'x'])));
  return [
    docComment(['入力のスキーマの試験の表(宣言した引数だけを受けること)。']),
    'const SCHEMA_CHECKS = [',
    ...all.ops.map(
      (plan) =>
        `  { id: ${tsString(plan.id)}, schema: ${plan.base}InputSchema, props: ${JSON.stringify(plan.inputs.map((candidate) => candidate.prop))}, rowProps: ${JSON.stringify(plan.inputs.filter((candidate) => candidate.row).map((candidate) => candidate.prop))}, valid: ${valid(plan)} },`,
    ),
    '] as const;',
    '',
  ];
}

/** 入口の関門の順序の試験の表。 */
function entryLines(all: PlatformPlan, input: Input): string[] {
  return [
    docComment(['入口(Server Action)と組み立ての根のファイル(このファイルからの相対)。']),
    'const ENTRIES = [',
    ...all.ops.map(
      (plan) =>
        `  { id: ${tsString(plan.id)}, entryFile: ${tsString(input.entryPath(plan))}, compositionFile: ${tsString(input.compositionPath(plan))}, compose: ${tsString(plan.base)}, mfa: ${String(input.mfa)}, callText: ${tsString(`${plan.base}({ actorId${input.mfa ? ', actorMfa' : ''} }, parsed.data)`)} },`,
    ),
    '] as const;',
    '',
  ];
}
