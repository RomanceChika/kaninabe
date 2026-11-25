/**
 * T2(索引の期待値)の規約網羅テスト。
 * 対象の要求(ARCH-SP-BE-0001 §テーブル仕様「indexes は導出する」):
 *   - query_spec から導いた期待索引が data_table の indexes: に無ければエラー
 *   - indexes: にあるが期待索引にも PK/一意制約/FK 索引にも当たらない索引は warning
 *   - query_spec が読めない環境では query 由来を見ない(余分の warning も出さない)
 *   - 関数の `lookup` も同じ導出に載る: 索引が無ければ error・あれば違反なし・要求元は lookup として名指す
 */

import { describe, expect, it } from 'vitest';
import { verifyIndexExpectations as verifyDerived } from '../../../../lib/data/verifiers/t2-index-expectations.js';
import { indexRequirementsOfModels } from '../../../../lib/relations/index-requirements/index.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import type { GuardServices } from '../../../../lib/guard/ast.js';
import type { QuerySpecModel } from '../../../../lib/model/query/types.js';
import type { DataTableSpecModel } from '../../../../lib/model/data/types.js';
import { aggregate, entitySpec, field, role, roleSpec, specModel } from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { QUERY_CTX, querySpec } from '../../../helpers/query-builder.js';

const GUARDS = QUERY_CTX.guards;

/** 関係の層(索引の要求の導出)を通して T2 を呼ぶ(実際の配線と同じ 2 段)。 */
function verifyIndexExpectations(domain: SpecModel, dataTables: DataTableSpecModel, queries: QuerySpecModel, guards: GuardServices) {
  return verifyDerived(indexRequirementsOfModels(domain, guards, { queries, dataTables }), dataTables);
}

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

function myListQuery() {
  return querySpec({
    name: 'workshop_my_list',
    source: 'workshop',
    for: ['member'],
    via: 'organizer',
    scopeUsed: 'own',
    sort: [{ field: 'starts_at' }, { field: 'id' }],
  });
}

describe('T2 索引の期待値', () => {
  it('期待索引が indexes: に宣言されていれば違反なし', () => {
    const dataTables = dataTableModel([
      dataTable('workshops', {
        entity: 'workshop',
        indexes: [{ name: 'workshops_organizer_id_starts_at_id_idx', on: ['organizer_id', 'starts_at', 'id'], unique: false }],
      }),
    ]);

    const findings = verifyIndexExpectations(domain(), dataTables, { available: true, queries: [myListQuery()] }, GUARDS);

    expect(findings).toEqual([]);
  });

  it('期待索引が無ければエラー(宣言漏れ)', () => {
    const dataTables = dataTableModel([dataTable('workshops', { entity: 'workshop' })]);

    const findings = verifyIndexExpectations(domain(), dataTables, { available: true, queries: [myListQuery()] }, GUARDS);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      verifier: 'T2',
      severity: 'error',
      message: 'workshops に索引 (organizer_id, starts_at, id) がありません(query: workshop_my_list)',
    });
  });

  it('query_spec からは要求されない索引は warning(理由を促す)', () => {
    const dataTables = dataTableModel([
      dataTable('workshops', {
        entity: 'workshop',
        indexes: [
          { name: 'workshops_organizer_id_starts_at_id_idx', on: ['organizer_id', 'starts_at', 'id'], unique: false },
          { name: 'workshops_unused_idx', on: ['starts_at'], unique: false },
        ],
      }),
    ]);

    const findings = verifyIndexExpectations(domain(), dataTables, { available: true, queries: [myListQuery()] }, GUARDS);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'T2', severity: 'warning' });
    expect(findings[0]?.message).toContain('workshops_unused_idx');
  });

  it('一意制約・FK 単独索引は warning の対象にしない', () => {
    const dataTables = dataTableModel([
      dataTable('workshops', {
        entity: 'workshop',
        foreignKeys: [{ column: 'organizer_id', references: 'members', onDelete: 'no_action' }],
        indexes: [
          { name: 'workshops_organizer_id_starts_at_id_idx', on: ['organizer_id', 'starts_at', 'id'], unique: false },
          { name: 'workshops_organizer_id_idx', on: ['organizer_id'], unique: false },
          { name: 'workshops_code_unique', on: ['code'], unique: true },
        ],
      }),
    ]);

    const findings = verifyIndexExpectations(domain(), dataTables, { available: true, queries: [myListQuery()] }, GUARDS);

    expect(findings).toEqual([]);
  });

  it('query_spec が読めない環境ではスキップする', () => {
    const dataTables = dataTableModel([dataTable('workshops', { entity: 'workshop' })]);

    expect(verifyIndexExpectations(domain(), dataTables, { available: false, queries: [] }, GUARDS)).toEqual([]);
  });

  describe('関数の lookup(本文が自表を引く列)', () => {
    const NO_QUERIES = { available: false, queries: [] } as const;
    const rateLimit = {
      name: 'check_rate',
      args: [],
      params: [],
      kind: 'trigger',
      lookup: ['organizer_id', 'starts_at'],
      alsoWrites: [],
    } as const;

    it('lookup に対応する索引が無ければエラー(要求元を lookup として名指す)', () => {
      const dataTables = dataTableModel([dataTable('workshops', { entity: 'workshop', functions: [rateLimit] })]);

      const findings = verifyIndexExpectations(domain(), dataTables, NO_QUERIES, GUARDS);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        verifier: 'T2',
        severity: 'error',
        message: 'workshops に索引 (organizer_id, starts_at) がありません(lookup: check_rate)',
      });
    });

    it('lookup に対応する索引があれば違反なし(query_spec が読めなくても見る)', () => {
      const dataTables = dataTableModel([
        dataTable('workshops', {
          entity: 'workshop',
          functions: [rateLimit],
          indexes: [{ name: 'workshops_organizer_id_starts_at_idx', on: ['organizer_id', 'starts_at'], unique: false }],
        }),
      ]);

      expect(verifyIndexExpectations(domain(), dataTables, NO_QUERIES, GUARDS)).toEqual([]);
    });

    it('lookup が要求する索引は「余分」とは言わない(query_spec が読めるとき)', () => {
      const dataTables = dataTableModel([
        dataTable('workshops', {
          entity: 'workshop',
          functions: [rateLimit],
          indexes: [{ name: 'workshops_organizer_id_starts_at_idx', on: ['organizer_id', 'starts_at'], unique: false }],
        }),
      ]);

      expect(verifyIndexExpectations(domain(), dataTables, { available: true, queries: [] }, GUARDS)).toEqual([]);
    });

    it('lookup の候補が query の候補の前方一致なら長い索引に畳まれ、短い宣言は根拠なしの warning になる(query どうしと同じ扱い)', () => {
      const dataTables = dataTableModel([
        dataTable('workshops', {
          entity: 'workshop',
          functions: [rateLimit],
          indexes: [
            { name: 'workshops_organizer_id_starts_at_idx', on: ['organizer_id', 'starts_at'], unique: false },
            { name: 'workshops_organizer_id_starts_at_id_idx', on: ['organizer_id', 'starts_at', 'id'], unique: false },
          ],
        }),
      ]);

      const findings = verifyIndexExpectations(domain(), dataTables, { available: true, queries: [myListQuery()] }, GUARDS);

      // 後者は query(workshop_my_list)の要求。前者は lookup が (organizer_id, starts_at) を要求し、
      // query の (organizer_id, starts_at, id) の前方一致なので長い方に畳まれ、前者は根拠が無い扱いになる。
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: 'warning' });
      expect(findings[0]?.message).toContain('workshops_organizer_id_starts_at_idx');
    });

    it('lookup と query が畳まれた索引の欠落は、要求元を両方並べて 1 本のエラーにする', () => {
      const dataTables = dataTableModel([dataTable('workshops', { entity: 'workshop', functions: [rateLimit] })]);

      const findings = verifyIndexExpectations(domain(), dataTables, { available: true, queries: [myListQuery()] }, GUARDS);

      expect(findings.map((f) => f.message)).toEqual([
        'workshops に索引 (organizer_id, starts_at, id) がありません(query: workshop_my_list / lookup: check_rate)',
      ]);
    });

    it('余分の warning の対処は「引く者の宣言(query_spec か lookup)を書くか、消す」を案内する', () => {
      const dataTables = dataTableModel([
        dataTable('workshops', {
          entity: 'workshop',
          indexes: [
            { name: 'workshops_organizer_id_starts_at_id_idx', on: ['organizer_id', 'starts_at', 'id'], unique: false },
            { name: 'workshops_unused_idx', on: ['starts_at'], unique: false },
          ],
        }),
      ]);

      const findings = verifyIndexExpectations(domain(), dataTables, { available: true, queries: [myListQuery()] }, GUARDS);

      expect(findings[0]?.suggestion).toContain('functions[].lookup');
      expect(findings[0]?.suggestion).toContain('query_spec');
    });
  });
});
