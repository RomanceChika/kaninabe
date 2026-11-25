/**
 * data_table の掴みの宣言(`triggers[].locks` / `copies_from` / `advisory`・`foreign_keys[].refuse_erased`)のパーサーの規約網羅テスト。
 * 点検 19 回目 A19-1 / A19-3 / A19-4 / O19-2。読めない要素は載せない(掴みを宣言より弱く生成しない)。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseDataTableSpec } from '../../../../lib/model/data/parse-data-table.js';

/** トリガ 1 本と外部キー 1 本の最小の data_table。 */
function parse(triggerExtra: Record<string, unknown>, keyExtra: Record<string, unknown> = {}) {
  const reporter = new SpecReporter('slots.md');
  const spec = parseDataTableSpec(
    {
      doc_type: 'data_table',
      scope: 'backend',
      id: 'table-slots',
      table: 'slots',
      entity: 'slot',
      foreign_keys: [{ column: 'room_id', references: 'rooms', on_delete: 'cascade', ...keyExtra }],
      triggers: [{ name: 'check_slot', function: 'check_slot', fires: 'before insert', supplies: ['label'], ...triggerExtra }],
      functions: [{ name: 'check_slot', args: [], kind: 'trigger', handwritten: { migration: 'x.sql', reason: 'r' } }],
      test_cases: [{ id: 'TC-TABLE-SLOTS-001', type: 'integration', covers: ['success'], spec_ids: ['table-slots'], implementation: 'a.test.ts::x' }],
    },
    'slots.md',
    reporter,
  );
  return { spec: spec.value, errors: reporter.findings().filter((finding) => finding.severity === 'error').map((finding) => finding.message) };
}

/** 読める紐づけの関所(凍結の負例の土台)。 */
const REFUSE = { column: 'state', values: ['erased'], word: 'w', message: 'm' };

describe('掴みの宣言のパーサー', () => {
  it('正しい宣言を読む', () => {
    const { spec, errors } = parse(
      { locks: { rooms: 'update' }, copies_from: [{ column: 'label', from: 'room_notes.body', match: { room_id: 'room_id' } }], advisory: ['slots:floor'] },
      { refuse_erased: { column: 'state', values: ['erased'], word: 'slot_room_erased', message: '消された部屋には紐づけられません' } },
    );
    expect(errors).toEqual([]);
    expect(spec?.triggers[0]).toMatchObject({
      locks: { rooms: 'update' },
      copiesFrom: [{ column: 'label', fromTable: 'room_notes', fromColumn: 'body', match: { room_id: 'room_id' } }],
      advisory: ['slots:floor'],
    });
    expect(spec?.foreignKeys[0]?.refuseErased).toEqual({ column: 'state', values: ['erased'], word: 'slot_room_erased', message: '消された部屋には紐づけられません' });
  });

  it('個人列の凍結(freezes_personal)を読む。書かなければ無い(点検 20 回目 A20-1)', () => {
    const frozen = parse({}, { refuse_erased: { ...REFUSE, freezes_personal: { word: 'slot_owner_erased', message: '消された部屋の行は書き換えられません' } } });
    expect(frozen.errors).toEqual([]);
    expect(frozen.spec?.foreignKeys[0]?.refuseErased).toEqual({ ...REFUSE, freezesPersonal: { word: 'slot_owner_erased', message: '消された部屋の行は書き換えられません' } });
    expect(parse({}, { refuse_erased: REFUSE }).spec?.foreignKeys[0]?.refuseErased?.freezesPersonal).toBeUndefined();
  });

  it('凍結が読めなくても紐づけの関所は残す(緩む側に倒さない)', () => {
    const bad = parse({}, { refuse_erased: { ...REFUSE, freezes_personal: { word: 'Bad', message: 'm' } } });
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.spec?.foreignKeys[0]?.refuseErased).toEqual(REFUSE);
  });

  it('書かなければ宣言は無い(既定で掴まない)', () => {
    const { spec } = parse({});
    expect(spec?.triggers[0]?.locks).toBeUndefined();
    expect(spec?.triggers[0]?.copiesFrom).toBeUndefined();
    expect(spec?.foreignKeys[0]?.refuseErased).toBeUndefined();
  });

  it('元の持ち主の記録の宣言(remembers_owner)を読む。書かなければ無い。識別子でなければ赤(T28 の入口)', () => {
    expect(parse({ remembers_owner: 'room_id' }).spec?.triggers[0]?.remembersOwner).toBe('room_id');
    expect(parse({}).spec?.triggers[0]?.remembersOwner).toBeUndefined();
    const bad = parse({ remembers_owner: 'Room Id' });
    expect(bad.spec?.triggers[0]?.remembersOwner).toBeUndefined();
    expect(bad.errors.join('\n')).toMatch(/remembers_owner/);
  });

  it.each([
    ['強さの値域の外', { locks: { rooms: 'exclusive' } }, {}, /locks の rooms: exclusive は読めません/],
    ['写し元が {表}.{列} でない', { copies_from: [{ column: 'label', from: 'room_notes', match: { room_id: 'room_id' } }] }, {}, /copies_from の要素が読めません/],
    ['写し元の行の選び方が無い', { copies_from: [{ column: 'label', from: 'room_notes.body' }] }, {}, /copies_from の要素が読めません/],
    ['advisory の鍵の形', { advisory: ['Slots Floor'] }, {}, /advisory の鍵 Slots Floor は読めません/],
    ['refuse_erased の値が空', {}, { refuse_erased: { column: 'state', values: [], word: 'w', message: 'm' } }, /values/],
    ['refuse_erased の語の形', {}, { refuse_erased: { column: 'state', values: ['erased'], word: 'Bad Word', message: 'm' } }, /refuse_erased が読めません/],
    ['refuse_erased の画面の文言が無い', {}, { refuse_erased: { column: 'state', values: ['erased'], word: 'w' } }, /message/],
    ['refuse_erased の画面の文言が空白だけ', {}, { refuse_erased: { column: 'state', values: ['erased'], word: 'w', message: '  ' } }, /refuse_erased が読めません/],
    ['freezes_personal がマッピングでない', {}, { refuse_erased: { ...REFUSE, freezes_personal: true } }, /freezes_personal はマッピングで書きます/],
    ['freezes_personal の語が無い', {}, { refuse_erased: { ...REFUSE, freezes_personal: { message: 'm' } } }, /word/],
    ['freezes_personal の文言が無い', {}, { refuse_erased: { ...REFUSE, freezes_personal: { word: 'slot_frozen' } } }, /message/],
    ['freezes_personal の語の形', {}, { refuse_erased: { ...REFUSE, freezes_personal: { word: 'Frozen', message: 'm' } } }, /freezes_personal が読めません/],
    ['freezes_personal の語が紐づけの語と同じ', {}, { refuse_erased: { ...REFUSE, freezes_personal: { word: 'w', message: 'm' } } }, /紐づけの語と別の語/],
    ['freezes_personal の文言が空白だけ', {}, { refuse_erased: { ...REFUSE, freezes_personal: { word: 'slot_frozen', message: ' ' } } }, /freezes_personal が読めません/],
    ['freezes_personal の未知の鍵', {}, { refuse_erased: { ...REFUSE, freezes_personal: { word: 'slot_frozen', message: 'm', columns: ['x'] } } }, /freezes_personal に columns は書けません/],
  ])('読めない宣言は赤: %s', (_title, triggerExtra, keyExtra, expected) => {
    const { errors } = parse(triggerExtra, keyExtra);
    expect(errors.join('\n')).toMatch(expected);
  });
});
