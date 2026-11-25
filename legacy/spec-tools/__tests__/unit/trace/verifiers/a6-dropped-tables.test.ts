/**
 * A6 の orphan 判定と、読めずに落とした data_table(入力の状態-f)。
 *
 * 落とした表の `test_cases` は台帳(`TcRegistry`)に載らない(欠けた表の宣言を部分的に信用しない)。台帳に無い `@tc` を全部 orphan にすると、
 * 表の 1 行を落としただけで、その表の `@tc` の数だけ偽の error が連鎖する。A6 は落とした表の名前空間(表名を 1 区切りに持つ ID)の `@tc` を
 * orphan と判定せず、見ていないことを `gaps` で名指す。名前空間の外の `@tc` は従来どおり orphan にする。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readMatter, stringifyMatter } from '../../../helpers/front-matter.js';
import { afterEach, describe, expect, it } from 'vitest';
import { availableLoad, catalogInput, type CatalogInput } from '../../../../lib/kernel/input-state.js';
import { loadDataTableSpecModel } from '../../../../lib/model/data/loader.js';
import type { DataTableSpecModel } from '../../../../lib/model/data/types.js';
import { collectTcEntries } from '../../../../lib/spec-index/sources.js';
import { buildTcRegistry } from '../../../../lib/testcase/index.js';
import { testTraceVerifier } from '../../../../lib/trace/verifiers/a6-test-trace.js';
import { annotation, scanResult, traceInput } from '../../../helpers/trace-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';

const TEST_FILE = 'app/src/infrastructure/__tests__/schema/shelves.test.ts';

/** 落とした表を持つテーブル仕様の入力の状態(`shelves.md` を落とした阻害)。 */
function droppedInput(tables: DataTableSpecModel['tables'] = []): CatalogInput<DataTableSpecModel> {
  const model: DataTableSpecModel = { available: true, tables, droppedTables: ['shelves.md'], droppedEntities: { 'shelves.md': 'shelf' } };
  return catalogInput('selected', availableLoad(model, [], 1));
}

/** 指定の `@tc` だけを付けたテストの走査結果。 */
function tests(...tcIds: readonly string[]) {
  return scanResult({
    testFiles: [TEST_FILE],
    annotations: tcIds.map((tcId, index) => annotation({ tcId, file: TEST_FILE, testName: 't', line: index + 1 })),
  });
}

describe('A6: 落とした表の名前空間の @tc は orphan にしない', () => {
  it('落とした表の @tc は orphan にならず、見ていないことが 1 行(対象 = その @tc)で返る', () => {
    const input = traceInput({
      dataTablesInput: droppedInput(),
      tests: tests('TC-TABLE-SHELVES-001', 'TC-TABLE-SHELVES-002', 'TC-DDL-SHELVES-001'),
    });

    const run = testTraceVerifier.runPartial(input);

    expect(run.findings).toEqual([]);
    expect(run.gaps).toHaveLength(1);
    expect(run.gaps[0]?.gap).toEqual({ input: 'data_tables', state: 'blocked', reason: 'invalid' });
    expect(run.gaps[0]?.subjects).toEqual(['TC-TABLE-SHELVES-001', 'TC-TABLE-SHELVES-002', 'TC-DDL-SHELVES-001']);
    expect(run.gaps[0]?.consequence).toContain('orphan');
    expect(testTraceVerifier.verify(input)).toEqual([]);
  });

  it('名前空間の外の @tc は従来どおり orphan(落とした表があっても、それ以外の取りこぼしは黙らない)', () => {
    const input = traceInput({ dataTablesInput: droppedInput(), tests: tests('TC-TABLE-OTHER-001', 'TC-TABLE-SHELVES-001') });

    const run = testTraceVerifier.runPartial(input);

    expect(run.findings.map((finding) => finding.counterexample?.['tc'])).toEqual(['TC-TABLE-OTHER-001']);
    expect(run.gaps[0]?.subjects).toEqual(['TC-TABLE-SHELVES-001']);
  });

  it('表名が別の表名の一部になっている ID は、落とした表のものではない(`shelves` の名前空間に `shelves_log` は入らない)', () => {
    const input = traceInput({ dataTablesInput: droppedInput(), tests: tests('TC-TABLE-SHELVES_LOG-001') });

    const run = testTraceVerifier.runPartial(input);

    expect(run.findings).toHaveLength(1);
    expect(run.gaps).toEqual([]);
  });

  it('EQ 系(単数形の entity 名)の @tc も、落とした表の名前空間: orphan にならず「見ていない」に入る', () => {
    const input = traceInput({ dataTablesInput: droppedInput(), tests: tests('TC-EQ-SHELF-0001', 'TC-TABLE-SHELVES-001') });

    const run = testTraceVerifier.runPartial(input);

    expect(run.findings).toEqual([]);
    expect(run.gaps[0]?.subjects).toEqual(['TC-EQ-SHELF-0001', 'TC-TABLE-SHELVES-001']);
  });

  it('保証台帳・画面の ID は、表名と同じ綴りの区切りを持っていても表の名前空間に吸われず、従来どおり orphan', () => {
    const input = traceInput({ dataTablesInput: droppedInput(), tests: tests('TC-GUAR-SHELVES-001', 'TC-SCREEN-SHELVES-001') });

    const run = testTraceVerifier.runPartial(input);

    expect(run.findings.map((finding) => finding.counterexample?.['tc'])).toEqual(['TC-GUAR-SHELVES-001', 'TC-SCREEN-SHELVES-001']);
    expect(run.gaps).toEqual([]);
  });

  it('落とした表の @tc が 1 本も無ければ、見ていないことは言わない(見ていないものが無い)', () => {
    const run = testTraceVerifier.runPartial(traceInput({ dataTablesInput: droppedInput(), tests: tests() }));

    expect(run).toEqual({ findings: [], gaps: [] });
  });

  it('落とした表が無い(読込済み・未選択)ときは従来どおり orphan で、gaps は無い', () => {
    const loaded = traceInput({ dataTables: dataTableModel([dataTable('workshops')]), tests: tests('TC-TABLE-SHELVES-001') });
    const unselected = traceInput({ tests: tests('TC-TABLE-SHELVES-001') });

    for (const input of [loaded, unselected]) {
      const run = testTraceVerifier.runPartial(input);
      expect(run.findings).toHaveLength(1);
      expect(run.gaps).toEqual([]);
    }
  });

  it('落とした表を持たない阻害(置き場が無い)でも、台帳の外の名前空間を決めつけない: 従来どおり orphan', () => {
    const blocked = traceInput({ dataTables: dataTableModel([], false), tests: tests('TC-TABLE-SHELVES-001') });

    const run = testTraceVerifier.runPartial(blocked);

    expect(run.findings).toHaveLength(1);
    expect(run.gaps).toEqual([]);
  });
});

describe('A6: 実ローダーで表の 1 行を落とす(反例)', () => {
  const SAMPLES = path.resolve(import.meta.dirname, '../../../fixtures/samples');
  const created: string[] = [];

  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** 題材 stores の `shelves.md` を、トリガの `name` を欠いた形で一時ツリーに置いて読む。 */
  function loadWithDroppedRow() {
    const dir = mkdtempSync(path.join(tmpdir(), 'a6-dropped-'));
    created.push(dir);
    const parsed = readMatter(readFileSync(path.join(SAMPLES, 'stores/docs/specs/backend/data/tables/shelves.md'), 'utf8'));
    const data = structuredClone(parsed.data) as Record<string, unknown>;
    delete (data['triggers'] as Record<string, unknown>[])[0]!['name'];
    mkdirSync(path.join(dir, 'tables'));
    writeFileSync(path.join(dir, 'tables', 'shelves.md'), stringifyMatter('\n# 本文\n', data));
    return loadDataTableSpecModel(path.join(dir, 'tables'), { repoRoot: dir });
  }

  it('表の 1 行を落とすと、その表の @tc の数だけの偽の orphan にならず、「見ていない」1 行になる', () => {
    const loaded = loadWithDroppedRow();
    expect(loaded.dropped).toBe(1);
    const registry = buildTcRegistry(collectTcEntries({ dataTables: loaded.model }));
    expect(registry.entries).toEqual([]);
    const input = {
      ...traceInput({ tests: tests('TC-TABLE-SHELVES-001', 'TC-TABLE-SHELVES-002', 'TC-DDL-SHELVES-001', 'TC-TABLE-SHELVES-003') }),
      registry,
      dataTables: catalogInput('selected', availableLoad(loaded.model, loaded.findings, loaded.dropped)),
    };

    const run = testTraceVerifier.runPartial(input);

    expect(run.findings).toEqual([]);
    expect(run.gaps).toHaveLength(1);
    expect(run.gaps[0]?.subjects).toHaveLength(4);
  });

  it('EQ 系の @tc(単数形の entity 名)も、実ローダーが読んだ entity 名から名前空間に入る(偽の orphan にならない)', () => {
    const loaded = loadWithDroppedRow();
    const input = {
      ...traceInput({ tests: tests('TC-EQ-SHELF-0001', 'TC-EQ-SHELF-0002') }),
      registry: buildTcRegistry(collectTcEntries({ dataTables: loaded.model })),
      dataTables: catalogInput('selected', availableLoad(loaded.model, loaded.findings, loaded.dropped)),
    };

    const run = testTraceVerifier.runPartial(input);

    expect(run.findings).toEqual([]);
    expect(run.gaps[0]?.subjects).toEqual(['TC-EQ-SHELF-0001', 'TC-EQ-SHELF-0002']);
  });
});
