/**
 * テストケース ID 台帳(lib/spec-index)のテスト。
 *
 * 台帳の責務は「全仕様種の test_cases を 1 つの索引に集める」ことであり、
 * ここではその集約(sources.ts)・引き方(registry.ts)・仕様種を持たない環境での
 * 振る舞いを確かめる。台帳を使う検査そのもの(A6 の orphan / A9 の一意性 / Q6 の突合)は
 * 各検証器のテストが担う。
 */

import { describe, expect, it } from 'vitest';
import { buildTcRegistry } from '../../../lib/testcase/registry.js';
import { collectTcEntries } from '../../../lib/spec-index/sources.js';
import { actionSpec, testCase } from '../../helpers/trace-builder.js';
import { querySpec } from '../../helpers/query-builder.js';
import { screenSpec } from '../../helpers/screen-builder.js';

const IMPL = 'app/src/operation/__tests__/entry/submit.test.ts::下書きから提出できる';

/** action_spec 1 件(テストケース ID を指定できる)。 */
function action(handles: string, ...ids: readonly string[]) {
  return actionSpec({
    handles,
    testCases: ids.map((id) => testCase({ id, implementation: IMPL, covers: ['success'] })),
  });
}

/** query_spec 1 件(テストケース ID を指定できる)。 */
function query(name: string, ...ids: readonly string[]) {
  return querySpec({
    name,
    source: 'workshop',
    for: ['member'],
    scopeUsed: 'all',
    testCases: ids.map((id) => testCase({ id, implementation: IMPL, type: 'integration' })),
  });
}

/** screen_spec 1 件(テストケース ID を指定できる)。 */
function screen(name: string, ...ids: readonly string[]) {
  return screenSpec({
    name,
    testCases: ids.map((id) => testCase({ id, implementation: IMPL })),
  });
}

/** action_spec / query_spec / screen_spec を材料に台帳を作る(CLI と同じ組み立て)。 */
function registry(
  actions: readonly ReturnType<typeof action>[],
  queries: readonly ReturnType<typeof query>[] = [],
  screens: readonly ReturnType<typeof screen>[] = [],
) {
  return buildTcRegistry(
    collectTcEntries({
      actions: { actions, unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
      queries: { available: true, queries },
      screens: { available: true, screens, chromes: [], unexposed: [], unreachableStates: [], unseenStates: [] },
    }),
  );
}

describe('テストケース ID 台帳', () => {
  it('全仕様種の test_cases を 1 つの台帳に集める', () => {
    const built = registry(
      [action('entry.submit', 'TC-ENTRY-SUBMIT-001')],
      [query('workshop_list', 'TC-WORKSHOP-LIST-001')],
    );

    expect(built.entries.map((entry) => entry.tcId)).toEqual([
      'TC-ENTRY-SUBMIT-001',
      'TC-WORKSHOP-LIST-001',
    ]);
    expect(built.entries.map((entry) => entry.specKind)).toEqual(['action_spec', 'query_spec']);
  });

  it('エントリは宣言元(仕様 ID・ファイル)と宣言の中身を持つ', () => {
    const built = registry([action('entry.submit', 'TC-ENTRY-SUBMIT-001')]);
    const entry = built.entries[0];

    expect(entry).toMatchObject({
      tcId: 'TC-ENTRY-SUBMIT-001',
      specKind: 'action_spec',
      specId: 'entry-submit-action',
      specFile: 'docs/specs/backend/actions/entry/submit.md',
    });
    expect(entry?.implementation.raw).toBe(IMPL);
    expect(entry?.location.pointer).toBe('test_cases.TC-ENTRY-SUBMIT-001');
  });

  it('has / find は仕様種を問わず宣言を引く', () => {
    const built = registry(
      [action('entry.submit', 'TC-ENTRY-SUBMIT-001')],
      [query('workshop_list', 'TC-WORKSHOP-LIST-001')],
    );

    expect(built.has('TC-ENTRY-SUBMIT-001')).toBe(true);
    expect(built.has('TC-ENTRY-SUBMIT-999')).toBe(false);
    expect(built.find('TC-WORKSHOP-LIST-001').map((entry) => entry.specId)).toEqual([
      'query-workshop-list',
    ]);
    expect(built.find('TC-ENTRY-SUBMIT-999')).toEqual([]);
  });

  it('screen_spec の宣言も同じ台帳に載る', () => {
    const built = registry(
      [action('entry.submit', 'TC-ENTRY-SUBMIT-001')],
      [],
      [screen('workshop_detail', 'TC-SCREEN-DETAIL-001')],
    );

    expect(built.ofKind('screen_spec').map((entry) => entry.specId)).toEqual([
      'screen-workshop-detail',
    ]);
    expect(built.has('TC-SCREEN-DETAIL-001')).toBe(true);
    // 仕様種をまたぐ重複も 1 つの台帳で見える(A9 の母集合)。
    expect(registry([action('entry.submit', 'TC-X-Y-001')], [], [screen('a', 'TC-X-Y-001')]).duplicates()).toHaveLength(1);
  });

  it('ofKind は仕様種でエントリを絞る', () => {
    const built = registry(
      [action('entry.submit', 'TC-ENTRY-SUBMIT-001')],
      [query('workshop_list', 'TC-WORKSHOP-LIST-001')],
    );

    expect(built.ofKind('query_spec').map((entry) => entry.tcId)).toEqual(['TC-WORKSHOP-LIST-001']);
    expect(built.ofKind('action_spec').map((entry) => entry.tcId)).toEqual(['TC-ENTRY-SUBMIT-001']);
  });

  it('duplicates は同じ ID の宣言を仕様種をまたいでまとめる', () => {
    const built = registry(
      [action('entry.submit', 'TC-ENTRY-SUBMIT-001')],
      [query('workshop_list', 'TC-ENTRY-SUBMIT-001')],
    );

    const duplicates = built.duplicates();

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.tcId).toBe('TC-ENTRY-SUBMIT-001');
    expect(duplicates[0]?.entries.map((entry) => entry.specKind)).toEqual([
      'action_spec',
      'query_spec',
    ]);
  });

  it('重複が無ければ duplicates は空', () => {
    const built = registry(
      [action('entry.submit', 'TC-ENTRY-SUBMIT-001')],
      [query('workshop_list', 'TC-WORKSHOP-LIST-001')],
    );

    expect(built.duplicates()).toEqual([]);
  });

  it('境界: 材料を 1 つも渡さなくても空の台帳ができる', () => {
    const built = buildTcRegistry(collectTcEntries({}));

    expect(built.entries).toEqual([]);
    expect(built.has('TC-ENTRY-SUBMIT-001')).toBe(false);
    expect(built.duplicates()).toEqual([]);
  });

  it('境界: 読めなかった仕様種(null)は宣言 0 件として扱う', () => {
    const built = buildTcRegistry(
      collectTcEntries({ actions: null, queries: { available: true, queries: [query('workshop_list', 'TC-WORKSHOP-LIST-001')] } }),
    );

    expect(built.entries.map((entry) => entry.tcId)).toEqual(['TC-WORKSHOP-LIST-001']);
  });

  it('境界: 仕様はあるが test_cases が 0 件なら台帳は空', () => {
    expect(registry([action('entry.submit')], [query('workshop_list')]).entries).toEqual([]);
  });
});

describe('retiredReuses(欠番の再利用。A9 の材料)', () => {
  const RETIRED_LOCATION = { file: 'docs/specs/backend/actions/entry/withdraw.md', pointer: 'retired.TC-X-Y-001' };

  it('欠番にした ID を再利用している宣言があれば拾う', () => {
    const built = buildTcRegistry(
      collectTcEntries({ actions: { actions: [action('entry.submit', 'TC-X-Y-001')], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] } }),
      [{ tcId: 'TC-X-Y-001', location: RETIRED_LOCATION }],
    );

    const reuses = built.retiredReuses();

    expect(reuses).toHaveLength(1);
    expect(reuses[0]?.tcId).toBe('TC-X-Y-001');
    expect(reuses[0]?.retiredAt).toEqual(RETIRED_LOCATION);
    expect(reuses[0]?.reusedBy.map((entry) => entry.tcId)).toEqual(['TC-X-Y-001']);
  });

  it('再利用が無ければ空', () => {
    const built = buildTcRegistry(
      collectTcEntries({ actions: { actions: [action('entry.submit', 'TC-ENTRY-SUBMIT-001')], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] } }),
      [{ tcId: 'TC-X-Y-001', location: RETIRED_LOCATION }],
    );

    expect(built.retiredReuses()).toEqual([]);
  });

  it('境界: retired を渡さなくても壊れない(既定は空)', () => {
    const built = buildTcRegistry(collectTcEntries({}));

    expect(built.retiredReuses()).toEqual([]);
  });
});
