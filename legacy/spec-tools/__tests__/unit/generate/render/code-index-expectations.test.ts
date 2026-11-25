/**
 * code-index-expectations(query_spec → 期待索引)のユニットテスト。
 *
 * 生成物はテーブル → 期待索引の一覧であり、T2 が data_table の indexes: と
 * 突き合わせる根拠と同じ導出(index-derivation.ts)から作られる。
 */

import { describe, expect, it } from 'vitest';
import { indexExpectationsGenerator } from '../../../../lib/generate/render/code-index-expectations.js';
import { aggregate, entitySpec, field, role, roleSpec, specModel, stubGuards } from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

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

describe('code-index-expectations', () => {
  it('期待索引をテーブルごとにまとめて出す', () => {
    const query = querySpec({
      name: 'workshop_my_list',
      source: 'workshop',
      for: ['member'],
      via: 'organizer',
      scopeUsed: 'own',
      sort: [{ field: 'starts_at' }, { field: 'id' }],
    });
    const sections = indexExpectationsGenerator.generate(domain(), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      guards: stubGuards(),
      queries: { available: true, queries: [query] },
      dataTables: dataTableModel([dataTable('workshops', { entity: 'workshop' })]),
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('app/src/domain/generated/index-expectations.ts');
    const content = sections[0]?.content ?? '';
    expect(content).toContain("columns: ['organizer_id', 'starts_at', 'id']");
    expect(content).toContain("queries: ['workshop_my_list']");
  });

  it('関数の lookup が要求する索引は lookups に載り、その data_table が写し元に並ぶ', () => {
    const sections = indexExpectationsGenerator.generate(domain(), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      guards: stubGuards(),
      queries: { available: true, queries: [] },
      dataTables: dataTableModel([
        dataTable('workshops', {
          entity: 'workshop',
          functions: [{ name: 'claim', args: [], params: [], kind: 'rpc', shape: 'composite', lookup: ['organizer_id', 'starts_at'], alsoWrites: [] }],
        }),
      ]),
    });

    const content = sections[0]?.content ?? '';
    expect(content).toContain("columns: ['organizer_id', 'starts_at']");
    expect(content).toContain("lookups: ['claim']");
    expect(content).toContain('docs/specs/backend/data/tables/workshops.md');
  });

  it('query_spec が無い環境では何も生成しない', () => {
    const sections = indexExpectationsGenerator.generate(domain(), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      guards: stubGuards(),
      queries: { available: false, queries: [] },
      dataTables: dataTableModel([dataTable('workshops', { entity: 'workshop' })]),
    });

    expect(sections).toEqual([]);
  });

  it('data_table が無い環境では何も生成しない', () => {
    const query = querySpec({ name: 'workshop_list', source: 'workshop', for: ['member'], scopeUsed: 'all' });
    const sections = indexExpectationsGenerator.generate(domain(), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      guards: stubGuards(),
      queries: { available: true, queries: [query] },
      dataTables: dataTableModel([], false),
    });

    expect(sections).toEqual([]);
  });
});
