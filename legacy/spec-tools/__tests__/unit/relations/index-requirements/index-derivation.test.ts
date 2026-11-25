/**
 * 索引の導出(関係の層 `relations/index-requirements/` の `index-derivation.ts` と `exclusion.ts`)の規約網羅テスト。
 * 入口(`index.ts`)を通して見る。要求元の位置・入力の状態は同じ層の `index-requirements.test.ts`。
 * 関数の本文が引く索引(`functions[].lookup`)も同じ導出に載る(末尾の describe)。
 *
 * 対象の要求(設計メモ ⑪d / ARCH-SP-BE-0001 §テーブル仕様「indexes は導出する」):
 *   - 等値・in の filters + via のスコープ条件(自表内の列だけ)+ 並び順の列から索引候補を作る
 *   - 等値条件に主キー(id)が現れたら候補を作らない(高々 1 行に定まるため)
 *   - 同一テーブルで前方一致する候補は長い方に畳む
 *   - 主キー・(部分述語を持たない)一意な先頭一致・FK 列 1 本の既存索引は除外する
 */

import { describe, expect, it } from 'vitest';
import { indexRequirementsOfModels } from '../../../../lib/relations/index-requirements/index.js';
import type { IndexRequirement } from '../../../../lib/relations/index-requirements/index.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import type { GuardServices } from '../../../../lib/guard/ast.js';
import type { QuerySpecModel } from '../../../../lib/model/query/types.js';
import type { DataTableSpecModel } from '../../../../lib/model/data/types.js';
import { aggregate, entitySpec, field, role, roleSpec, specModel } from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { QUERY_CTX, querySpec } from '../../../helpers/query-builder.js';

const GUARDS = QUERY_CTX.guards;

/** 要求元の位置(`origins`)はここでは見ない(名前の並びと列の並びだけを突き合わせる)。 */
const withoutOrigins = (list: readonly IndexRequirement[]) => list.map(({ origins: _origins, ...rest }) => rest);

/** 畳み込み後の候補(既存の索引による除外の前)。 */
function deriveIndexCandidates(model: SpecModel, queries: QuerySpecModel, guards: GuardServices, dataTables?: DataTableSpecModel) {
  const models = dataTables === undefined ? { queries } : { queries, dataTables };
  return withoutOrigins(indexRequirementsOfModels(model, guards, models).requirements.candidates);
}

/** data_table に新たに宣言が要る索引(既存の索引による除外の後)。 */
function deriveExpectedIndexes(model: SpecModel, queries: QuerySpecModel, guards: GuardServices, dataTables: DataTableSpecModel) {
  return withoutOrigins(indexRequirementsOfModels(model, guards, { queries, dataTables }).requirements.expected);
}

/** entry(workshop_id・owner_id・state を持つ) + workshop(organizer_id) の最小ドメイン。 */
function domain() {
  return specModel(
    [
      aggregate('entry', {
        entity: entitySpec('entry', {
          context: { workshop: 'entry.workshop_id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('workshop_id', { kind: 'ref', entity: 'workshop' }),
            field('owner_id', { kind: 'ref', entity: 'member' }),
            field('state', { kind: 'state', machine: 'entry' }),
          ],
        }),
      }),
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
    roleSpec(['member', role('organizer', 'workshop.organizer_id == actor.id'), role('entry_owner', 'entry.owner_id == actor.id')]),
  );
}

describe('rawIndexCandidate 相当(deriveIndexCandidates 経由)', () => {
  it('filters の等値・in 列 + sort の列から候補を作る', () => {
    const model = domain();
    const query = querySpec({
      name: 'entry_list',
      source: 'entry',
      for: ['member'],
      scopeUsed: 'context(workshop)',
      params: [{ name: 'workshop_id', ref: 'entry.workshop_id' }],
      filters: ['entry.workshop_id == param.workshop_id', 'state in [submitted, confirmed]'],
      sort: [{ field: 'created_at' }, { field: 'id' }],
    });

    const candidates = deriveIndexCandidates(model, { available: true, queries: [query] }, GUARDS);

    expect(candidates).toEqual([
      { table: 'entries', columns: ['workshop_id', 'state', 'created_at', 'id'], queries: ['entry_list'], lookups: [] },
    ]);
  });

  it('via が自表内の列に解決するときは等値列の先頭に足す', () => {
    const model = domain();
    const query = querySpec({
      name: 'workshop_my_list',
      source: 'workshop',
      for: ['member'],
      via: 'organizer',
      scopeUsed: 'own',
      sort: [{ field: 'starts_at' }, { field: 'id' }],
    });

    const candidates = deriveIndexCandidates(model, { available: true, queries: [query] }, GUARDS);

    expect(candidates).toEqual([
      { table: 'workshops', columns: ['organizer_id', 'starts_at', 'id'], queries: ['workshop_my_list'], lookups: [] },
    ]);
  });

  it('via が context を跨ぐ(別表の列)ときはその表の候補に混ぜない', () => {
    const model = domain();
    const query = querySpec({
      name: 'entry_organizer_list',
      source: 'entry',
      for: ['member'],
      via: 'organizer', // workshop.organizer_id == actor.id → entries 自身の列ではない
      scopeUsed: 'context(workshop)',
      sort: [{ field: 'created_at' }],
    });

    const candidates = deriveIndexCandidates(model, { available: true, queries: [query] }, GUARDS);

    expect(candidates).toEqual([{ table: 'entries', columns: ['created_at'], queries: ['entry_organizer_list'], lookups: [] }]);
  });

  it('等値条件に主キー(id)が含まれる候補は作らない', () => {
    const model = domain();
    const query = querySpec({
      name: 'workshop_organizer_detail',
      source: 'workshop',
      for: ['member'],
      via: 'organizer',
      scopeUsed: 'own',
      returns: 'one',
      params: [{ name: 'workshop_id', ref: 'workshop.id' }],
      filters: ['id == param.workshop_id'],
    });

    expect(deriveIndexCandidates(model, { available: true, queries: [query] }, GUARDS)).toEqual([]);
  });

  it('等値・sort の両方に同じ列があれば 1 回だけ数える', () => {
    const model = domain();
    const query = querySpec({
      name: 'entry_own_list',
      source: 'entry',
      for: ['member'],
      via: 'entry_owner',
      scopeUsed: 'own',
      filters: ['state in [draft, submitted]'],
      sort: [{ field: 'state' }, { field: 'created_at' }],
    });

    const candidates = deriveIndexCandidates(model, { available: true, queries: [query] }, GUARDS);

    expect(candidates).toEqual([
      { table: 'entries', columns: ['owner_id', 'state', 'created_at'], queries: ['entry_own_list'], lookups: [] },
    ]);
  });

  it('前方一致する候補は長い方に畳み、両方の query 名を持つ', () => {
    const model = domain();
    const shortQuery = querySpec({
      name: 'entry_short',
      source: 'entry',
      for: ['member'],
      scopeUsed: 'all',
      filters: ['state in [submitted]'],
    });
    const longQuery = querySpec({
      name: 'entry_long',
      source: 'entry',
      for: ['member'],
      scopeUsed: 'all',
      filters: ['state in [submitted]'],
      sort: [{ field: 'created_at' }],
    });

    const candidates = deriveIndexCandidates(model, { available: true, queries: [shortQuery, longQuery] }, GUARDS);

    expect(candidates).toEqual([
      { table: 'entries', columns: ['state', 'created_at'], queries: ['entry_long', 'entry_short'], lookups: [] },
    ]);
  });

  it('前方一致しない(先頭列が違う)候補は畳まず両方残す', () => {
    const model = domain();
    const byState = querySpec({
      name: 'entry_by_state',
      source: 'entry',
      for: ['member'],
      scopeUsed: 'all',
      filters: ['state in [submitted]'],
    });
    const byOwner = querySpec({
      name: 'entry_own_list',
      source: 'entry',
      for: ['member'],
      via: 'entry_owner',
      scopeUsed: 'own',
    });

    const candidates = deriveIndexCandidates(model, { available: true, queries: [byState, byOwner] }, GUARDS);

    expect(candidates).toHaveLength(2);
  });

  it('等値・sort のどちらも無ければ候補を作らない', () => {
    const model = domain();
    const query = querySpec({ name: 'entry_all', source: 'entry', for: ['member'], scopeUsed: 'all' });

    expect(deriveIndexCandidates(model, { available: true, queries: [query] }, GUARDS)).toEqual([]);
  });
});

describe('deriveExpectedIndexes(既存索引による除外)', () => {
  it('列がちょうど一致する既存の一意索引があれば除外する', () => {
    const model = domain();
    const query = querySpec({
      name: 'entry_by_state',
      source: 'entry',
      for: ['member'],
      scopeUsed: 'all',
      filters: ['state in [submitted]'],
    });
    const dataTables = dataTableModel([
      dataTable('entries', { entity: 'entry', indexes: [{ name: 'entries_state_unique', on: ['state'], unique: true }] }),
    ]);

    expect(deriveExpectedIndexes(model, { available: true, queries: [query] }, GUARDS, dataTables)).toEqual([]);
  });

  it('部分述語を持つ一意索引(where 付き)は除外に使わない', () => {
    const model = domain();
    const query = querySpec({
      name: 'entry_by_owner_state',
      source: 'entry',
      for: ['member'],
      via: 'entry_owner',
      scopeUsed: 'own',
      filters: ['state in [submitted]'],
    });
    const dataTables = dataTableModel([
      dataTable('entries', {
        entity: 'entry',
        indexes: [{ name: 'entries_owner_open_unique', on: ['owner_id'], unique: true, where: "state = 'draft'" }],
      }),
    ]);

    const expected = deriveExpectedIndexes(model, { available: true, queries: [query] }, GUARDS, dataTables);

    expect(expected).toEqual([{ table: 'entries', columns: ['owner_id', 'state'], queries: ['entry_by_owner_state'], lookups: [] }]);
  });

  it('候補の先頭だけを覆う単独索引(FK 支援等)は除外しない — 複合索引は別に要る', () => {
    const model = domain();
    const query = querySpec({
      name: 'workshop_my_list',
      source: 'workshop',
      for: ['member'],
      via: 'organizer',
      scopeUsed: 'own',
      sort: [{ field: 'starts_at' }, { field: 'id' }],
    });
    const dataTables = dataTableModel([
      dataTable('workshops', {
        entity: 'workshop',
        foreignKeys: [{ column: 'organizer_id', references: 'members', onDelete: 'no_action' }],
        indexes: [{ name: 'workshops_organizer_id_idx', on: ['organizer_id'], unique: false }],
      }),
    ]);

    const expected = deriveExpectedIndexes(model, { available: true, queries: [query] }, GUARDS, dataTables);

    expect(expected).toEqual([
      { table: 'workshops', columns: ['organizer_id', 'starts_at', 'id'], queries: ['workshop_my_list'], lookups: [] },
    ]);
  });

  it('候補と列がちょうど一致する FK 索引(単独・非一意)は除外する', () => {
    const model = domain();
    const query = querySpec({
      name: 'entry_by_workshop',
      source: 'entry',
      for: ['member'],
      scopeUsed: 'all',
      filters: ['entry.workshop_id == param.workshop_id'],
      params: [{ name: 'workshop_id', ref: 'entry.workshop_id' }],
    });
    const dataTables = dataTableModel([
      dataTable('entries', {
        entity: 'entry',
        foreignKeys: [{ column: 'workshop_id', references: 'workshops', onDelete: 'cascade' }],
        indexes: [{ name: 'entries_workshop_id_idx', on: ['workshop_id'], unique: false }],
      }),
    ]);

    expect(deriveExpectedIndexes(model, { available: true, queries: [query] }, GUARDS, dataTables)).toEqual([]);
  });
});

describe('関数の lookup(本文が自表を引く列)も同じ導出に載る', () => {
  const NO_QUERIES = { available: false, queries: [] } as const;
  const lookupTable = (name: string, lookup: readonly string[], extra: Parameters<typeof dataTable>[1] = {}) =>
    dataTable('entries', {
      entity: 'entry',
      functions: [{ name, args: [], params: [], kind: 'trigger', lookup, alsoWrites: [] }],
      ...extra,
    });

  it('lookup は列の並びのまま期待索引になり、要求元は lookups に入る(query は空)', () => {
    const dataTables = dataTableModel([lookupTable('check_rate', ['sender_email', 'created_at'])]);

    expect(deriveIndexCandidates(domain(), NO_QUERIES, GUARDS, dataTables)).toEqual([
      { table: 'entries', columns: ['sender_email', 'created_at'], queries: [], lookups: ['check_rate'] },
    ]);
  });

  it('data_table を渡さなければ lookup は加わらない(query 側だけで閉じた計算のまま)', () => {
    expect(deriveIndexCandidates(domain(), NO_QUERIES, GUARDS)).toEqual([]);
  });

  it('lookup と query の候補が前方一致すれば長い方に畳み、要求元は両方を持つ', () => {
    const query = querySpec({
      name: 'entry_by_state',
      source: 'entry',
      for: ['member'],
      scopeUsed: 'all',
      filters: ['state in [submitted]'],
    });
    const dataTables = dataTableModel([lookupTable('scan_due', ['state', 'created_at'])]);

    expect(deriveIndexCandidates(domain(), { available: true, queries: [query] }, GUARDS, dataTables)).toEqual([
      { table: 'entries', columns: ['state', 'created_at'], queries: ['entry_by_state'], lookups: ['scan_due'] },
    ]);
  });

  it('lookup も既存の索引による除外に通る(列がちょうど一致する一意索引があれば要らない)', () => {
    const dataTables = dataTableModel([
      lookupTable('claim', ['state'], { indexes: [{ name: 'entries_state_unique', on: ['state'], unique: true }] }),
    ]);

    expect(deriveExpectedIndexes(domain(), NO_QUERIES, GUARDS, dataTables)).toEqual([]);
  });

  it('lookup の先頭が部分述語を持たない一意索引なら除外する(残りの列は区別に要らない)', () => {
    const dataTables = dataTableModel([
      lookupTable('claim', ['code', 'created_at'], { indexes: [{ name: 'entries_code_unique', on: ['code'], unique: true }] }),
    ]);

    expect(deriveExpectedIndexes(domain(), NO_QUERIES, GUARDS, dataTables)).toEqual([]);
  });
});
