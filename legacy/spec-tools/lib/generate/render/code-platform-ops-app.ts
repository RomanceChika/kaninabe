/**
 * auth_spec の `platform_ops`(認証基盤の操作を画面から叩く閉じた一覧。ADR-0019)→ **型・入力のスキーマ・Server Action・組み立ての根**(app の実装そのもの)の生成器。
 *
 * 画面が叩く認証基盤の操作(セッションの一覧・終了など)はドメインイベントではないので、実行器(`runPlanOperation`)を通らない。そこで、実行器が担う関門を
 * 入口と組み立ての根が**同じ順序で**持つ —— 順序は固定で、手で書ける場所を残さない(`code-usecase-app.ts` と同じ理由):
 *
 *   1. 要求の出どころの確認 … リクエスト前段(`proxy.ts`)が Server Action を含む全ての状態を変える要求に掛ける(この入口は文書の口の保護範囲の内側)
 *   2. 実行者の解決 … `resolveActorId()` を**パースより先に**(拒否の記録に「誰が」を載せるため。logging.md)。本人の操作のメンバー ID は入力に**取らない**
 *      (入力のスキーマに欄が無く、`z.strictObject` が余剰の鍵を弾く)。配線先がリクエストのセッションから導く
 *   3. 入力のパース … 宣言した引数だけ(行から受ける識別子は長さを抑えた文字列・型つきの入力は型どおり)。識別子の認可は配線先の境界が持つ(UI の出どころは改竄不能の証明ではない)
 *   4. 多要素認証の要求(宣言した製品だけ) … 実行器と同じ判定(`mfaRefusal`)を、配線先を呼ぶ**前**に掛ける
 *   5. 配線先の呼び出し … 宣言した対応表(`binding.params`)どおりに引数を渡す。ロールの操作の資格(有効メンバー × ロール)は配線先がいまの DB の行で確かめる
 *   6. 結果の写し … 宣言した対応表(`shapes`)の欄だけを**明示の射影**で写す(配線先が余分な欄を返しても画面の値に残らない)。失敗の理由は宣言の閉じた集合
 *   7. 拒否の記録 … 拒否は返す前に 1 行記録する(結果は変えない)
 *
 * 出力は 3 つ: 型・スキーマ・表の束(`{生成物の根}/platform-ops.ts`)・Server Action(役割 `platform-op-entry`)・組み立ての根(役割 `platform-op-composition`)。
 * 宣言の無い製品・実装の木を持たない製品は 1 本も出さない。**アプリの語彙を 1 語も持たない**(W1)。規約どおりファイル I/O はせず、純粋関数である。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { docComment, generatedFile, generatedHeader, toCamelCase, tsString } from '../../gen-kit/code-emit.js';
import { enforcedMfaScope, MFA_GUARD_MODULE, MFA_RESOLVER } from '../../model/auth/mfa.js';
import type { MfaScope } from '../../model/auth/mfa.js';
import { bodyModulesOf } from '../body-modules.js';
import { appPlacedPath } from './app-placement.js';
import { buildPlatformPlan, callArguments, projectionLines, tsTypeOf } from './platform-ops-plan.js';
import type { PlatformOpPlan, PlatformPlan, PlatformShapePlan } from './platform-ops-plan.js';
import { RUNTIME_FORM_MODULE, RUNTIME_PLATFORM_OP_MODULE, RUNTIME_RESULT_MODULE } from './runtime-modules.js';
import { REFUSAL_LOG_EXPORTS, actionHeadLines, guardedLines } from './refusal-log-entry.js';

/** 型・スキーマ・表の束のファイル名(生成物の根の下)。 */
export const PLATFORM_OPS_MODULE = 'platform-ops';

/**
 * 全ての `platform_ops` から型・スキーマ・Server Action・組み立ての根を生成するジェネレーター。
 * 宣言の無い製品・実装の木を持たない製品は何も出さない。
 */
export const platformOpsAppGenerator: DocGenerator = {
  id: 'code-platform-ops-app',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const plan = buildPlatformPlan(ctx.auth);
    const flow = ctx.auth?.flow;
    if (ctx.roots.app === null || plan.ops.length === 0 || flow === undefined || flow === null) return [];
    const mfa = enforcedMfaScope(flow.mfa);
    const location = flow.location;
    const modules = bodyModulesOf(ctx, { what: '認証基盤の操作の入口と組み立ての根', location });
    return [
      { file: generatedFile(ctx.roots, `${PLATFORM_OPS_MODULE}.ts`), content: renderTypes(plan, location.file), wholeFile: true },
      ...plan.ops.flatMap((op): GeneratedSection[] => [
        {
          file: appPlacedPath(ctx.layout, ctx.roots, { role: 'platform-op-entry', key: op.id, what: `認証基盤の操作 ${op.id} の Server Action`, location }),
          content: renderEntry(op, location.file, modules, mfa),
          wholeFile: true,
        },
        {
          file: appPlacedPath(ctx.layout, ctx.roots, { role: 'platform-op-composition', key: op.id, what: `認証基盤の操作 ${op.id} の組み立ての根`, location }),
          content: renderComposition(op, location.file, modules, mfa),
          wholeFile: true,
        },
      ]),
    ];
  },
};

/** 型・スキーマ・表の束。 */
function renderTypes(plan: PlatformPlan, specFile: string): string {
  return [
    generatedHeader([specFile]),
    '',
    "import { z } from 'zod';",
    '',
    docComment(['認証基盤の操作(`platform_ops`)の ID。画面の `platform_op.{id}.success` の id と同じ。']),
    `export const platformOpIds = [${plan.ops.map((op) => tsString(op.id)).join(', ')}] as const;`,
    '',
    'export type PlatformOpId = (typeof platformOpIds)[number];',
    '',
    docComment(['操作の表示名。']),
    'export const platformOpLabels = {',
    ...plan.ops.map((op) => `  ${tsString(op.id)}: ${tsString(op.op.label)},`),
    '} as const satisfies Readonly<Record<PlatformOpId, string>>;',
    '',
    docComment(['確認が要る操作か(`confirm: true`。画面は確認の器を経て実行する)。']),
    'export const platformOpConfirm = {',
    ...plan.ops.map((op) => `  ${tsString(op.id)}: ${String(op.op.confirm === true)},`),
    '} as const satisfies Readonly<Record<PlatformOpId, boolean>>;',
    '',
    ...plan.ports.flatMap((port) => [
      docComment([`ポート ${port.name} が返す失敗の理由 → 画面に出す文言(閉じた集合。理由の語そのものは画面に出さない)。`]),
      `export const ${refusalsName(port.name)} = {`,
      ...port.refusals.map((refusal) => `  ${tsString(refusal.reason)}: ${tsString(refusal.message)},`),
      '} as const;',
      '',
    ]),
    docComment(['操作ごとの失敗の理由 → 文言の表(配線先のポートの宣言)。']),
    'export const platformOpRefusals = {',
    ...plan.ops.map((op) => `  ${tsString(op.id)}: ${refusalsName(op.port.name)},`),
    '} as const satisfies Readonly<Record<PlatformOpId, Readonly<Record<string, string>>>>;',
    '',
    ...plan.shapes.flatMap(renderShape),
    ...plan.ops.flatMap(renderInput),
  ].join('\n');
}

/** ポートの失敗の理由の表の名前。 */
function refusalsName(port: string): string {
  return `${port.charAt(0).toLowerCase()}${port.slice(1)}Refusals`;
}

/** 返す欄の集合 1 つ(画面の行の型と、欄の表)。 */
function renderShape(shape: PlatformShapePlan): string[] {
  return [
    docComment([`${shape.name} の行(画面が受ける値)。宣言した欄だけを持つ —— 配線先の行の余分な欄は写らない。`]),
    `export interface ${shape.typeName} {`,
    ...shape.fields.map((field) => `  readonly ${field.prop}: ${tsTypeOf(field.type, field.nullable)};`),
    '}',
    '',
    docComment([`${shape.name} の欄の表(宣言順。欄 → 行のプロパティ → 配線先の行のプロパティ。生成テストと画面の部品が読む)。`]),
    `export const ${toCamelCase(shape.name)}Fields = [`,
    ...shape.fields.map(
      (field) =>
        `  { field: ${tsString(field.field)}, prop: ${tsString(field.prop)}, from: ${tsString(field.from)}, type: ${tsString(field.type)}, nullable: ${String(field.nullable)}, label: ${tsString(field.label)}, format: ${tsString(field.format)} },`,
    ),
    '] as const;',
    '',
  ];
}

/** 入力のスキーマと型。 */
function renderInput(plan: PlatformOpPlan): string[] {
  return [
    docComment([
      `${plan.id} の入力のスキーマ(${plan.op.label})。`,
      '宣言した引数だけを持ち、余剰の鍵は弾く(`z.strictObject`。入力の境界の閉世界 = layer/no-raw-zod-string の closedObjects)。本人の操作にメンバー ID の欄は無い —— 配線先がリクエストのセッションから導く。',
    ]),
    `export const ${plan.base}InputSchema = z.strictObject({`,
    ...plan.inputs.map((input) => `  ${input.prop}: ${input.zod},`),
    '});',
    '',
    `export type ${plan.pascal}Input = z.infer<typeof ${plan.base}InputSchema>;`,
    '',
  ];
}

/** 失敗の拒否を記録する行の import(接続点)。 */
function authImports(mfa: MfaScope | null): string {
  return [...new Set([...REFUSAL_LOG_EXPORTS, 'resolveActorId', 'resolveRequestId', ...(mfa === null ? [] : [MFA_RESOLVER])])].sort().join(', ');
}

/** Server Action(入口)。 */
function renderEntry(plan: PlatformOpPlan, specFile: string, modules: ReturnType<typeof bodyModulesOf>, mfa: MfaScope | null): string {
  const composition = modules.platformComposition(plan.id);
  const operation = tsString(plan.id);
  return [
    "'use server';",
    '',
    generatedHeader([specFile]),
    '',
    `import { toFieldIssues } from '${RUNTIME_FORM_MODULE}';`,
    `import { ${plan.base}InputSchema } from '${modules.generated(PLATFORM_OPS_MODULE)}';`,
    ...(plan.shape === undefined ? [] : [`import type { ${plan.shape.typeName} } from '${modules.generated(PLATFORM_OPS_MODULE)}';`]),
    `import type { PlatformOpResult } from '${RUNTIME_PLATFORM_OP_MODULE}';`,
    `import { refusalAsActionError } from '${RUNTIME_PLATFORM_OP_MODULE}';`,
    `import { err } from '${RUNTIME_RESULT_MODULE}';`,
    `import { ${authImports(mfa)} } from '${modules.auth()}';`,
    `import { ${plan.base} } from '${composition}';`,
    '',
    docComment([
      `${plan.op.label} —— 認証基盤の操作 ${plan.id} の Server Action。`,
      '',
      `仕様: ${specFile}(platform_ops ${plan.id})`,
      '',
      'この層が担うのは実行者の解決・入力のパース・結果の返却・拒否の記録だけで、権限や条件を判定する `if` は無い。',
      '実行者はパースより先に解く(logging.md)。本人の操作のメンバー ID は入力に取らない(配線先がセッションから導く)。',
      '要求の出どころの確認はリクエスト前段が掛ける。',
      '',
      '@param input 入力(形の正は生成の入力のスキーマ。余剰の鍵は弾く)',
      '@returns 成功なら値、拒否なら入力の検証・多要素認証・配線先の理由のどれか',
    ]),
    `export async function ${plan.base}Action(input: unknown): Promise<PlatformOpResult<${plan.outputType}>> {`,
    ...actionHeadLines(plan.base),
    `  const parsed = ${plan.base}InputSchema.safeParse(input ?? {});`,
    '  if (!parsed.success) {',
    "    const refusal = { kind: 'invalid_input', issues: toFieldIssues(parsed.error) } as const;",
    `    recordActionRefusal(entry, err(refusalAsActionError(${operation}, refusal)));`,
    '    return { ok: false, refusal };',
    '  }',
    // 多要素認証の解決と配線先の呼び出しも、投げたら 1 行記録してから投げ直す(点検 21 回目 B21-4。包みの本体は refusal-log-entry.ts)。
    ...(mfa === null ? [] : guardedLines('actorMfa', `${MFA_RESOLVER}()`)),
    ...guardedLines('result', `${plan.base}({ actorId${mfa === null ? '' : ', actorMfa'} }, parsed.data)`),
    `  if (!result.ok) recordActionRefusal(entry, err(refusalAsActionError(${operation}, result.refusal)));`,
    '  return result;',
    '}',
    '',
  ].join('\n');
}

/** 多要素認証の判定の行(宣言した製品だけ)。 */
function mfaLines(plan: PlatformOpPlan, mfa: MfaScope | null): readonly string[] {
  if (mfa === null) return [];
  const roles = plan.op.actor.kind === 'role' ? `[${tsString(plan.op.actor.role)}]` : 'null';
  return [
    '  // 多要素認証の要求(auth_spec の mfa)。実行器と同じ判定を、配線先を呼ぶ前に 1 回だけ掛ける。',
    `  if (mfaRefusal(runtimeBindings.mfa, { actorId: actor.actorId, actorMfa: actor.actorMfa, system: false }, ${roles}, '', ${tsString(plan.id)}) !== null) return platformMfaRequired();`,
  ];
}

/** 組み立ての根。 */
function renderComposition(plan: PlatformOpPlan, specFile: string, modules: ReturnType<typeof bodyModulesOf>, mfa: MfaScope | null): string {
  const binding = modules.platformBinding(plan.port.name);
  const { union } = plan.port;
  const args = callArguments(plan).join(', ');
  const call = `port.${plan.op.binding.method}(${args})`;
  const value = plan.shape === undefined ? `result.${union.value}` : null;
  const success =
    plan.shape === undefined
      ? [`  return platformOk(${value ?? ''});`]
      : [
          `  return platformOk(`,
          `    result.${union.value}.map((row): ${plan.shape.typeName} => ({`,
          ...projectionLines(plan.shape, '      '),
          '    })),',
          '  );',
        ];
  return [
    generatedHeader([specFile]),
    '',
    "import 'server-only';",
    ...(plan.shape === undefined ? [] : [`import type { ${plan.shape.typeName} } from '${modules.generated(PLATFORM_OPS_MODULE)}';`]),
    `import { ${refusalsName(plan.port.name)} } from '${modules.generated(PLATFORM_OPS_MODULE)}';`,
    `import type { ${plan.pascal}Input } from '${modules.generated(PLATFORM_OPS_MODULE)}';`,
    ...(mfa === null ? [] : [`import { runtimeBindings } from '${modules.generated('runtime-bindings')}';`, `import { mfaRefusal } from '${MFA_GUARD_MODULE}';`]),
    `import type { PlatformActorFacts, PlatformOpResult } from '${RUNTIME_PLATFORM_OP_MODULE}';`,
    `import { ${['platformOk', 'platformRefusedWithin', ...(mfa === null ? [] : ['platformMfaRequired'])].sort().join(', ')} } from '${RUNTIME_PLATFORM_OP_MODULE}';`,
    `import type { ${plan.port.name} } from '${binding}';`,
    `import { ${plan.portFactory} } from '${binding}';`,
    '',
    docComment([
      `${plan.op.label} の組み立ての根(認証基盤の操作 ${plan.id})。`,
      '',
      `仕様: ${specFile}(platform_ops ${plan.id})`,
      '',
      `配線先は \`${plan.port.name}.${plan.op.binding.method}\`。宣言した対応表どおりに引数を渡し、結果は宣言した欄だけを写す。`,
      '失敗の理由は配線先の宣言の閉じた集合で、申告の中ならそのまま拒否として返す。申告の外の理由は固定の一般の理由に落とす(生の理由を返り値に残さない)。',
      '',
      '@param actor 実行者の側の事実(メンバー ID は拒否の記録に使う。認可は配線先がセッションから導く)',
      '@param input 入力(生成の入力のスキーマで検証済み)',
      '@param port 配線先(省略は本番の配線を要求ごとに作る。テストが差し替える)',
      '@returns 成功なら値、拒否なら多要素認証か配線先の理由',
    ]),
    `export async function ${plan.base}(${mfa === null ? '_actor' : 'actor'}: PlatformActorFacts, ${callArguments(plan).length === 0 ? '_input' : 'input'}: ${plan.pascal}Input, port: ${plan.port.name} = ${plan.portFactory}()): Promise<PlatformOpResult<${plan.outputType}>> {`,
    ...mfaLines(plan, mfa),
    `  const result = await ${call};`,
    `  if (!result.${union.ok}) return platformRefusedWithin(result.${union.reason}, ${refusalsName(plan.port.name)});`,
    ...success,
    '}',
    '',
  ].join('\n');
}
