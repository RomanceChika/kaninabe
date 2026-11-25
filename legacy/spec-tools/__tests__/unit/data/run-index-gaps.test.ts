/**
 * T2 の入力の状態(`runDataTableVerification` と `runDataTables` の配線)のテスト。
 *
 * 索引の要求は query_spec と data_table の関数の `lookup` から導く(関係の層)。query_spec が未選択・阻害のときは
 * **その分を導かず**、理由を結果(`indexGaps`)と実行ログ(`T2: 未実施 / 阻害 — …`)で返す。関数の `lookup` の宣言漏れは
 * query_spec が使えなくても見る(以前からの振る舞い)。読込済みで 0 件なら、欠けも行も出ない。
 */

import { TEST_LAYOUT, TEST_PLATFORM } from '../../helpers/platform.js';
import { describe, expect, it } from 'vitest';
import { loadedInput, UNSELECTED } from '../../helpers/verify-inputs.js';
import { runDataTableVerification } from '../../../lib/data/run.js';
import { isCheckRunNote } from '../../../lib/verify/check-run-report.js';
import { runDataTables, type DataRunArgs } from '../../../lib/compose/verify-pipeline-groups.js';
import { availableLoad, catalogInput, type CatalogInput } from '../../../lib/kernel/input-state.js';
import type { QuerySpecModel } from '../../../lib/model/query/types.js';
import { buildTcRegistry } from '../../../lib/testcase/registry.js';
import { aggregate, entitySpec, field, role, roleSpec, specModel } from '../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { scanResult } from '../../helpers/trace-builder.js';
import { QUERY_CTX } from '../../helpers/query-builder.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

const GUARDS = QUERY_CTX.guards;

const domain = () =>
  specModel(
    [
      aggregate('workshop', {
        entity: entitySpec('workshop', {
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('organizer_id', { kind: 'ref', entity: 'member' }),
            field('starts_at', { kind: 'datetime' }),
          ],
        }),
      }),
    ],
    roleSpec(['member', role('organizer', 'workshop.organizer_id == actor.id')]),
  );

const CHECK_RATE = { name: 'check_rate', args: [], params: [], kind: 'trigger', lookup: ['organizer_id', 'starts_at'], alsoWrites: [] } as const;

/** lookup を持つ workshops 表(索引は宣言しない = lookup の宣言漏れがある)。 */
const tables = () => dataTableModel([dataTable('workshops', { entity: 'workshop', functions: [CHECK_RATE] })]);

const queriesInput = (selection: 'selected' | 'unselected', model?: QuerySpecModel): CatalogInput<QuerySpecModel> =>
  catalogInput(selection, model === undefined ? undefined : availableLoad(model));

const t2 = (input: Parameters<typeof runDataTableVerification>[0]) => runDataTableVerification(input);
const t2Findings = (result: ReturnType<typeof runDataTableVerification>) => result.findings.filter((finding) => finding.verifier === 'T2');

/** 裏づけに読むほかの種類は、どれも採っていない(T2 の確認なので、裏づけは要らない)。 */
const NO_BACKING = { actions: UNSELECTED, jobs: UNSELECTED, usecases: UNSELECTED, external: UNSELECTED, surface: UNSELECTED } as const;

const base = {
  domain: domain(),
  dataTables: loadedInput(tables()),
  roots: TEST_ROOTS,
  guards: GUARDS,
  registry: buildTcRegistry([]),
  tests: scanResult({ available: true }),
  platform: TEST_PLATFORM,
  layout: TEST_LAYOUT,
  repoRoot: '/nonexistent-repo-root',
  ...NO_BACKING,
};

describe('runDataTableVerification の T2: 入力の状態', () => {
  it('query_spec が読込済み: 欠けなし。lookup の宣言漏れは error', () => {
    const result = t2({ ...base, queries: queriesInput('selected', { available: true, queries: [] }) });

    expect(result.indexGaps).toEqual([]);
    expect(t2Findings(result).map((finding) => finding.message)).toEqual(['workshops に索引 (organizer_id, starts_at) がありません(lookup: check_rate)']);
  });

  it('query_spec が未選択: 欠け(未選択)を返しつつ、lookup の宣言漏れは見る', () => {
    const result = t2({ ...base, queries: queriesInput('unselected') });

    expect(result.indexGaps).toEqual([{ input: 'queries', state: 'unselected' }]);
    expect(t2Findings(result)).toHaveLength(1);
  });

  it('query_spec が阻害: 欠け(理由つき)を返す。「余分な索引」は query 由来が見えないので出さない', () => {
    const withExtra = dataTableModel([
      dataTable('workshops', {
        entity: 'workshop',
        functions: [CHECK_RATE],
        indexes: [
          { name: 'workshops_org_starts_idx', on: ['organizer_id', 'starts_at'], unique: false },
          { name: 'workshops_extra_idx', on: ['starts_at'], unique: false },
        ],
      }),
    ]);

    const result = t2({ ...base, dataTables: loadedInput(withExtra), queries: queriesInput('selected', { available: false, queries: [] }) });

    expect(result.indexGaps).toEqual([{ input: 'queries', state: 'blocked', reason: 'missing' }]);
    expect(t2Findings(result)).toEqual([]);
  });

  it('data_table が使えなければ T 群ごと飛ぶ(索引の欠けは空。飛んだ理由は tablesGap が言う)', () => {
    const unselected = t2({ ...base, dataTables: UNSELECTED, queries: queriesInput('unselected') });
    const missing = t2({ ...base, dataTables: { state: 'blocked', reason: 'missing', findings: [] }, queries: queriesInput('unselected') });

    expect(unselected).toMatchObject({ available: false, findings: [], indexGaps: [], stepGaps: [], tablesGap: { input: 'data_tables', state: 'unselected' } });
    expect(missing).toMatchObject({ available: false, findings: [], indexGaps: [], stepGaps: [], tablesGap: { input: 'data_tables', state: 'blocked', reason: 'missing' } });
  });
});

describe('runDataTables の実行ログ: T2 の未実施 / 阻害の行', () => {
  const args = (queries: CatalogInput<QuerySpecModel>): DataRunArgs => ({
    model: domain(),
    dataTables: loadedInput(tables()),
    queries,
    guards: GUARDS,
    registry: buildTcRegistry([]),
    tests: scanResult({ available: true }),
    ...NO_BACKING,
    roots: TEST_ROOTS,
    platform: TEST_PLATFORM,
    layout: TEST_LAYOUT,
    repoRoot: '/nonexistent-repo-root',
  });
  const logOf = (queries: CatalogInput<QuerySpecModel>): string[] => {
    const lines: string[] = [];
    runDataTables(args(queries), (line) => lines.push(line));
    return lines;
  };

  it('読込済み(0 件)なら T 群の要約行だけ(T2 の行は出ない)', () => {
    const lines = logOf(queriesInput('selected', { available: true, queries: [] }));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('T1〜T18 を実行しました');
  });

  it('未選択なら「T2: 未実施 — …」が要約行の後に出る', () => {
    const lines = logOf(queriesInput('unselected'));

    expect(lines[1]).toBe(
      'T2: 未実施 — 製品が queries を採っていない(product.md の uses に無い)ため、queries から導く索引の要求は見ていません(ほかの入力から導く要求は実行済み)。',
    );
  });

  it('阻害なら「T2: 阻害 — …」が出る', () => {
    const lines = logOf(queriesInput('selected'));

    expect(lines[1]).toContain('T2: 阻害 — queries を採っているが検査へ渡せない(読み込みが行われていない。');
  });
});

describe('runDataTables の実行ログ: 後段が SQL の公開面を API として外へ出す能力を持たない構成', () => {
  const UNSUPPORTED = { ...TEST_PLATFORM, surfaceExposure: { kind: 'unsupported', reason: '権限が SQL の外にある API 層' } } as const;
  const run = (platform: typeof TEST_PLATFORM | typeof UNSUPPORTED) => {
    const lines: string[] = [];
    const args: DataRunArgs = {
      model: domain(),
      dataTables: loadedInput(tables()),
      queries: queriesInput('selected', { available: true, queries: [] }),
      guards: GUARDS,
      registry: buildTcRegistry([]),
      tests: scanResult({ available: true }),
      ...NO_BACKING,
      roots: TEST_ROOTS,
      platform,
      layout: TEST_LAYOUT,
      repoRoot: '/nonexistent-repo-root',
    };
    runDataTables(args, (line) => lines.push(line));
    return { lines, result: runDataTableVerification({ domain: domain(), ...args }) };
  };

  it('能力がある構成(いまの Supabase)では未対応の行は出ない', () => {
    const { lines, result } = run(TEST_PLATFORM);
    expect(result.surfaceUnsupported).toBeNull();
    expect(lines.some((line) => line.includes('未対応'))).toBe(false);
  });

  it('能力が無い構成では「T12: 未対応 — …(理由: 後段の宣言)」を言い、範囲サマリの件数に入る行の形である', () => {
    const { lines, result } = run(UNSUPPORTED);
    expect(result.surfaceUnsupported).toBe('権限が SQL の外にある API 層');
    const line = lines.find((candidate) => candidate.startsWith('T12: 未対応'));
    expect(line).toBe(
      'T12: 未対応 — この構成の後段は SQL の公開面(surface)を API として外へ出す能力を宣言していない(理由: 権限が SQL の外にある API 層)ため、' +
        'SQL の公開面(土台・ビュー)の出どころの判定は行っていません。',
    );
    expect(isCheckRunNote(line ?? '')).toBe(true);
  });
});
