/**
 * world と組み合わせの設計図 → **engine ⇔ RPC の一致の証明**
 * (`app/src/infrastructure/__tests__/generated/equivalence/**`)の生成器(束 ⑳-5a)。
 *
 * 仕様: ADR-0012 ⑤(DB を権威にする)/ 束 ⑳-5 設計 §1
 *
 * ## なぜ生成するのか
 *
 * ⑳-3 で RPC の本文が `by` とガードと期待状態を守るようになった。その本文と TS の engine は
 * **同じ仕様からの 2 つの写し**であり、食い違えばどちらかがバグである。⑳-3b はそれを `entry` の
 * 3 操作(作成・遷移・編集)で差分テストしたが、残る全操作には「同じ生成器から出ている」以上の
 * 証拠が無かった —— 生成器の写し間違いは、生成物どうしを比べても見つからない。
 *
 * だから**実 DB で実行する**。期待は engine(`canFire` / `canCreate` / `canWrite` / `canDelete`)が
 * 出し、実測は RPC の errcode が出す。写像は `refusal-codes.ts` の 1 表だけである。
 *
 * ## 生成されるテストの中身
 *
 * 1 集約につき、操作ごとに 1 本 + world が設計図どおりに作られたことの 1 本。**world の作り方も
 * 期待の出し方も生成しない** —— 仕組み側に 1 回だけ手で書いてあり(`@kaninabe/runtime/testing/equivalence/world` /
 * `equivalence/expect`)、生成テストは設計図と操作 ID を渡すだけである。
 *
 * 操作 1 本の中で全組み合わせを実行するのは、**食い違いを全部並べるため**である(最初の 1 件で
 * 落ちると、直しては実行し直す往復が組み合わせの数だけ要る)。組み合わせが 0 件になった日に
 * 黙って緑になる形を避けるため、実行する側はループの外で件数を確かめる(A16)。
 *
 * 規約どおりファイル I/O はしない純粋関数(scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import { blockCommentText } from '../../kernel/safe-text.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { eqCatalog, eqTestCaseIdOf, type EqCatalogEntry } from '../../world/index.js';
import { findAccessSpec } from '../../semantics/domain-lookup.js';
import { EQ_TEST_WORDS } from '../../messages/messages-eq.js';
import { tsString } from '../../gen-kit/code-emit.js';
import { eqTestPlacerOf } from './test-placement.js';
import { bodyModulesOf } from '../body-modules.js';
import type { BodyModules } from '../body-modules.js';
import { TEST_TO_ADAPTER_DIR } from '../../model/product/layout-body-imports.js';

/** 生成テストが仕組み側の口を引く相対パス(`__tests__/generated/equivalence/` から 2 段上。契約は `layout-body-imports.ts`)。 */
const HARNESS = TEST_TO_ADAPTER_DIR;

/** 1 操作ぶんの持ち時間(ミリ秒)。全組み合わせを 1 本の中で実行するので既定では収まらない。 */
const TIMEOUT_MS = 600_000;

/** テスト 1 本ぶんの宣言(生成テストと data_table の `test_cases` が同じ導出を共有する)。 */
export interface EqTestCase {
  /** 1 始まりの番号(テストケース ID になる)。 */
  readonly index: number;
  readonly title: string;
  /** テスト本体の 1 行。 */
  readonly body: string;
  /** 実 DB を読まない検算か(`it` を同期にする)。 */
  readonly sync: boolean;
}

/** 集約 1 枚ぶんの生成テストの宣言。 */
export interface EqTestSuite {
  readonly aggregate: string;
  /** 注釈の `spec_ids` に載せる仕様 ID。 */
  readonly specId: string;
  /** 正になる仕様ファイル。 */
  readonly specFile: string;
  readonly cases: readonly EqTestCase[];
}

/**
 * world を作れた全集約について、生成テストの宣言を組み立てる。
 *
 * @param model ドメイン仕様
 * @param ctx 生成の文脈(ガード解析・action_spec・data_table・ジョブカタログ)
 * @returns 集約名順の宣言
 */
export function eqTestSuites(model: SpecModel, ctx: GenerateContext): readonly EqTestSuite[] {
  return eqCatalog({
    domain: model,
    guards: ctx.guards,
    actions: ctx.actions,
    dataTables: ctx.dataTables,
    jobs: ctx.jobs,
  }).flatMap((entry) => (entry.result.ok ? [suiteOf(model, entry)] : []));
}

/** 全集約の設計図から一致の証明を生成するジェネレーター。 */
export const equivalenceTestsGenerator: DocGenerator = {
  id: 'code-equivalence-tests',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const place = eqTestPlacerOf(ctx);
    if (place === null) return [];
    return eqTestSuites(model, ctx).map((suite) => ({
      file: place(suite.aggregate),
      content: renderTestFile(suite, bodyModulesOf(ctx, { what: `集約 ${suite.aggregate} の一致の証明`, location: { file: suite.specFile } })),
      wholeFile: true,
    }));
  },
};

/** 集約 1 つぶんの宣言。 */
function suiteOf(model: SpecModel, entry: EqCatalogEntry): EqTestSuite {
  const access = findAccessSpec(model, entry.aggregate);
  const operations = entry.result.ok ? entry.result.operations : [];
  const cases: EqTestCase[] = operations.map((operation, index) => ({
    index: index + 1,
    title: EQ_TEST_WORDS.operationTitle({
      op: operation.op,
      count: operation.count,
      folded: operation.folded,
      guards: operation.foldedGuards.map((guard) => EQ_TEST_WORDS.foldedGuard(guard)),
    }),
    body: `await expectSameDecisions(WORLD, built, ${tsString(operation.op)});`,
    sync: false,
  }));
  return {
    aggregate: entry.aggregate,
    specId: access?.id ?? entry.table?.id ?? entry.aggregate,
    specFile: entry.table?.location.file ?? '',
    cases: [
      ...cases,
      {
        index: cases.length + 1,
        title: EQ_TEST_WORDS.worldBuilt(entry.aggregate),
        body: 'expectWorldBuilt(WORLD, built);',
        sync: true,
      },
      // 作成ごとの送り直しの性質(点検 20 回目 B20-1)。既存の番号を動かさないよう末尾に足す。性質は表の resend の宣言で分かれる:
      // 既存の行を返す表(returns_existing: true)は「2 回目は 1 回目の行を返す」、返さない表は「2 回目は行を増やさず、画面は
      // 『既に保存されている』の文言」(以前は返さない表にも前者を当て、約束どおりの UC409 を赤と読んでいた)。
      ...operations
        .filter((operation) => operation.kind === 'create')
        .map((operation, index) => {
          const returns = entry.table?.resend?.returnsExisting === true;
          return {
            index: cases.length + 2 + index,
            title: returns ? EQ_TEST_WORDS.resendTitle(operation.op) : EQ_TEST_WORDS.resendAlreadySavedTitle(operation.op),
            body: `await ${returns ? 'expectResendReturnsSameRow' : 'expectResendAlreadySaved'}(WORLD, built, ${tsString(operation.op)});`,
            sync: false,
          };
        }),
    ],
  };
}

/** テストファイル 1 本。 */
function renderTestFile(suite: EqTestSuite, modules: BodyModules): string {
  return [
    generatedTestHeader(suite),
    '',
    "import { afterAll, beforeAll, describe, it } from 'vitest';",
    `import { eqWorlds } from '${modules.generated('eq-worlds')}';`,
    `import type { BuiltEqWorld } from '${HARNESS}/eq-world';`,
    `import { createEqWorld, resetEqWorld } from '${HARNESS}/eq-world';`,
    `import { ${expectsOf(suite).join(', ')} } from '${HARNESS}/eq-expect';`,
    '',
    '/** この集約の world と組み合わせの設計図(生成物)。行の値も実行する順もここが正である。 */',
    `const WORLD = eqWorlds.${suite.aggregate};`,
    '',
    '/** 実 DB に作った world(id は挿入のたびに変わるので、設計図の名前から引く)。 */',
    'let built: BuiltEqWorld;',
    '',
    'beforeAll(async () => {',
    '  built = await createEqWorld(WORLD);',
    '});',
    '',
    'afterAll(async () => {',
    '  await resetEqWorld();',
    '});',
    '',
    `describe(${tsString(EQ_TEST_WORDS.suite(suite.aggregate))}, () => {`,
    ...suite.cases.flatMap((entry) => renderCase(suite, entry)).slice(0, -1),
    '});',
    '',
  ].join('\n');
}

/** その束が使う表明の口(使わない口を import すると未使用で lint に落ちる)。 */
function expectsOf(suite: EqTestSuite): readonly string[] {
  const names = new Set<string>();
  for (const entry of suite.cases) {
    const found = /^(?:await )?(expect[A-Za-z]+)\(/u.exec(entry.body)?.[1];
    if (found !== undefined) names.add(found);
  }
  return [...names].sort();
}

/** テスト 1 本(`it()`)。 */
function renderCase(suite: EqTestSuite, entry: EqTestCase): readonly string[] {
  const close = entry.sync ? '  });' : `  }, ${TIMEOUT_MS.toLocaleString('en-US').split(',').join('_')});`;
  return [
    `  // @spec ${suite.specId} @tc ${eqTestCaseIdOf(suite.aggregate, entry.index)}`,
    `  it(${tsString(entry.title)}, ${entry.sync ? '() => {' : 'async () => {'}`,
    `    ${entry.body}`,
    close,
    '',
  ];
}

/** 生成テストのヘッダ(正の仕様と、このテストが何を言えるか)。 */
function generatedTestHeader(suite: EqTestSuite): string {
  return [
    '/**',
    ' * AUTO-GENERATED by `npm run generate` — 手編集禁止。',
    ' *',
    ' * このファイルの正は次の仕様であり、ここはその機械的な写像にすぎない。',
    ' * 変更するときは仕様を編集してから再生成すること(ADR-0006)。',
    ` *   - ${blockCommentText(suite.specFile)}`,
    ' *',
    ` * ${suite.aggregate} の操作を**全組み合わせ**で実 DB で実行し、TS の engine の判定と`,
    ' * RPC の結末(errcode の 3 分類 / 成功)が一致することを確かめる(束 ⑳-5a)。',
    ' * 期待は engine が出す —— RPC の述語を組み立てる翻訳器(`lib/sql/rpc-authz.ts`)とは',
    ' * 独立の写像であり、食い違えばどちらかがバグである(意味の正は仕様にある)。',
    ' */',
  ].join('\n');
}
