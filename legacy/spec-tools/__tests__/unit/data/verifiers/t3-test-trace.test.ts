/**
 * T3(テスト突合)の規約網羅テスト。
 * 対象の要求: ARCH-SP-BE-0001 §テーブル仕様「`test_cases` に突合テストの宣言を 1 つ以上持つ」。
 * 3 段の突合そのものは A6 / Q6 / Z1 と共通実装(lib/testcase/test-trace-match.ts)なので、
 * ここでは T3 として動くこと・`spec_ids` の実在・**表ごとの突合テストの宣言の必須**を見る。
 */

import { describe, expect, it } from 'vitest';
import { parityTestName, verifyDataTableTestTrace } from '../../../../lib/data/verifiers/t3-test-trace.js';
import type { DataTableSpecModel } from '../../../../lib/model/data/types.js';
import type { ActionTestCase } from '../../../../lib/testcase/types.js';
import { buildTcRegistry } from '../../../../lib/testcase/registry.js';
import { collectTcEntries } from '../../../../lib/spec-index/sources.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { annotation, scanResult } from '../../../helpers/trace-builder.js';
import { aggregate, event, loc, machine, specModel } from '../../../helpers/model-builder.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

const PARITY_FILE = 'app/src/infrastructure/__tests__/schema/data-table-parity.test.ts';
const DDL_PARITY_FILE = 'app/src/infrastructure/__tests__/schema/ddl-parity.test.ts';
const RPC_PARITY_FILE = 'app/src/infrastructure/__tests__/schema/rpc-parity.test.ts';
const TABLE = 'entries';
const TC = 'TC-TABLE-ENTRIES-001';

/** 表ごとの突合テストを指す宣言 1 件(規約どおりの宛先)。 */
function parityCase(specIds: readonly string[] = [`table-${TABLE}`]): ActionTestCase {
  const testName = parityTestName(TABLE);
  return {
    id: TC,
    type: 'integration',
    specIds,
    covers: ['success'],
    implementation: { raw: `${PARITY_FILE}::${testName}`, file: PARITY_FILE, testName },
    location: loc(`docs/specs/backend/data/tables/${TABLE}.md`, 'test_cases[0]'),
  };
}

/** 台帳を data_table だけから構築する。 */
function registryOf(model: DataTableSpecModel) {
  return buildTcRegistry(collectTcEntries({ dataTables: model }));
}

/** 標準的な入力(1 表 + 規約どおりのテストケースの宣言 1 件)。 */
function standard(specIds?: readonly string[]): DataTableSpecModel {
  return dataTableModel([dataTable(TABLE, { testCases: [parityCase(specIds)] })]);
}

/** 走査結果(注釈が実在するテストに付いている状態)。 */
function scanned() {
  return scanResult({
    testFiles: [PARITY_FILE],
    annotations: [annotation({ tcId: TC, file: PARITY_FILE, testName: parityTestName(TABLE) })],
  });
}

describe('T3 テスト突合', () => {
  it('実在するテストに @tc が付いていれば通る', () => {
    const model = standard();

    expect(verifyDataTableTestTrace(specModel([]), model, registryOf(model), scanned(), TEST_ROOTS, TEST_LAYOUT)).toEqual([]);
  });

  it('テストファイルが無ければ T3 の違反になる', () => {
    const model = standard();
    const findings = verifyDataTableTestTrace(specModel([]), model, registryOf(model), scanResult({ testFiles: [] }), TEST_ROOTS, TEST_LAYOUT);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('T3');
    expect(findings[0]?.message).toContain('implementation が指すテストファイルがありません');
  });

  it('@tc が無いテストは uncovered として違反になる(3 表が緑で居座っていた穴)', () => {
    const model = standard();
    const findings = verifyDataTableTestTrace(specModel([]), model, registryOf(model), scanResult({ testFiles: [PARITY_FILE] }), TEST_ROOTS, TEST_LAYOUT);

    expect(findings.some((finding) => finding.message.includes('がテストコードにありません'))).toBe(true);
  });

  it('テスト名の食い違いを検出する', () => {
    const model = standard();
    const findings = verifyDataTableTestTrace(specModel([]), model, registryOf(model), scanResult({
        testFiles: [PARITY_FILE],
        annotations: [annotation({ tcId: TC, file: PARITY_FILE, testName: '別の名前' })],
      }), TEST_ROOTS, TEST_LAYOUT);

    expect(findings.some((finding) => finding.message.includes('テスト名が implementation と一致しません'))).toBe(true);
  });

  it('表ごとの突合テストの宣言が無ければ、走査できていなくても違反になる', () => {
    const model = dataTableModel([dataTable(TABLE, { testCases: [] })]);
    const findings = verifyDataTableTestTrace(specModel([]), model, registryOf(model), scanResult({ available: false }), TEST_ROOTS, TEST_LAYOUT);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('T3');
    expect(findings[0]?.message).toBe(`${TABLE} が ${PARITY_FILE} の突合テストを宣言していません`);
  });

  it('テストケースの宣言があっても宛先が表ごとの突合テストでなければ違反になる', () => {
    const other = { ...parityCase(), implementation: { raw: 'x', file: PARITY_FILE, testName: '別の表 の突合' } };
    const model = dataTableModel([dataTable(TABLE, { testCases: [other] })]);
    const findings = verifyDataTableTestTrace(specModel([]), model, registryOf(model), scanResult({ available: false }), TEST_ROOTS, TEST_LAYOUT);

    expect(findings.map((finding) => finding.message)).toContain(
      `${TABLE} が ${PARITY_FILE} の突合テストを宣言していません`,
    );
  });

  it('ddl_migration を宣言した表は DDL の突合テストの宣言も要る', () => {
    const model = dataTableModel([
      dataTable(TABLE, { testCases: [parityCase()], ddlMigration: '20260101000000_ddl_entries.sql' }),
    ]);
    const findings = verifyDataTableTestTrace(specModel([]), model, registryOf(model), scanResult({ available: false }), TEST_ROOTS, TEST_LAYOUT);

    expect(findings.map((finding) => finding.message)).toContain(
      `${TABLE} が ${DDL_PARITY_FILE} の突合テストを宣言していません`,
    );
  });

  it('RPC を持つ表は RPC 本文の突合テストの宣言も要る', () => {
    const model = dataTableModel([
      dataTable(TABLE, {
        testCases: [parityCase()],
        functions: [{ name: 'insert_entry', args: [], params: [], kind: 'rpc', alsoWrites: [] }],
      }),
    ]);
    const findings = verifyDataTableTestTrace(specModel([]), model, registryOf(model), scanResult({ available: false }), TEST_ROOTS, TEST_LAYOUT);

    expect(findings.map((finding) => finding.message)).toContain(
      `${TABLE} が ${RPC_PARITY_FILE} の突合テストを宣言していません`,
    );
  });

  it('spec_ids が実在しない ID を指すと違反になる', () => {
    const model = standard(['nowhere.event']);
    const findings = verifyDataTableTestTrace(specModel([]), model, registryOf(model), scanned(), TEST_ROOTS, TEST_LAYOUT);

    expect(findings.map((finding) => finding.message)).toContain(
      `${TC} の spec_ids nowhere.event に対応する仕様がありません`,
    );
  });

  it('spec_ids にはドメインイベント ID も書ける', () => {
    const domain = specModel([
      aggregate('entry', {
        stateMachines: [
          machine('entry', {
            states: ['draft', 'submitted'],
            initial: 'draft',
            events: [event('submit', { from: ['draft'], to: 'submitted' })],
          }),
        ],
      }),
    ]);
    const model = standard(['entry.submit']);

    expect(verifyDataTableTestTrace(domain, model, registryOf(model), scanned(), TEST_ROOTS, TEST_LAYOUT)).toEqual([]);
  });
});

describe('T3: 表ごとの突合テストの置き場は、置き場の配置が宣言する土台(基盤の層のテスト支援)の下', () => {
  /** ソースの根を動かした配置(土台の表は同じ層・同じ名前のまま、置き場だけが配置の値に従う)。 */
  const MOVED = { ...TEST_LAYOUT, 'source-root': { ...(TEST_LAYOUT['source-root'] ?? failMissing()), place: () => 'server_code' } };

  it('配置のソースの根を動かすと、期待する突合テストの宣言先がそのパスに変わる(Next.js の綴りで固定していない)', () => {
    const model = standard();
    const findings = verifyDataTableTestTrace(specModel([]), model, registryOf(model), scanResult({ testFiles: [] }), TEST_ROOTS, MOVED);
    const wanted = findings.filter((finding) => finding.message.includes('の突合テストを宣言していません')).map((finding) => finding.message);

    expect(wanted).toEqual([`${TABLE} が app/server_code/infrastructure/__tests__/schema/data-table-parity.test.ts の突合テストを宣言していません`]);
  });

  it('基盤の層のテスト支援の土台が宣言されていない配置(空の配置)では、置き場を示さず(空)に倒す — 実在の突合は別の検査が見る', () => {
    const model = standard();
    const findings = verifyDataTableTestTrace(specModel([]), model, registryOf(model), scanResult({ testFiles: [] }), TEST_ROOTS, {});

    expect(findings.every((finding) => !finding.message.includes('app/src/infrastructure'))).toBe(true);
  });
});

/** 配置の元の値が足りないテストの書き間違いを知らせる。 */
function failMissing(): never {
  throw new Error('配置に必要な宣言がありません');
}
