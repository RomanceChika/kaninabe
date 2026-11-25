/**
 * world の設計図 → **RLS の挙動テスト**(`app/src/infrastructure/__tests__/generated/rls/**`)の
 * 生成器(束 ⑳-4b)。
 *
 * 仕様: ADR-0012 ⑤(RLS の SQL を仕様から生成し、DB を権威にする)/ 束 ⑳-4 設計 §5
 *
 * ## なぜ挙動まで実行するのか
 *
 * ⑳-4a は「ポリシーの本文が生成物であり、実 DB と意味で一致する」ところまでを閉じた。残るのは
 * **その生成物が宣言どおりの行集合を返すか**である —— 述語の翻訳が間違っていれば、生成物と実 DB は
 * 仲良く同じ間違いをするので、突合はいくらやっても緑のままになる。だから行を置いて実行する。
 *
 * 期待(見えるべき id)を出すのは実行する側の TS(`@kaninabe/runtime/testing/rls/oracle`)であり、SQL を組み立てる
 * 翻訳器を呼ばない**別の写像**である。食い違えばどちらかがバグであり、意味の正は仕様にある。
 *
 * ## 生成されるテストの中身
 *
 * 1 表につき、実行者(ロール)ごとに 1 本 + 境界(`filters`)の欄ごとに 1 本 + world が設計図
 * どおりに作られたことの 1 本。**world の作り方とオラクルは生成しない** —— 仕組み側に 1 回だけ
 * 手で書いてあり(`@kaninabe/runtime/testing/rls/world` / `rls/oracle`)、生成テストは設計図を渡すだけである。
 *
 * 規約どおりファイル I/O はしない純粋関数(scripts-code-quality.md)。
 */

import type { RoleDef, SpecModel } from '../../model/types.js';
import { blockCommentText } from '../../kernel/safe-text.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { globalRoleId, impliedRoles } from '../../model/role-hierarchy.js';
import { rlsTestCaseIdOf, rlsWorldCatalog, type RlsWorld, type RlsWorldActor } from '../../world/index.js';
import { findAccessSpec } from '../../semantics/domain-lookup.js';
import { RLS_TEST_WORDS, tenantCanaryTestName } from '../../messages/messages-rls.js';
import { tsString } from '../../gen-kit/code-emit.js';
import { rlsTestPlacerOf } from './test-placement.js';
import { bodyModulesOf } from '../body-modules.js';
import type { BodyModules } from '../body-modules.js';
import { TEST_TO_ADAPTER_DIR } from '../../model/product/layout-body-imports.js';

/** 生成テストが仕組み側の口を引く相対パス(`__tests__/generated/rls/` から 2 段上。契約は `layout-body-imports.ts`)。 */
const HARNESS = TEST_TO_ADAPTER_DIR;

/** テスト 1 本ぶんの宣言(生成テストと data_table の `test_cases` が同じ導出を共有する)。 */
export interface RlsTestCase {
  /** 1 始まりの番号(テストケース ID になる)。 */
  readonly index: number;
  readonly title: string;
  /** テスト本体の 1 行。 */
  readonly body: string;
  /** 実 DB を読まない検算か(`it` を同期にする)。 */
  readonly sync: boolean;
  /**
   * テストケースの分類。**「返らないこと」を確かめる検査は `forbidden` である** ——
   * 権限が無くて拒否される実行者・宣言の上で 1 行も通らない実行者・境界の外の行が
   * 返らないことの見張りテストは、成功経路の確認ではない(guarantees.md の分類と同じ目)。
   */
  readonly covers: 'success' | 'forbidden';
}

/** 表 1 枚ぶんの生成テストの宣言。 */
export interface RlsTestSuite {
  readonly table: string;
  /** 注釈の `spec_ids` に載せる仕様 ID。 */
  readonly specId: string;
  readonly cases: readonly RlsTestCase[];
}

/**
 * world を作れた全表について、生成テストの宣言を組み立てる。
 *
 * @param model ドメイン仕様
 * @param ctx 生成の文脈(data_table)
 * @returns 表名順の宣言
 */
export function rlsTestSuites(model: SpecModel, ctx: GenerateContext): readonly RlsTestSuite[] {
  return rlsWorldCatalog(model, ctx.dataTables).flatMap((entry) => {
    if (!entry.result.ok) return [];
    const access = findAccessSpec(model, entry.table.entity ?? '');
    return [
      {
        table: entry.table.table,
        specId: access?.id ?? entry.table.id,
        cases: casesOf(entry.result.world, model.roles.roles),
      },
    ];
  });
}

/** 全 data_table の world から挙動テストを生成するジェネレーター。 */
export const rlsBehaviourTestsGenerator: DocGenerator = {
  id: 'code-rls-behaviour-tests',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const place = rlsTestPlacerOf(ctx);
    if (place === null) return [];
    const catalog = rlsWorldCatalog(model, ctx.dataTables);
    const suites = new Map(rlsTestSuites(model, ctx).map((suite) => [suite.table, suite]));
    return catalog.flatMap((entry) => {
      const suite = suites.get(entry.table.table);
      if (!entry.result.ok || suite === undefined) return [];
      return [
        {
          file: place(entry.table.table),
          content: renderTestFile(suite, entry.table.location.file, bodyModulesOf(ctx, { what: `表 ${entry.table.table} の RLS の挙動テスト`, location: entry.table.location })),
          wholeFile: true,
        },
      ];
    });
  },
};

/** その world で実行するテストの並び(ロールごと → 境界の欄ごと → world の検算)。 */
function casesOf(world: RlsWorld, roles: readonly RoleDef[]): readonly RlsTestCase[] {
  const titles: readonly Omit<RlsTestCase, 'index'>[] = [
    ...world.actors.map((actor) => ({
      title: titleOf(world, actor),
      body: `await expectVisibleRows(WORLD, built, ${tsString(actor.key)});`,
      sync: false,
      // 行の条件を満たさない人は、条件を持つロールでは読めない側に数える(読めるのは条件を持たないロールだけ)。
      covers: actor.unmet === undefined && seesRows(world, actor, roles) ? ('success' as const) : ('forbidden' as const),
    })),
    ...boundaryFields(world).map((field) => ({
      title: tenantCanaryTestName(world.table, field),
      body: `await expectTenantBoundary(WORLD, built, ${tsString(field)});`,
      sync: false,
      covers: 'forbidden' as const,
    })),
    {
      title: RLS_TEST_WORDS.worldBuilt(world.table),
      body: 'expectWorldBuilt(WORLD, built);',
      sync: true,
      covers: 'success' as const,
    },
  ];
  return titles.map((entry, index) => ({ ...entry, index: index + 1 }));
}

/**
 * 実行者 1 人ぶんのテスト名。
 *
 * 3 種を名前で区別する —— 同じロールの 2 人目に同じ名前を付けると、テストケースの宣言 2 件が同じテストを
 * 指すことになる。「行が無い人」は未ログインと同じロールでもなく、行を持つ人とも別である。
 */
function titleOf(world: RlsWorld, actor: RlsWorldActor): string {
  if (actor.unmet !== undefined) return RLS_TEST_WORDS.byUnmetCondition(world.table, actor.role, actor.unmet);
  if (actor.anonymous || actor.key === actor.role) return RLS_TEST_WORDS.byRole(world.table, actor.role);
  if (actor.row === null) return RLS_TEST_WORDS.byActorWithoutRow(world.table, world.actorTable);
  return RLS_TEST_WORDS.byOtherTenant(world.table, actor.role);
}

/**
 * その実行者に、宣言の上で通る読み取り規則が 1 つでもあるか(テストケースの分類の根拠)。
 *
 * 立つロールは「その人が代表する役 + 既定のログインロール」と、その `implies` の閉包である。
 * **実行者の集約に行が無い人はどのロールも立たない** —— 既定のログインロールの根拠がその行で
 * あり、束縛の根拠も対象の行との関係だからである。
 */
function seesRows(world: RlsWorld, actor: RlsWorldActor, roles: readonly RoleDef[]): boolean {
  const held = heldRoles(actor, roles);
  return world.reads.some((rule) => rule.scope !== 'none' && held.has(rule.by));
}

/** その実行者が対象に依らず立てるロール(自分の系統の行では束縛の役も立つ)。 */
function heldRoles(actor: RlsWorldActor, roles: readonly RoleDef[]): ReadonlySet<string> {
  if (actor.row === null && !actor.anonymous) return new Set<string>();
  const authenticated = globalRoleId(roles, 'authenticated_default');
  const seeds = actor.anonymous
    ? [actor.role]
    : [actor.role, ...(authenticated === undefined ? [] : [authenticated])];
  const found = new Set<string>(seeds);
  for (const seed of seeds) {
    for (const implied of impliedRoles(roles, seed)) found.add(implied);
  }
  return found;
}

/** 境界(`filters`)が使う実行者の欄(宣言順・重複なし)。 */
function boundaryFields(world: RlsWorld): readonly string[] {
  const found: string[] = [];
  for (const rule of world.reads) {
    for (const filter of rule.filters) {
      if (!found.includes(filter.actorField)) found.push(filter.actorField);
    }
  }
  return found;
}

/** テストファイル 1 本。 */
function renderTestFile(suite: RlsTestSuite, specFile: string, modules: BodyModules): string {
  return [
    generatedTestHeader(specFile, suite.table),
    '',
    "import { afterAll, beforeAll, describe, it } from 'vitest';",
    `import { rlsWorlds } from '${modules.generated('rls-worlds')}';`,
    `import type { BuiltRlsWorld } from '${HARNESS}/rls-world';`,
    `import { createRlsWorld, resetRlsWorld } from '${HARNESS}/rls-world';`,
    `import { ${expectsOf(suite).join(', ')} } from '${HARNESS}/rls-expect';`,
    '',
    '/** この表の world の設計図(生成物)。行の値もロールの根拠もここが正である。 */',
    `const WORLD = rlsWorlds.${suite.table};`,
    '',
    '/** 実 DB に作った world(id は挿入のたびに変わるので、設計図の名前から引く)。 */',
    'let built: BuiltRlsWorld;',
    '',
    'beforeAll(async () => {',
    '  built = await createRlsWorld(WORLD);',
    '});',
    '',
    'afterAll(async () => {',
    '  await resetRlsWorld();',
    '});',
    '',
    `describe(${tsString(RLS_TEST_WORDS.suite(suite.table))}, () => {`,
    ...suite.cases.flatMap((entry) => renderCase(suite, entry)).slice(0, -1),
    '});',
    '',
  ].join('\n');
}

/** その束が使う表明の口(使わない口を import すると未使用で lint に落ちる)。 */
function expectsOf(suite: RlsTestSuite): readonly string[] {
  const names = new Set<string>();
  for (const entry of suite.cases) {
    const found = /^(?:await )?(expect[A-Za-z]+)\(/u.exec(entry.body)?.[1];
    if (found !== undefined) names.add(found);
  }
  return [...names].sort();
}

/** テスト 1 本(`it()`)。 */
function renderCase(suite: RlsTestSuite, entry: RlsTestCase): readonly string[] {
  return [
    `  // @spec ${suite.specId} @tc ${rlsTestCaseIdOf(suite.table, entry.index)}`,
    `  it(${tsString(entry.title)}, ${entry.sync ? '() => {' : 'async () => {'}`,
    `    ${entry.body}`,
    '  });',
    '',
  ];
}

/** 生成テストのヘッダ(正の仕様と、このテストが何を言えるか)。 */
function generatedTestHeader(specFile: string, table: string): string {
  return [
    '/**',
    ' * AUTO-GENERATED by `npm run generate` — 手編集禁止。',
    ' *',
    ' * このファイルの正は次の仕様であり、ここはその機械的な写像にすぎない。',
    ' * 変更するときは仕様を編集してから再生成すること(ADR-0006)。',
    ` *   - ${blockCommentText(specFile)}`,
    ' *',
    ` * ${table} の RLS が**宣言どおりの行集合を返す**ことを実 DB で確かめる(束 ⑳-4b)。`,
    ' * 期待はオラクル(`@kaninabe/runtime/testing/rls/oracle`)が仕様の宣言から計算する —— ポリシーの SQL を組み立てる',
    ' * 翻訳器(`lib/sql/rls-predicate.ts`)とは独立の写像であり、食い違えばどちらかがバグである。',
    ' */',
  ].join('\n');
}
