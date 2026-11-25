/**
 * `code-lock-expectations` のテスト —— 掴みの宣言の期待の表(写し元・紐づけの関所・advisory lock の鍵)。点検 19 回目 A19-3 / A19-4 / O19-2。
 */

import { describe, expect, it } from 'vitest';
import { advisoryLockKeysOf, lockExpectationsGenerator } from '../../../../lib/generate/render/code-lock-expectations.js';
import type { DataFunctionDecl, DataTriggerDecl } from '../../../../lib/model/data/types.js';
import { specModel, stubGuards } from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';
import { aggregate, entitySpec, field, specModel as specModelV8 } from '../../../helpers/model-builder-v8plus.js';

const LIMIT: DataFunctionDecl = {
  name: 'send_limit_thing',
  args: ['text', 'uuid', 'uuid', 'text'],
  params: ['p_type', 'p_parent_id', 'p_actor_id', 'p_text'],
  kind: 'send_limit',
  migration: '20261105100038_send_limit_thing.sql',
  alsoWrites: [],
  sendLimit: { event: 'thing.update', types: ['notify_a'], keys: [{ name: 'parent_id' }, { name: 'actor_id' }], payload: ['text'], limits: [{ word: 'actor_daily', key: 'actor_id', max: 10, per: '24 hours' }] },
};

const TRIGGER: DataTriggerDecl = {
  name: 'apply_slot',
  functionName: 'apply_slot',
  fires: 'before insert',
  deferred: false,
  supplies: ['label'],
  params: {},
  advisory: ['slots:floor'],
  copiesFrom: [{ column: 'label', fromTable: 'room_notes', fromColumn: 'body', match: { room_id: 'room_id' } }],
};

function contextOf(model: ReturnType<typeof dataTableModel>) {
  return { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards(), dataTables: model };
}

const TABLES = [
  dataTable('jobs', { internal: true, functions: [LIMIT] }),
  dataTable('slots', {
    entity: 'slot',
    triggers: [TRIGGER],
    foreignKeys: [{ column: 'room_id', references: 'rooms', onDelete: 'cascade', refuseErased: { column: 'state', values: ['erased'], word: 'slot_room_erased', message: '消された部屋には紐づけられません' } }],
  }),
];

describe('code-lock-expectations', () => {
  it('advisory lock の鍵は、送信の上限の鍵とトリガの宣言の和をバイト順に並べる', () => {
    expect(advisoryLockKeysOf(TABLES, specModel([]))).toEqual(['send_limit_thing:actor_id=', 'send_limit_thing:parent_id=', 'slots:floor']);
  });

  it('期待の表に写し元・紐づけの関所・鍵を出す', () => {
    const [section] = lockExpectationsGenerator.generate(specModel([]), contextOf(dataTableModel(TABLES)));
    expect(section?.file).toMatch(/lock-expectations\.ts$/);
    const content = section?.content ?? '';
    expect(content).toContain("fromTable: 'room_notes'");
    expect(content).toContain('personal: false');
    expect(content).toContain("word: 'slot_room_erased'");
    // 画面の文言も写す(拒否の語の閉じた表。画面は wording の refusalWordText で引く)。
    expect(content).toContain("message: '消された部屋には紐づけられません'");
    expect(content).toContain("'slots:floor'");
  });

  it('個人列の凍結(freezes_personal)は、語・文言と自表の個人列の全部を写す(書かなければ freezes は出ない。点検 20 回目 A20-1)', () => {
    const model = specModelV8({
      aggregates: [
        aggregate({ name: 'slot', entity: entitySpec('slot', [field('id', { kind: 'uuid' }), field('label', { kind: 'string' }, { personal: true }), field('memo', { kind: 'string' }, { personal: true }), field('size', { kind: 'integer' })]) }),
      ],
    });
    const frozen = dataTable('slots', {
      entity: 'slot',
      foreignKeys: [
        { column: 'room_id', references: 'rooms', onDelete: 'cascade', refuseErased: { column: 'state', values: ['erased'], word: 'slot_room_erased', message: 'm', freezesPersonal: { word: 'slot_room_frozen', message: '凍った' } } },
      ],
    });
    const content = lockExpectationsGenerator.generate(model, contextOf(dataTableModel([frozen])))[0]?.content ?? '';
    expect(content).toMatch(/freezes: \{\s*word: 'slot_room_frozen',\s*message: '凍った',\s*columns: \[\s*'label',\s*'memo',?\s*\],?\s*\}/);
    const plain = lockExpectationsGenerator.generate(model, contextOf(dataTableModel(TABLES)))[0]?.content ?? '';
    expect(plain).not.toContain('freezes: {');
  });

  it('作成の後に書き換わらない参照の列(掴む順の判定の前提)を表ごとに出す(書ける列は出さない。11-06 01:37Z)', () => {
    const model = specModelV8({
      aggregates: [aggregate({ name: 'slot', entity: entitySpec('slot', [field('id', { kind: 'uuid' }, { auto: true }), field('room_id', { kind: 'ref', entity: 'room' }), field('label', { kind: 'string' })]) })],
    });
    const content = lockExpectationsGenerator.generate(model, contextOf(dataTableModel(TABLES)))[0]?.content ?? '';
    expect(content).toContain("export const fixedReferenceColumns: readonly FixedReferenceColumnsExpectation[] = deepFreeze([\n  {\n    table: 'slots',\n    columns: ['room_id'],\n  },\n]);");
  });

  it('data_table が無ければ何も出さない', () => {
    expect(lockExpectationsGenerator.generate(specModel([]), contextOf(dataTableModel([], false)))).toEqual([]);
  });
});
