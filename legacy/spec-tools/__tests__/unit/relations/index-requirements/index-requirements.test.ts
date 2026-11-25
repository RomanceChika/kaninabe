/**
 * 索引の要求(関係の層 `lib/relations/index-requirements/` の入口 `deriveIndexRequirements`)のテスト。
 *
 * 見るのは 3 つ。
 *   1. **名前のついた中間表現**: 表ごとに、要る索引(列の順)と**要求元の識別子と位置**(どの query_spec / どの関数の lookup か)
 *   2. **入力の状態**: query_spec / data_table が未選択・阻害のとき、その入力の分は導かず、理由を `gaps` で返す
 *      (使える入力の分は導く)。読込済みで 0 件の空のカタログは阻害ではない
 *   3. **読み手が同じ結果を読む**: 生成側の口(`indexRequirementsOfModels`)は同じ導出で、選択を推定しない
 *
 * 導出規則そのもの(等値・in・via・sort / 畳み込み / 既存の索引による除外)は `index-derivation.test.ts`。
 */

import { describe, expect, it } from 'vitest';
import { verifyIndexExpectations } from '../../../../lib/data/verifiers/t2-index-expectations.js';
import { availableLoad, catalogInput, type CatalogInput } from '../../../../lib/kernel/input-state.js';
import type { Finding } from '../../../../lib/kernel/finding.js';
import { deriveIndexRequirements, indexRequirementsOfModels } from '../../../../lib/relations/index-requirements/index.js';
import type { QuerySpecModel } from '../../../../lib/model/query/types.js';
import type { DataTableSpecModel } from '../../../../lib/model/data/types.js';
import { aggregate, entitySpec, field, role, roleSpec, specModel } from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { QUERY_CTX, querySpec } from '../../../helpers/query-builder.js';

const GUARDS = QUERY_CTX.guards;

/** workshop(organizer_id・starts_at)だけの最小ドメイン。 */
function domain() {
  return specModel(
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
}

const myList = () =>
  querySpec({ name: 'workshop_my_list', source: 'workshop', for: ['member'], via: 'organizer', scopeUsed: 'own', sort: [{ field: 'starts_at' }, { field: 'id' }] });

const CHECK_RATE = { name: 'check_rate', args: [], params: [], kind: 'trigger', lookup: ['organizer_id', 'starts_at'], alsoWrites: [] } as const;

/** lookup を持つ workshops 表 1 枚のモデル。 */
const withLookup = (extra: Parameters<typeof dataTable>[1] = {}): DataTableSpecModel =>
  dataTableModel([dataTable('workshops', { entity: 'workshop', functions: [CHECK_RATE], ...extra })]);

/** 読込済みの入力(選択済み)。 */
const loaded = <T extends { readonly available: boolean }>(model: T): CatalogInput<T> => catalogInput('selected', availableLoad(model));

const queries = (list: QuerySpecModel['queries'] = [myList()]): QuerySpecModel => ({ available: true, queries: list });

describe('名前のついた中間表現(IndexRequirements)', () => {
  it('表ごとに、要る索引(列の順)と要求元の識別子・種類・位置を持つ(前方一致しない要求は別の索引)', () => {
    const scan = { name: 'scan_due', args: [], params: [], kind: 'rpc', lookup: ['starts_at'], alsoWrites: [] } as const;
    const { requirements, gaps } = deriveIndexRequirements({
      domain: domain(),
      guards: GUARDS,
      queries: loaded(queries()),
      dataTables: loaded(withLookup({ functions: [scan] })),
    });

    expect(gaps).toEqual([]);
    expect(requirements.candidates).toEqual([
      {
        table: 'workshops',
        columns: ['organizer_id', 'starts_at', 'id'],
        queries: ['workshop_my_list'],
        lookups: [],
        origins: [{ kind: 'query', name: 'workshop_my_list', location: { file: 'docs/specs/backend/queries/workshop/workshop_my_list.md' } }],
      },
      {
        table: 'workshops',
        columns: ['starts_at'],
        queries: [],
        lookups: ['scan_due'],
        origins: [{ kind: 'lookup', name: 'scan_due', location: { file: 'docs/specs/backend/data/tables/workshops.md', pointer: 'functions.scan_due.lookup' } }],
      },
    ]);
  });

  it('前方一致で畳まれた索引は、要求元を全部(query が先・名前順)持つ', () => {
    const long = querySpec({ name: 'b_long', source: 'workshop', for: ['member'], scopeUsed: 'all', sort: [{ field: 'organizer_id' }, { field: 'starts_at' }] });
    const short = querySpec({ name: 'a_short', source: 'workshop', for: ['member'], scopeUsed: 'all', sort: [{ field: 'organizer_id' }] });

    const { requirements } = deriveIndexRequirements({
      domain: domain(),
      guards: GUARDS,
      queries: loaded(queries([short, long])),
      dataTables: loaded(withLookup()),
    });

    expect(requirements.candidates).toHaveLength(1);
    const [only] = requirements.candidates;
    expect(only?.columns).toEqual(['organizer_id', 'starts_at']);
    expect(only?.queries).toEqual(['a_short', 'b_long']);
    expect(only?.lookups).toEqual(['check_rate']);
    expect(only?.origins.map((origin) => `${origin.kind}:${origin.name}`)).toEqual(['query:a_short', 'query:b_long', 'lookup:check_rate']);
  });

  it('期待(expected)は既存の索引による除外の後・候補(candidates)は除外の前', () => {
    const declared = withLookup({ indexes: [{ name: 'workshops_org_starts_unique', on: ['organizer_id', 'starts_at'], unique: true }] });

    const { requirements } = deriveIndexRequirements({ domain: domain(), guards: GUARDS, queries: loaded(queries([])), dataTables: loaded(declared) });

    expect(requirements.candidates.map((candidate) => candidate.columns)).toEqual([['organizer_id', 'starts_at']]);
    expect(requirements.expected).toEqual([]);
  });
});

describe('入力の状態: 使えない入力の分は導かず、理由を返す', () => {
  const derive = (queriesInput: CatalogInput<QuerySpecModel>, dataInput: CatalogInput<DataTableSpecModel>) =>
    deriveIndexRequirements({ domain: domain(), guards: GUARDS, queries: queriesInput, dataTables: dataInput });
  const columnsOf = (list: readonly { readonly columns: readonly string[] }[]) => list.map((entry) => entry.columns.join(','));

  it('query_spec が未選択: query の要求は導かず(未選択と理由を返し)、関数の lookup の要求は導く', () => {
    const result = derive(catalogInput('unselected'), loaded(withLookup()));

    expect(result.gaps).toEqual([{ input: 'queries', state: 'unselected' }]);
    expect(columnsOf(result.requirements.candidates)).toEqual(['organizer_id,starts_at']);
    expect(columnsOf(result.requirements.expected)).toEqual(['organizer_id,starts_at']);
  });

  it.each([
    ['読み込みが無い', catalogInput<QuerySpecModel>('selected'), 'not-loaded'],
    ['置き場に仕様が無い', catalogInput<QuerySpecModel>('selected', availableLoad({ available: false, queries: [] })), 'missing'],
    ['読めない', catalogInput<QuerySpecModel>('selected', { model: { available: true, catalog: null }, findings: [], dropped: 0 }), 'load-failed'],
    ['読めずに捨てた仕様がある', catalogInput<QuerySpecModel>('selected', availableLoad(queries(), [ERROR], 1)), 'invalid'],
  ] as const)('query_spec が阻害(%s): その分は導かず、理由(%s)を返す', (_label, queriesInput, reason) => {
    const result = derive(queriesInput, loaded(withLookup()));

    expect(result.gaps).toEqual([{ input: 'queries', state: 'blocked', reason }]);
    expect(columnsOf(result.requirements.candidates)).toEqual(['organizer_id,starts_at']);
  });

  it('data_table が阻害: lookup は読めず、既存の索引が分からないので期待は空・query の候補だけ導く', () => {
    const result = derive(loaded(queries()), catalogInput<DataTableSpecModel>('selected', availableLoad({ available: false, tables: [] })));

    expect(result.gaps).toEqual([{ input: 'data_tables', state: 'blocked', reason: 'missing' }]);
    expect(columnsOf(result.requirements.candidates)).toEqual(['organizer_id,starts_at,id']);
    expect(result.requirements.expected).toEqual([]);
  });

  it('data_table が未選択: 期待は空・未選択を返す', () => {
    const result = derive(loaded(queries()), catalogInput('unselected'));

    expect(result.gaps).toEqual([{ input: 'data_tables', state: 'unselected' }]);
    expect(result.requirements.expected).toEqual([]);
  });

  it('両方が使えなければ何も導かず、2 つとも名指す(query → data_table の順)', () => {
    const result = derive(catalogInput('unselected'), catalogInput<DataTableSpecModel>('selected'));

    expect(result).toEqual({
      requirements: { candidates: [], expected: [] },
      gaps: [
        { input: 'queries', state: 'unselected' },
        { input: 'data_tables', state: 'blocked', reason: 'not-loaded' },
      ],
    });
  });

  it('両方が読込済みで 0 件なら、要求 0 件・欠け 0 件(0 件の読込済みは阻害と違う)', () => {
    const result = derive(loaded(queries([])), loaded(dataTableModel([])));

    expect(result).toEqual({ requirements: { candidates: [], expected: [] }, gaps: [] });
  });
});

describe('生成側の口(indexRequirementsOfModels)は同じ導出で、選択を推定しない', () => {
  it('入口と同じ結果を返す(別の導出を持たない)', () => {
    const viaEntrance = deriveIndexRequirements({ domain: domain(), guards: GUARDS, queries: loaded(queries()), dataTables: loaded(withLookup()) });

    expect(indexRequirementsOfModels(domain(), GUARDS, { queries: queries(), dataTables: withLookup() })).toEqual(viaEntrance);
  });

  it('モデルが無い(undefined)は読み込みが無い・available: false は置き場に仕様が無い、として阻害で返す', () => {
    expect(indexRequirementsOfModels(domain(), GUARDS, { dataTables: withLookup() }).gaps).toEqual([{ input: 'queries', state: 'blocked', reason: 'not-loaded' }]);
    expect(indexRequirementsOfModels(domain(), GUARDS, { queries: { available: false, queries: [] }, dataTables: withLookup() }).gaps).toEqual([
      { input: 'queries', state: 'blocked', reason: 'missing' },
    ]);
    expect(indexRequirementsOfModels(domain(), GUARDS, { queries: queries() }).gaps).toEqual([{ input: 'data_tables', state: 'blocked', reason: 'not-loaded' }]);
  });
});

/** 読み込みの error 1 件。 */
const ERROR: Finding = { verifier: 'Q0', severity: 'error', message: 'broken', location: { file: 'q.md' }, suggestion: 'fix' };


// Regression: hold the declared long index fixed, remove only query knowledge.
it('blocked query retains coverage by a declared longer prefix index', () => {
  const data = withLookup({ indexes: [{ name: 'workshops_org_starts_id_idx', on: ['organizer_id', 'starts_at', 'id'], unique: false }] });
  const complete = deriveIndexRequirements({ domain: domain(), guards: GUARDS, queries: loaded(queries()), dataTables: loaded(data) });
  expect(verifyIndexExpectations(complete, data)).toEqual([]);
  const partial = deriveIndexRequirements({ domain: domain(), guards: GUARDS,
    queries: { state: 'blocked', reason: 'invalid', findings: [ERROR] }, dataTables: loaded(data) });
  expect(partial.gaps).toEqual([{ input: 'queries', state: 'blocked', reason: 'invalid' }]);
  expect(partial.requirements.expected.map((entry) => entry.columns)).toEqual([['organizer_id', 'starts_at']]);
  expect(verifyIndexExpectations(partial, data)).toEqual([]);
});


it.each([
  ['missing', []],
  ['wrong order', ['starts_at', 'organizer_id', 'id']],
  ['too short', ['organizer_id']],
])('blocked query still reports a genuinely uncovered lookup: %s', (_label, columns) => {
  const data = withLookup({ indexes: columns.length === 0 ? [] : [{ name: 'existing_idx', on: columns, unique: false }] });
  const derived = deriveIndexRequirements({ domain: domain(), guards: GUARDS,
    queries: { state: 'blocked', reason: 'invalid', findings: [ERROR] }, dataTables: loaded(data) });
  expect(verifyIndexExpectations(derived, data).filter((finding) => finding.severity === 'error')).toHaveLength(1);
});

it('loaded empty queries retain the existing exact-match contract', () => {
  const data = withLookup({ indexes: [{ name: 'long_idx', on: ['organizer_id', 'starts_at', 'id'], unique: false }] });
  const derived = deriveIndexRequirements({ domain: domain(), guards: GUARDS, queries: loaded(queries([])), dataTables: loaded(data) });
  expect(derived.gaps).toEqual([]);
  expect(verifyIndexExpectations(derived, data).filter((finding) => finding.severity === 'error')).toHaveLength(1);
});
