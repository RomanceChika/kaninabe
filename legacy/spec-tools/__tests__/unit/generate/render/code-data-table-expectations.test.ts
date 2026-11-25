/**
 * code-data-table-expectations(data_table → 期待スキーマ表)のユニットテスト。
 *
 * 生成物は統合テスト(data-table-parity)の閉世界の入力になるため、
 * ここでは「宣言が過不足なくリテラルに写ること」と「内部テーブルの一覧が出ること」を固定する。
 */

import { describe, expect, it } from 'vitest';
import { dataTableExpectationsGenerator } from '../../../../lib/generate/render/code-data-table-expectations.js';
import { aggregate, entitySpec, field, machine, specModel, stubGuards } from '../../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel, dataTestCase } from '../../../helpers/data-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 生成本文を 1 つだけ取り出す短縮形。 */
function render(model: ReturnType<typeof dataTableModel>, domain = specModel([])): string {
  const sections = dataTableExpectationsGenerator.generate(domain, { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    guards: stubGuards(),
    dataTables: model,
  });
  expect(sections).toHaveLength(1);
  return sections[0]?.content ?? '';
}

describe('code-data-table-expectations', () => {
  it('インデックス・FK・トリガ・関数・CHECK が宣言どおり写る', () => {
    const content = render(
      dataTableModel([
        dataTable('entries', {
          entity: 'entry',
          indexes: [
            {
              name: 'entries_active_unique',
              on: ['workshop_id', 'performer_id'],
              unique: true,
              where: "state not in ('rejected', 'withdrawn')",
            },
          ],
          foreignKeys: [{ column: 'workshop_id', references: 'workshops', onDelete: 'cascade' }],
          triggers: [{ name: 'check_entry_capacity', functionName: 'check_entry_capacity', deferred: true, supplies: [], params: {} }],
          functions: [
            { name: 'update_entry', args: ['uuid', 'jsonb'], params: ['p_a', 'p_b'], kind: 'rpc', alsoWrites: ['domain_events'] },
          ],
          checks: [{ name: 'entries_extra_check' }],
        }),
      ]),
    );

    expect(content).toContain("name: 'entries_active_unique'");
    expect(content).toContain('unique: true');
    expect(content).toContain('partial: true'); // where があるので部分インデックス
    expect(content).toContain("onDelete: 'cascade'");
    expect(content).toContain("functionName: 'check_entry_capacity'");
    expect(content).toContain('deferred: true'); // 遅延であることは突合する宣言なので生成物に写る
    expect(content).toContain("args: ['uuid', 'jsonb']");
    expect(content).toContain("checks: ['entries_extra_check']");
    // also_writes は突合しない宣言なので生成物に写らない(引き継ぎ情報は仕様側に残る)
    expect(content).not.toContain('alsoWrites');
  });

  it.each([
    ['列を名指した更新は列を昇順で運ぶ', 'before update of member_id, display_name or delete', "updateOf: ['display_name', 'member_id']"],
    ['列を名指さない更新は全部の列', 'after update or delete', "updateOf: 'all'"],
    ['更新で発火しなければ null', 'before insert or delete', 'updateOf: null'],
  ])('発火の更新の列(updateOf)は tgattr と比べる形で写る: %s(T28 が当てにする)', (_title, fires, expected) => {
    const content = render(dataTableModel([dataTable('entries', { entity: 'entry', triggers: [{ name: 'remember', functionName: 'remember', fires, deferred: false, supplies: [], params: {} }] })]));
    expect(content).toContain(expected);
  });

  it('関数の lookup は期待関数に写る(宣言が無ければ空)— 本文にその列が現れることを突合する材料', () => {
    const content = render(
      dataTableModel([
        dataTable('inquiries', {
          entity: 'inquiry',
          functions: [
            { name: 'check_rate', args: [], params: [], kind: 'trigger', lookup: ['sender_email', 'created_at'], alsoWrites: [] },
            { name: 'plain', args: [], params: [], kind: 'trigger', alsoWrites: [] },
          ],
        }),
      ]),
    );

    expect(content).toContain("lookup: ['sender_email', 'created_at']");
    expect(content).toContain('lookup: []');
  });

  it('誰の権限で走るかは種別と宣言から決まる(rpc は definer / 手書きトリガは security / 省略は invoker)', () => {
    const content = render(
      dataTableModel([
        dataTable('entries', {
          entity: 'entry',
          triggers: [
            { name: 'a', functionName: 'fn_definer', deferred: false, supplies: [], params: {} },
            { name: 'b', functionName: 'fn_invoker', deferred: false, supplies: [], params: {} },
          ],
          functions: [
            { name: 'update_entry', args: [], params: [], kind: 'rpc', alsoWrites: [] },
            {
              name: 'fn_definer',
              args: [],
              params: [],
              kind: 'trigger',
              security: 'definer',
              handwritten: '手書きである',
              alsoWrites: [],
            },
            { name: 'fn_invoker', args: [], params: [], kind: 'trigger', handwritten: '手書きである', alsoWrites: [] },
          ],
        }),
      ]),
    );

    // 並びは宣言順なので、関数 1 本ぶんの断片で 3 通りを固定する。
    expect(content).toContain("name: 'update_entry',\n          args: [],\n          kind: 'rpc',\n          securityDefiner: true,");
    expect(content).toContain("name: 'fn_definer',\n          args: [],\n          kind: 'trigger',\n          securityDefiner: true,");
    expect(content).toContain("name: 'fn_invoker',\n          args: [],\n          kind: 'trigger',\n          securityDefiner: false,");
  });

  it('トリガが名指す不変条件の前提・条件の語が conditions に写る(名指さないトリガは null。点検 20 回目の後の P3)', () => {
    const domain = specModel([
      aggregate('slot', {
        entity: entitySpec('slot', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'slot' })] }),
        stateMachines: [machine('slot', { states: ['draft', 'submitted', 'confirmed'], initial: 'draft' })],
      }),
      aggregate('item', {
        entity: entitySpec('item', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('slot_id', { kind: 'ref', entity: 'slot' })] }),
        invariants: invariantSpec([invariant({ id: 'INV-ITEM-001', entities: ['item', 'slot'], formal: { kind: 'check', expr: 'slot.state == confirmed' } })]),
      }),
    ]);
    const content = render(
      dataTableModel([
        dataTable('items', {
          entity: 'item',
          triggers: [
            { name: 'check_item_slot', functionName: 'check_item_slot', deferred: false, supplies: [], params: {}, invariant: 'INV-ITEM-001' },
            { name: 'touch_item', functionName: 'touch_item', deferred: false, supplies: [], params: {} },
          ],
        }),
      ]),
      domain,
    );
    expect(content).toContain("conditions: {\n            invariant: 'INV-ITEM-001',\n            unreadable: null,\n            premise: [],\n            requires: [\n              ['confirmed'],\n            ],\n            premiseColumns: [],\n            requiresColumns: [],\n            vocabulary: ['confirmed', 'draft', 'submitted'],\n          },");
    expect(content).toContain('conditions: null');
    expect(content).toContain('readonly conditions: ExpectedTriggerConditions | null;');
  });

  it('internal: true のテーブルだけが internalTables に並ぶ', () => {
    const content = render(
      dataTableModel([
        dataTable('entries', { entity: 'entry' }),
        dataTable('jobs', { internal: true }),
        dataTable('domain_events', { internal: true }),
      ]),
    );

    expect(content).toContain("export const internalTables: readonly string[] = deepFreeze(['jobs', 'domain_events']);");
  });

  it('設計図が持つ執行点(追記専用のトリガ関数)も本文の md5 を持つ(製品の隔離の門の見張りは md5 の有無で生成物かを読む。点検 D25s3-2)', () => {
    const content = render(dataTableModel([dataTable('domain_events', { internal: true, framework: 'domain_events' })]));
    expect(content).toMatch(/name: 'reject_domain_events_mutation',\n\s+args: \[\],\n\s+kind: 'trigger',\n\s+securityDefiner: false,\n\s+bodyMd5: '[0-9a-f]{32}',/u);
  });

  it('data_table が無い環境では何も生成しない', () => {
    const sections = dataTableExpectationsGenerator.generate(specModel([]), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
      guards: stubGuards(),
      dataTables: dataTableModel([], false),
    });

    expect(sections).toEqual([]);
  });
  it('試験の登録簿は表 → 不変条件ごとに、spec_ids にその不変条件の ID を持つ試験の ID を昇順・重複なしで写す(点検 D25s-4 → D25s2-3 → D25s3-5)', () => {
    const withSpecs = (id: string, table: string, specIds: readonly string[]): ReturnType<typeof dataTestCase> => ({ ...dataTestCase(id, table), covers: ['invariant'], specIds: [`table-${table}`, ...specIds] });
    const model = specModel([
      aggregate('b', { entity: entitySpec('b'), invariants: invariantSpec([invariant({ id: 'INV-B-001' }), invariant({ id: 'INV-B-002' })]) }),
    ]);
    const content = render(
      dataTableModel([
        dataTable('b_table', {
          testCases: [
            withSpecs('TC-TABLE-B-002', 'b_table', ['INV-B-001']),
            withSpecs('TC-TABLE-B-001', 'b_table', ['INV-B-001', 'INV-B-002']),
            withSpecs('TC-TABLE-B-003', 'b_table', []),
            withSpecs('TC-TABLE-B-001', 'b_table', ['INV-B-001']),
            // 不変条件でない仕様 ID(イベント・存在しない ID)は登録簿に入れない。
            withSpecs('TC-TABLE-B-004', 'b_table', ['b.create', 'INV-B-999']),
          ],
        }),
        dataTable('a_table', { testCases: [withSpecs('TC-TABLE-A-001', 'a_table', ['INV-B-002'])] }),
        dataTable('c_table', { testCases: [dataTestCase('TC-TABLE-C-001', 'c_table')] }),
      ]),
      model,
    );
    expect(content).toContain(
      [
        'export const dataTableInvariantTestCaseIds: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = deepFreeze({',
        '  a_table: {',
        "    'INV-B-002': ['TC-TABLE-A-001'],",
        '  },',
        '  b_table: {',
        "    'INV-B-001': ['TC-TABLE-B-001', 'TC-TABLE-B-002'],",
        "    'INV-B-002': ['TC-TABLE-B-001'],",
        '  },',
        '});',
      ].join('\n'),
    );
  });
  it('表の集約の不変条件は、表の entity を持つ集約の invariants を昇順で写す(entity の無い表・不変条件の無い集約は載らない。点検 D25s4-4)', () => {
    const model = specModel([
      aggregate('b', { entity: entitySpec('b'), invariants: invariantSpec([invariant({ id: 'INV-B-002' }), invariant({ id: 'INV-B-001' })]) }),
      aggregate('c', { entity: entitySpec('c') }),
    ]);
    const content = render(dataTableModel([dataTable('b_table', { entity: 'b' }), dataTable('c_table', { entity: 'c' }), dataTable('a_table')]), model);
    expect(content).toContain(
      [
        'export const dataTableOwnInvariants: Readonly<Record<string, readonly string[]>> = deepFreeze({',
        "  b_table: ['INV-B-001', 'INV-B-002'],",
        '});',
      ].join('\n'),
    );
    // 隔離の門の 1 行目は拒否の本体の字面の写し(製品の見張りが手書きの本文と照らす。観察 O2-1)。
    expect(content).toContain("export const isolationGateHead: string = 'if current_setting(\\'transaction_isolation\\') <> \\'read committed\\' then';");
  });
});
