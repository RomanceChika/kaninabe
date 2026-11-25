/**
 * T3 テスト突合チェック(data_table ⇔ テスト)。
 *
 * ARCH-SP-BE-0001 §テーブル仕様の要求:「`test_cases` に突合テストの宣言を 1 つ以上持つ」。
 * 3 段の突合(ファイルの実在 → `@tc` の存在 → テスト名の一致)は A6 / Q6 / S8 / Y9 / H3 /
 * X4 / Z1 とまったく同じ規則なので lib/testcase/test-trace-match.ts を共用し、突合する宣言は
 * テストケース ID 台帳の `data_table` エントリから引く。
 *
 * **なぜこれが要るのか。** data_table は台帳(spec-index)に登録されているので `@tc` の
 * 孤児判定の母集合にはなっていた(テスト側に宣言の無い注釈があれば A6 が拾う)が、
 * **逆方向 —— 宣言したテストケースが実在するテストを指しているか —— は誰も見ていなかった**。
 * その結果、`data-table-parity` の表ごとのテストが書かれていない表が、実在しないテスト名を
 * 指す `test_cases` を宣言したまま緑で居座り、**索引・外部キー・トリガ・CHECK の突合を
 * 1 つも受けていない**状態が起きた(2026-09-09 に 3 表で実測)。
 *
 * したがってこの検証器は 2 つを見る。
 * 1. 宣言したテストケースが実在するテストに接地しているか(3 段の突合。他群と同じ)。
 * 2. **表ごとの突合テストを宣言しているか**(下の `parityTestName`)。1 だけでは
 *    「宣言しなければ通る」ので、表を足した人が黙って突合の外に出られてしまう。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import type { TestScanResult, TcRegistry, TcRegistryEntry } from '../../testcase/types.js';
import { checkTestCaseTrace, groupByTcId } from '../../testcase/index.js';
import { collectDomainSpecIds } from '../../semantics/domain-spec-ids.js';
import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import { layoutBaseDirPath } from '../../model/framework-base-dirs.js';
import { PRODUCT_DECL_FILE } from '../../io/paths.js';
import { CORE_REQUIRED_BASE_DIRS } from '../../model/framework-dirs.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T3';

/** 突合の置き場(リポジトリルート相対)。基盤の層のテスト支援の土台(置き場の配置が宣言する)の下の `schema`。実装の木を持たない製品では null。 */
function schemaTests(layout: ProductLayout, roots: ProductRoots): string | null {
  const base = CORE_REQUIRED_BASE_DIRS.infrastructureTests;
  const support = layoutBaseDirPath(layout, roots.app, base.layer, base.dir);
  return support === null ? null : `${support}/schema`;
}

/**
 * 表ごとの突合テストの名前(表名から機械的に決まる)。
 *
 * @param table 物理テーブル名
 * @returns そのテーブルの突合テストのテスト名
 */
export function parityTestName(table: string): string {
  return `${table} の宣言どおりの実体だけが DB にある`;
}

/**
 * 表の DDL の突合テストの名前(表名から機械的に決まる)。
 *
 * @param table 物理テーブル名
 * @returns そのテーブルの DDL の突合テストのテスト名
 */
export function ddlParityTestName(table: string): string {
  return `${table} の列と制約が宣言どおりである`;
}

/**
 * RPC 本文の突合テストの名前(表名から機械的に決まる)。
 *
 * @param table 物理テーブル名
 * @returns そのテーブルの RPC の突合テストのテスト名
 */
export function rpcParityTestName(table: string): string {
  return `${table} の RPC が宣言どおりの本文である`;
}

/**
 * テストケースの宣言を必須にする突合 1 種(置き場・テスト名の作り方・掛かる表・何を突き合わせるか)。
 *
 * **3 つとも `it` を手で並べない形になった**(全数ループ + ひな形の注釈)。ひな形の注釈は
 * 台帳のテスト名をそのまま写して展開するので、**穴に入る字が実在の表かどうかは 3 段の突合では
 * もう見られない** —— 綴り違いの台帳エントリでも展開されて緑になる。そこを縛るのがこの表で
 * あり、**テスト名が表名から機械的に決まる**ことがその条件である(独立レビュー 束 ③-4 の観点 1)。
 */
interface ParityTarget {
  /** 突合のファイル(リポジトリルート相対)。 */
  readonly file: string;
  /** 表名 → テスト名。 */
  readonly testName: (table: string) => string;
  /** その表にこの宣言を必須にするか。 */
  readonly applies: (table: DataTableSpec) => boolean;
  /** 対処に書く「この宣言が無いと何が突き合わされないか」。 */
  readonly what: string;
}

/** 宣言を必須にする突合の全数。置き場は宣言から組み立てる。 */
function parityTargets(schemaTestsDir: string): readonly ParityTarget[] {
  return [
  {
    file: `${schemaTestsDir}/data-table-parity.test.ts`,
    testName: parityTestName,
    applies: () => true,
    what: '索引・外部キーの ON DELETE・トリガ・CHECK が実 DB と突き合わされる唯一の経路である',
  },
  {
    file: `${schemaTestsDir}/ddl-parity.test.ts`,
    testName: ddlParityTestName,
    // 形の正がある表(`ddl_migration` を宣言した表)だけが期待表に載る。
    applies: (table) => table.ddlMigration !== undefined,
    what: '列・型・NOT NULL・既定値・CHECK の字面・ACL が実 DB と突き合わされる経路である',
  },
  {
    file: `${schemaTestsDir}/rpc-parity.test.ts`,
    testName: rpcParityTestName,
    // RPC を 1 本でも持つ表だけが期待表に載る。
    applies: (table) => table.functions.some((fn) => fn.kind === 'rpc'),
    what: 'RPC の本文(許可列・楽観的並行制御・書き込み先の表)が実 DB と突き合わされる経路である',
    },
  ];
}

/**
 * data_table の test_cases が実在するテストに接地し、`spec_ids` が実在するかを検証する。
 * あわせて、表ごとの突合テストが宣言されているかを見る。
 *
 * `@tc` の突合は app/ を走査できていない構成では何も見ない(A6 / Z1 と同じ扱い)が、
 * `spec_ids` の実在とテストケースの宣言は仕様だけで判定できるので常に見る。
 *
 * @param domain 構築済みのドメイン仕様モデル(spec_ids の母集合)
 * @param dataTables 読み込み済みの data_table
 * @param registry テストケース ID 台帳
 * @param tests app/ の走査結果
 * @param roots 製品が宣言した根
 * @param layout 置き場の配置(突合テストの置き場 = テスト支援の土台の位置の宣言元)
 * @returns 違反のリスト
 */
export function verifyDataTableTestTrace(
  domain: SpecModel,
  dataTables: DataTableSpecModel,
  registry: TcRegistry,
  tests: TestScanResult,
  roots: ProductRoots,
  layout: ProductLayout,
): Finding[] {
  const schemaTestsDir = schemaTests(layout, roots);
  const entries = registry.ofKind('data_table');
  const known = new Set([...collectDomainSpecIds(domain), ...dataTables.tables.map((table) => table.id)]);
  const findings = entries.flatMap((entry) => checkSpecIds(entry, known));
  // 実装の木があるのに、配置が突合テストの置き場(基盤の層のテスト支援の土台)を宣言していない —— 空の住所で突合を見ると別の場所を黙って見る。
  if (schemaTestsDir === null && roots.app !== null) return [...findings, undeclaredSchemaTests()];
  findings.push(...dataTables.tables.flatMap((table) => checkParityDeclared(table, entries, schemaTestsDir ?? '')));
  if (!tests.available) return findings;
  const byTcId = groupByTcId(tests.annotations);
  const testFiles = new Set(tests.testFiles);
  return [
    ...findings,
    ...entries.flatMap((entry) =>
      checkTestCaseTrace(entry, byTcId.get(entry.tcId) ?? [], testFiles, VERIFIER_ID),
    ),
  ];
}

/** spec_ids が実在する仕様(ドメインの ID か、テーブル仕様自身の id)を指しているか。 */
function checkSpecIds(entry: TcRegistryEntry, known: ReadonlySet<string>): Finding[] {
  return entry.specIds
    .filter((id) => !known.has(id))
    .map((id) => ({
      verifier: VERIFIER_ID,
      severity: 'error' as const,
      message: `${entry.tcId} の spec_ids ${id} に対応する仕様がありません`,
      location: entry.location,
      suggestion:
        'spec_ids に書けるのはドメインの仕様 ID(イベント / access_spec の id / 不変条件 ID)か、' +
        'テーブル仕様自身の id(table-{table})である。実在する ID に直す',
      counterexample: { test_case: entry.tcId, spec_id: id },
    }));
}

/** 突合テストの置き場の土台が配置に宣言されていない(土台の宣言漏れ。配置の定義の検査が選ぶ根の 1 回で先に止める)。 */
function undeclaredSchemaTests(): Finding {
  const base = CORE_REQUIRED_BASE_DIRS.infrastructureTests;
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message: `突合テストの置き場を決められません(配置が、層 ${base.layer} の土台 ${base.dir} を宣言していません)`,
    location: { file: PRODUCT_DECL_FILE },
    suggestion:
      'アプリの枠の後段の配置が、`source-root` の `structure.baseDirs` に層 infrastructure の土台 `__tests__` を宣言する' +
      '(配置の定義の検査 `layoutDefinitionProblems` が選ぶ根の 1 回で止める。宣言が無いまま表ごとの突合を見ると、空の住所を見て別の場所を黙って突合する)',
    counterexample: { layer: base.layer, dir: base.dir },
  };
}

/** 表ごとの突合テスト(期待表 ⇔ pg_catalog)のテストケースの宣言があるか。 */
function checkParityDeclared(
  table: DataTableSpec,
  entries: readonly TcRegistryEntry[],
  schemaTestsDir: string,
): Finding[] {
  return parityTargets(schemaTestsDir)
    .filter((target) => target.applies(table))
    .flatMap((target) => checkOneParity(table, entries, target));
}

/** 突合 1 種ぶんのテストケースの宣言の必須を見る。 */
function checkOneParity(
  table: DataTableSpec,
  entries: readonly TcRegistryEntry[],
  target: ParityTarget,
): Finding[] {
  const expected = target.testName(table.table);
  const declared = entries.some(
    (entry) =>
      entry.specId === table.id &&
      entry.implementation.file === target.file &&
      entry.implementation.testName === expected,
  );
  if (declared) return [];
  return [
    {
      verifier: VERIFIER_ID,
      severity: 'error' as const,
      message: `${table.table} が ${target.file} の突合テストを宣言していません`,
      location: { ...table.location, pointer: 'test_cases' },
      suggestion:
        `test_cases に "implementation: ${target.file}::${expected}" を持つケースを 1 件足す` +
        `(${target.what})`,
      counterexample: { table: table.table, expected_implementation: `${target.file}::${expected}` },
    },
  ];
}
