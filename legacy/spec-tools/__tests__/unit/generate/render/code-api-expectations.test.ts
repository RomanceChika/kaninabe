/**
 * code-api-expectations(entity_spec + access_spec + data_table → API スキーマ期待表)の
 * ユニットテスト。
 *
 * 対象の要求(API スキーマ方式・手順 A。docs/design/security-surface-proposal.md §2):
 * ①ビューの列は entity_spec の fields をそのまま列挙する、②マスク列の visibleTo は
 * fields_hidden.from の外側にいて実際にその行を読めるロール(scope: none 除く・system 除く)、
 * ③RPC は data_table の kind: rpc の名前の重複無しソート済み和集合、④ヘルパは固定 2 本、
 * ⑤手書きで残すビューの閉世界は surface_spec の hand_written_views の写し。
 */

import { describe, expect, it } from 'vitest';
import { apiExpectationsGenerator } from '../../../../lib/generate/render/code-api-expectations.js';
import { stubGuards } from '../../../helpers/model-builder.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  fieldHiddenRule,
  readRule,
  specModel,
} from '../../../helpers/model-builder-v8plus.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import type { DataTableSpecModel } from '../../../../lib/model/data/types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 生成本文を 1 つだけ取り出す(dataTables 省略時は空モデル)。 */
function render(domain: SpecModel, dataTables: DataTableSpecModel = dataTableModel([])): string {
  const sections = apiExpectationsGenerator.generate(domain, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards(), dataTables });
  expect(sections).toHaveLength(1);
  return sections[0]?.content ?? '';
}

describe('code-api-expectations', () => {
  it('ビューの列は entity_spec の fields をそのまま(宣言順)列挙する', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'workshop',
          entity: entitySpec('workshop', [
            field('id', { kind: 'uuid' }),
            field('title', { kind: 'string' }),
            field('internal_note', { kind: 'text' }),
          ]),
          access: accessSpec('workshop', {
            reads: [readRule('member', { kind: 'all' })],
            fieldsHidden: [fieldHiddenRule('internal_note', ['member'])],
          }),
        }),
      ],
    });

    const content = render(domain);

    expect(content).toContain("columns: ['id', 'title', 'internal_note']");
  });

  it('masked の visibleTo は from の外側で、その行を読めるロール(scope: none と system を除く)', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'workshop',
          entity: entitySpec('workshop', [field('internal_note', { kind: 'text' })]),
          access: accessSpec('workshop', {
            reads: [
              readRule('member', { kind: 'all' }),
              readRule('organizer', { kind: 'own' }),
              readRule('staff', { kind: 'all' }),
              readRule('entry_owner', { kind: 'none' }),
              readRule('system', { kind: 'all' }),
            ],
            fieldsHidden: [fieldHiddenRule('internal_note', ['member'])],
          }),
        }),
      ],
    });

    const content = render(domain);

    expect(content).toContain("visibleTo: ['organizer', 'staff']");
    expect(content).not.toContain('entry_owner');
    expect(content).not.toContain("'system'");
  });

  it('fields_hidden が無いテーブルは masked が空配列になる', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'venue',
          entity: entitySpec('venue', [field('id', { kind: 'uuid' })]),
          access: accessSpec('venue', { reads: [readRule('member', { kind: 'all' })] }),
        }),
      ],
    });

    expect(render(domain)).toContain('masked: []');
  });

  it('entity_spec を持たない内部テーブル(jobs 等)は apiViews に現れない', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'workshop',
          entity: entitySpec('workshop', [field('id', { kind: 'uuid' })]),
          access: accessSpec('workshop', { reads: [readRule('member', { kind: 'all' })] }),
        }),
      ],
    });

    const content = render(domain);

    expect(content).not.toContain('jobs:');
  });

  it('apiRpcFunctions は kind: rpc の名前の重複無しソート済み和集合(trigger / helper は含めない)', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'workshop',
          entity: entitySpec('workshop', [field('id', { kind: 'uuid' })]),
          access: accessSpec('workshop', { reads: [readRule('member', { kind: 'all' })] }),
        }),
      ],
    });
    const dataTables = dataTableModel([
      dataTable('workshops', {
        entity: 'workshop',
        functions: [
          { name: 'update_workshop', args: ['uuid'], params: ['p_a'], kind: 'rpc', alsoWrites: [] },
          { name: 'apply_workshop_transition', args: ['uuid'], params: ['p_a'], kind: 'rpc', alsoWrites: [] },
          { name: 'check_entry_capacity', args: [], params: [], kind: 'trigger', alsoWrites: [] },
          { name: 'is_staff', args: [], params: [], kind: 'helper', alsoWrites: [] },
        ],
      }),
    ]);

    const content = render(domain, dataTables);

    expect(content).toContain(
      "apiRpcFunctions: readonly string[] = deepFreeze(['apply_workshop_transition', 'update_workshop']);",
    );
    expect(content).not.toContain('check_entry_capacity');
    expect(content).not.toContain("'is_staff'");
  });

  it('apiHelpers は固定の 3 本(actor_id / is_end_user / session_alive)', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'workshop',
          entity: entitySpec('workshop', [field('id', { kind: 'uuid' })]),
          access: accessSpec('workshop', { reads: [readRule('member', { kind: 'all' })] }),
        }),
      ],
    });

    expect(render(domain)).toContain("apiHelpers: readonly string[] = deepFreeze(['actor_id', 'is_end_user', 'session_alive']);");
  });

  it('apiInternalViews は「外から完全に消える側」の全数である(手書き + 生成物の内部テーブル)', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'workshop',
          entity: entitySpec('workshop', [field('id', { kind: 'uuid' })]),
          access: accessSpec('workshop', { reads: [readRule('member', { kind: 'all' })] }),
        }),
      ],
    });
    const surface = {
      available: true,
      spec: {
        id: 'surface',
        handWrittenViews: [
          { table: 'jobs', reason: '内部テーブル', location: { file: 'docs/specs/backend/surface.md' } },
        ],
        location: { file: 'docs/specs/backend/surface.md' },
      },
    } as const;

    const sections = apiExpectationsGenerator.generate(domain, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      guards: stubGuards(),
      dataTables: dataTableModel([]),
      surface,
    });

    expect(sections[0]?.content ?? '').toContain("apiInternalViews: readonly string[] = deepFreeze(['jobs']);");
    // surface の仕様書が無い構成では閉世界は空である(手書きのビューを持たない)。
    expect(render(domain)).toContain('apiInternalViews: readonly string[] = deepFreeze([]);');

    // 生成物にした内部テーブル(`surface_migration` を宣言する `internal: true` の表)も
    // 同じ一覧に載る —— 列は `apiViews` で突き合わせ、surface から消えることはこちらで見る。
    const generated = apiExpectationsGenerator.generate(domain, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      guards: stubGuards(),
      dataTables: dataTableModel([
        dataTable('jobs', {
          internal: true,
          framework: 'jobs',
          surfaceMigration: '20260923000371_api_view_jobs.sql',
        }),
      ]),
    });
    const content = generated[0]?.content ?? '';
    expect(content).toContain("apiInternalViews: readonly string[] = deepFreeze(['jobs']);");
    // 列は設計図の 13 列から出る(entity_spec を持たないので、こちらが唯一の正である)。
    // 設計図にしか無い列名で見る —— 期待表に載っていること自体が「列を突き合わせる」の意味である。
    expect(content).toContain("'idempotency_key'");
    expect(content).toContain("'max_attempts'");
  });

  it('access_spec + entity_spec の組が 1 つも無ければ何も生成しない', () => {
    expect(apiExpectationsGenerator.generate(specModel({}), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards(), dataTables: dataTableModel([]) })).toEqual(
      [],
    );
  });

  it('access_spec はあるが entity_spec が無いエンティティは対象にしない', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'orphan',
          access: accessSpec('orphan', { reads: [readRule('member', { kind: 'all' })] }),
        }),
      ],
    });

    expect(apiExpectationsGenerator.generate(domain, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards(), dataTables: dataTableModel([]) })).toEqual(
      [],
    );
  });
});
