/**
 * data-table-body / data-table-list(data_table の本文ブロックと一覧表)のユニットテスト。
 *
 * 生成は情報を足さない(YAML のマトリクスのみ)。ここでは差し込み先と、宣言が表に写ること、
 * 「無い」ことの明示表記を固定する。
 */

import { describe, expect, it } from 'vitest';
import { dataTableBodyGenerator } from '../../../../lib/generate/render/data-table-body.js';
import { dataTableListGenerator } from '../../../../lib/generate/render/data-table-list.js';
import { specModel, stubGuards } from '../../../helpers/model-builder.js';
import type { DataFunctionDecl } from '../../../../lib/model/data/types.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

const CTX = (model: ReturnType<typeof dataTableModel>) => ({
  guards: stubGuards(),
  roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
  dataTables: model,
});

describe('data-table-body', () => {
  it('宣言がマトリクスに写り、無い節は「ありません」と明示される', () => {
    const sections = dataTableBodyGenerator.generate(
      specModel([]),
      CTX(
        dataTableModel([
          dataTable('workshops', {
            entity: 'workshop',
            indexes: [{ name: 'workshops_organizer_id_idx', on: ['organizer_id'], unique: false }],
            foreignKeys: [{ column: 'organizer_id', references: 'members', onDelete: 'no_action' }],
          }),
        ]),
      ),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/specs/backend/data/tables/workshops.md');
    expect(sections[0]?.marker).toBe('data-table-body');
    const content = sections[0]?.content ?? '';
    expect(content).toContain('`workshops_organizer_id_idx`');
    expect(content).toContain('no_action');
    expect(content).toContain('### トリガ\n\nありません。');
  });

  it('インデックスの由来に、不変条件・query_spec・関数の lookup の要求元が並ぶ(無ければ —)', () => {
    const sections = dataTableBodyGenerator.generate(
      specModel([]),
      CTX(
        dataTableModel([
          dataTable('inquiries', {
            entity: 'inquiry',
            indexes: [
              { name: 'inquiries_rate_idx', on: ['sender_email', 'created_at'], unique: false },
              { name: 'inquiries_other_idx', on: ['handled_by'], unique: false, invariant: 'INV-X-001' },
              { name: 'inquiries_unexplained_idx', on: ['state'], unique: false },
            ],
            functions: [
              { name: 'check_rate', args: [], params: [], kind: 'trigger', lookup: ['sender_email', 'created_at'], alsoWrites: [] },
            ],
          }),
        ]),
      ),
    );

    const content = sections[0]?.content ?? '';
    expect(content).toContain('| `inquiries_rate_idx` | sender_email, created_at | — | — | lookup: check_rate |');
    expect(content).toContain('| `inquiries_other_idx` | handled_by | — | — | INV-X-001 |');
    expect(content).toContain('| `inquiries_unexplained_idx` | state | — | — | — |');
  });

  it('内部テーブルは全不可視の期待が対応表に出る', () => {
    const sections = dataTableBodyGenerator.generate(
      specModel([]),
      CTX(dataTableModel([dataTable('jobs', { internal: true })])),
    );

    expect(sections[0]?.content).toContain('0 本(全不可視)が期待');
  });

  it('設計図が持つ執行点も「トリガ(全数)」「関数の帰属」に並ぶ(見出しの「全数」を嘘にしない)', () => {
    const sections = dataTableBodyGenerator.generate(
      specModel([]),
      CTX(dataTableModel([dataTable('domain_events', { internal: true, framework: 'domain_events' })])),
    );

    const content = sections[0]?.content ?? '';
    expect(content).toContain('`domain_events_append_only`');
    expect(content).toContain('`reject_domain_events_mutation`');
  });

  it('enforces を持つ composite は「執行点になっている規則」の表に出る(宣言が無い表は節ごと出ない)', () => {
    const bare: DataFunctionDecl = {
      name: 'reorder_slots',
      args: ['uuid[]'],
      params: [],
      kind: 'rpc',
      shape: 'composite',
      alsoWrites: [],
    };
    const composite: DataFunctionDecl = {
      ...bare,
      enforces: [{ writes: 'slot', by: 'organizer', testCase: 'TC-TABLE-SLOTS-001' }],
    };
    const declared = dataTableBodyGenerator.generate(
      specModel([]),
      CTX(dataTableModel([dataTable('slots', { entity: 'slot', functions: [composite] })])),
    );
    const plain = dataTableBodyGenerator.generate(
      specModel([]),
      CTX(dataTableModel([dataTable('slots', { entity: 'slot', functions: [bare] })])),
    );

    expect(declared[0]?.content).toContain('#### 執行点になっている規則');
    expect(declared[0]?.content).toContain('| `reorder_slots` | `slot` | organizer | TC-TABLE-SLOTS-001 |');
    expect(plain[0]?.content).not.toContain('執行点になっている規則');
  });

  it('宣言が無い表には「採番の器」の節が「ありません」と出る', () => {
    const sections = dataTableBodyGenerator.generate(
      specModel([]),
      CTX(dataTableModel([dataTable('entries', { entity: 'entry' })])),
    );

    expect(sections[0]?.content).toContain('### 採番の器\n\nありません。');
  });

  it('宣言した採番の器は名前と start がマトリクスに出る', () => {
    const sections = dataTableBodyGenerator.generate(
      specModel([]),
      CTX(
        dataTableModel([
          dataTable('patrons', { entity: 'patron', sequences: [{ name: 'patron_card_seq', start: 1000 }] }),
        ]),
      ),
    );

    const content = sections[0]?.content ?? '';
    expect(content).toContain('### 採番の器(全数。表より前に作る)');
    expect(content).toContain('`patron_card_seq`');
    expect(content).toContain('1000');
  });
});

describe('data-table-list', () => {
  it('README の一覧に全テーブルが並ぶ', () => {
    const sections = dataTableListGenerator.generate(
      specModel([]),
      CTX(dataTableModel([dataTable('entries', { entity: 'entry' }), dataTable('jobs', { internal: true })])),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/specs/backend/data/README.md');
    const content = sections[0]?.content ?? '';
    expect(content).toContain('`entries`');
    expect(content).toContain('—(内部)');
    expect(content).toContain('`tables/jobs.md`');
  });

  it('件数は設計図が持つ執行点も数える(個別ファイルのマトリクスと逆向きに動かさない)', () => {
    const sections = dataTableListGenerator.generate(
      specModel([]),
      CTX(dataTableModel([dataTable('domain_events', { internal: true, framework: 'domain_events' })])),
    );

    // トリガ 1 本・関数 1 本を設計図が持つので、宣言 0 でも 1 / 1 と数える
    // (独立レビュー ③-2-b F-3: README だけが 2|2 → 1|1 に減っていた)。
    const row = (sections[0]?.content ?? '').split('\n').find((line) => line.includes('`domain_events`')) ?? '';
    expect(row.split('|').map((cellText) => cellText.trim())).toEqual([
      '',
      '`domain_events`',
      '—(内部)',
      '0',
      '0',
      '1',
      '1',
      '0',
      '`tables/domain_events.md`',
      '',
    ]);
  });
});
