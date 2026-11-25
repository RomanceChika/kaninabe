/**
 * 保存点の world と組み合わせの設計図 → **保存点の一致の証明**
 * (`app/src/composition/__tests__/generated/equivalence/{ユースケース}.uc.eq.test.ts`)の
 * 生成器(束 ⑳-5a2)。
 *
 * 置き場が配線の層なのは層境界の帰結である —— 期待は実行器(operation)が出し、実測は実 DB
 * (infrastructure)を実行する。その 2 つを同じテストで使えるのは配線の層だけである。
 *
 * 仕様: ADR-0011 §4(1 保存 = 1 トランザクション)/ ADR-0012 ⑤(DB を権威にする)
 *
 * ## 単発の操作の証明との違い
 *
 * ⑳-5a は単発の操作 40 本について「engine の 1 回の照会」と「定型 RPC の errcode」を突き合わせた。
 * 保存点は手順が複数あるので、突合は**1 段強くなる** —— 複合 RPC が返す errcode の本文には
 * **落ちた手順の操作 ID** が載る(`usecase_forbidden:{op}`)ので、「どの手順で落ちたか」まで
 * 一致を要求できる。期待は実行器の `decideStep` を手順の順に回して得た「最初に落ちた手順と
 * その理由」である —— **第 3 の判定器は置かない**(engine と実行器が正)。
 *
 * 1 ユースケース 1 ファイル・保存点ごとに 1 節(`describe`)であり、節ごとに world を作り直す。
 * 節の中は 3 本 —— 判定の全列挙・書き込み経路の全列挙・world の検算である。再送で既存の行を返す保存点(複合の作成)には
 * 4 本目として、同じ鍵で入力を 1 欄変えた押し直しが `resend_input_mismatch` で断られることを足す(点検 21 回目 A21-1)。
 *
 * 規約どおりファイル I/O はしない純粋関数(scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import { blockCommentText } from '../../kernel/safe-text.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { type EqSaveCatalogEntry, eqSaveCatalog, eqSaveTestCaseIdOf } from '../../world/index.js';
import { EQ_TEST_WORDS } from '../../messages/messages-eq.js';
import { tsString } from '../../gen-kit/code-emit.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import { eqSaveTestPlacerOf } from './test-placement.js';
import { bodyModulesOf } from '../body-modules.js';
import type { BodyModules } from '../body-modules.js';
import { TEST_TO_ADAPTER_DIR } from '../../model/product/layout-body-imports.js';

/** 生成テストがハーネスを引く相対パス(`__tests__/generated/equivalence/` から 2 段上。契約は `layout-body-imports.ts`)。 */
const HARNESS = TEST_TO_ADAPTER_DIR;

/** どの保存点の節も呼ぶ表明(生成テストの import)。 */
const EXPECT_IMPORTS = ['expectSaveDecisions', 'expectSaveWorldBuilt', 'expectSaveWrites'] as const;

/** 入力を変えた押し直しの表明(再送で既存の行を返す保存点だけが呼ぶ)。 */
const RESEND_EDITED = 'expectSaveResendEdited';

/** 1 回目がコミットする前に届いた同じ鍵の押し直しの性質(点検 22 回目 A22-1)。 */
const RESEND_RACE = 'expectSaveResendRace';

/** そのユースケースのどこかの節が入力を変えた押し直しを確かめるか(import を要るときだけ出す)。 */
function usesResendEdited(suite: EqSaveTestSuite): boolean {
  return suite.sections.some((section) => section.cases.some((entry) => entry.body.includes(RESEND_EDITED)));
}

/** 1 本ぶんの持ち時間(ミリ秒)。全組み合わせを 1 本の中で実行するので既定では収まらない。 */
const TIMEOUT_MS = 600_000;

/** テスト 1 本ぶんの宣言(生成テストと usecase_spec の `test_cases` が同じ導出を共有する)。 */
export interface EqSaveTestCase {
  /** ユースケースの中での 1 始まりの番号(テストケース ID になる)。 */
  readonly index: number;
  readonly title: string;
  /** テスト本体の 1 行。 */
  readonly body: string;
  /** 実 DB を読まない検算か(`it` を同期にする)。 */
  readonly sync: boolean;
}

/** 保存点 1 つぶんの節。 */
export interface EqSaveTestSection {
  readonly key: string;
  readonly heading: string;
  readonly cases: readonly EqSaveTestCase[];
}

/** ユースケース 1 枚ぶんの生成テストの宣言。 */
export interface EqSaveTestSuite {
  readonly usecase: string;
  /** 注釈の `spec_ids` に載せる仕様 ID(ユースケース自身の id)。 */
  readonly specId: string;
  /** 正になる仕様ファイル。 */
  readonly specFile: string;
  readonly sections: readonly EqSaveTestSection[];
}

/**
 * world を作れた全保存点について、生成テストの宣言を組み立てる。
 *
 * @param model ドメイン仕様
 * @param ctx 生成の文脈(ガード解析・action_spec・data_table・usecase_spec)
 * @returns ユースケース名順の宣言
 */
export function eqSaveTestSuites(model: SpecModel, ctx: GenerateContext): readonly EqSaveTestSuite[] {
  const entries = eqSaveCatalog({
    domain: model,
    guards: ctx.guards,
    actions: ctx.actions,
    dataTables: ctx.dataTables,
    usecases: ctx.usecases,
  }).filter((entry) => entry.result.ok);
  const names = [...new Set(entries.map((entry) => entry.usecase.name))].sort();
  return names.map((name) => suiteOf(entries.filter((entry) => entry.usecase.name === name), ctx.roots));
}

/** 全保存点の設計図から一致の証明を生成するジェネレーター。 */
export const eqSaveTestsGenerator: DocGenerator = {
  id: 'code-eq-save-tests',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const place = eqSaveTestPlacerOf(ctx);
    if (place === null) return [];
    return eqSaveTestSuites(model, ctx).map((suite) => ({
      file: place(suite.usecase),
      content: renderTestFile(suite, bodyModulesOf(ctx, { what: `ユースケース ${suite.usecase} の保存点の一致の証明`, location: { file: suite.specFile } })),
      wholeFile: true,
    }));
  },
};

/** ユースケース 1 枚ぶんの宣言(保存点は宣言順、番号はユースケースを通して連番)。 */
function suiteOf(entries: readonly EqSaveCatalogEntry[], roots: ProductRoots): EqSaveTestSuite {
  const first = entries[0];
  let index = 0;
  const sections = entries.map((entry) => {
    const cases: EqSaveTestCase[] = [];
    if (!entry.result.ok) return { key: entry.key, heading: entry.key, cases };
    const grid = entry.result.cases;
    index += 1;
    cases.push({
      index,
      title: EQ_TEST_WORDS.saveDecisionTitle({
        op: entry.key,
        count: grid.decisionCount,
        folded: grid.folded,
        guards: grid.foldedGuards.map((guard) => EQ_TEST_WORDS.foldedGuard(guard)),
        ...unenforcedOf(grid.steps),
      }),
      body: `await expectSaveDecisions(WORLD, built);`,
      sync: false,
    });
    index += 1;
    cases.push({
      index,
      title: EQ_TEST_WORDS.saveWriteTitle(entry.key, grid.writeCount),
      body: `await expectSaveWrites(WORLD, built);`,
      sync: false,
    });
    index += 1;
    cases.push({
      index,
      title: EQ_TEST_WORDS.worldBuilt(entry.key),
      body: 'expectSaveWorldBuilt(WORLD, built);',
      sync: true,
    });
    // 再送で既存の行を返す保存点(複合の作成)は、同じ鍵で入力を 1 欄変えた押し直しが断られることも確かめる(点検 21 回目 A21-1)。
    if (grid.resend === 'idempotent') {
      index += 1;
      cases.push({
        index,
        title: EQ_TEST_WORDS.saveResendEditedTitle(entry.key),
        body: `await ${RESEND_EDITED}(WORLD, built);`,
        sync: false,
      });
      // 1 回目の txn が開いている間に同じ鍵の押し直しが届く交錯(点検 22 回目 A22-1。探りの racex.sh の移植)。
      index += 1;
      cases.push({
        index,
        title: EQ_TEST_WORDS.saveResendRaceTitle(entry.key),
        body: `await ${RESEND_RACE}(WORLD, built);`,
        sync: false,
      });
    }
    return { key: entry.key, heading: EQ_TEST_WORDS.saveSection(grid.label, entry.key), cases };
  });
  return {
    usecase: first?.usecase.name ?? '',
    specId: first?.usecase.id ?? '',
    specFile: first === undefined ? '' : specPath(roots, `frontend/usecases/${first.usecase.relPath}`),
    sections,
  };
}

/**
 * 拒否の側を比べない手順(`shape: composite` = 判定を持たない)の注記。
 *
 * **テスト名は主張である。** 判定を持たない手順で落ちるはずの組み合わせについて、このテストは
 * 何も実測していない —— 畳んだ軸を両側とも示すのと同じ理由で、そこを示さずに「全 N 通りで
 * 一致する」と書くと主張が実際より広くなる(独立レビュー ⑳-5a2 の直す 3)。
 *
 * `unnamed`(`handwritten:`)は含めない —— その手順の拒否は**複合 RPC が競合として返す**ので、
 * 可否は比べられている(返さないのは理由だけである)。
 *
 * @param steps その保存点の手順の並び
 * @returns 判定を持たない手順の操作 ID と、それが全手順かどうか
 */
function unenforcedOf(steps: readonly { readonly op: string; readonly enforcement: string }[]): {
  readonly unenforced: readonly string[];
  readonly allUnenforced: boolean;
} {
  const unenforced = steps.filter((step) => step.enforcement === 'none').map((step) => step.op);
  return { unenforced, allUnenforced: steps.length > 0 && unenforced.length === steps.length };
}

/** テストファイル 1 本。 */
function renderTestFile(suite: EqSaveTestSuite, modules: BodyModules): string {
  return [
    generatedTestHeader(suite),
    '',
    "import { afterAll, beforeAll, describe, it } from 'vitest';",
    `import { eqSaveWorlds } from '${modules.generated('eq-worlds')}';`,
    `import type { BuiltEqWorld } from '${HARNESS}/eq-save-world';`,
    `import { createEqWorld, resetEqWorld } from '${HARNESS}/eq-save-world';`,
    `import { ${[...EXPECT_IMPORTS, ...(usesResendEdited(suite) ? [RESEND_EDITED, RESEND_RACE] : [])].sort().join(', ')} } from '${HARNESS}/eq-save-expect';`,
    '',
    `describe(${tsString(EQ_TEST_WORDS.saveSuite(suite.usecase))}, () => {`,
    ...suite.sections.flatMap((section) => renderSection(suite, section)).slice(0, -1),
    '});',
    '',
  ].join('\n');
}

/** 保存点 1 つぶんの節(world はこの節の中で作り直す)。 */
function renderSection(suite: EqSaveTestSuite, section: EqSaveTestSection): readonly string[] {
  return [
    `  describe(${tsString(section.heading)}, () => {`,
    '    /** この保存点の world と組み合わせの設計図(生成物)。行の値も実行する順もここが正である。 */',
    `    const WORLD = eqSaveWorlds[${tsString(section.key)}];`,
    '',
    '    /** 実 DB に作った world(id は挿入のたびに変わるので、設計図の名前から引く)。 */',
    '    let built: BuiltEqWorld;',
    '',
    '    beforeAll(async () => {',
    '      built = await createEqWorld(WORLD);',
    '    });',
    '',
    '    afterAll(async () => {',
    '      await resetEqWorld();',
    '    });',
    '',
    ...section.cases.flatMap((entry) => renderCase(suite, entry)).slice(0, -1),
    '  });',
    '',
  ];
}

/** テスト 1 本(`it()`)。 */
function renderCase(suite: EqSaveTestSuite, entry: EqSaveTestCase): readonly string[] {
  const close = entry.sync ? '    });' : `    }, ${TIMEOUT_MS.toLocaleString('en-US').split(',').join('_')});`;
  return [
    `    // @spec ${suite.specId} @tc ${eqSaveTestCaseIdOf(suite.usecase, entry.index)}`,
    `    it(${tsString(entry.title)}, ${entry.sync ? '() => {' : 'async () => {'}`,
    `      ${entry.body}`,
    close,
    '',
  ];
}

/** 生成テストのヘッダ(正の仕様と、このテストが何を言えるか)。 */
function generatedTestHeader(suite: EqSaveTestSuite): string {
  return [
    '/**',
    ' * AUTO-GENERATED by `npm run generate` — 手編集禁止。',
    ' *',
    ' * このファイルの正は次の仕様であり、ここはその機械的な写像にすぎない。',
    ' * 変更するときは仕様を編集してから再生成すること(ADR-0006)。',
    ` *   - ${blockCommentText(suite.specFile)}`,
    ' *',
    ` * ${suite.usecase} の保存点を**全組み合わせ**で実 DB で実行し、実行器が手順の順に立てる \`permit\``,
    ' * (`decideStep`)と複合 RPC の結末(errcode の 3 分類 + **落ちた手順の操作 ID**)が一致する',
    ' * ことを確かめる(束 ⑳-5a2)。許可された組み合わせでは、保存点が作る行が全部でき、結末の',
    ' * 状態が宣言どおりになることまで見る。',
    ' *',
    ' * 期待は実行器そのものが出す —— 複合 RPC を組み立てる生成器(`render/usecase-sql.ts`)とは',
    ' * 独立の写像であり、食い違えばどちらかがバグである(意味の正は仕様にある)。',
    ' */',
  ].join('\n');
}
