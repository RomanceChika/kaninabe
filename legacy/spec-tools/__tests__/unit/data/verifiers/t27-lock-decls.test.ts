/**
 * T27(掴みの宣言の接地)のテスト。点検 19 回目 A19-1 / A19-3 / A19-4。負例と正例を表で並べる。
 */

import { describe, expect, it } from 'vitest';
import { verifyLockDecls } from '../../../../lib/data/verifiers/t27-lock-decls.js';
import type { DataTriggerDecl } from '../../../../lib/model/data/types.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';

/** 部屋(個人列 name)・メモ(個人列 body)・枠(個人列 label をトリガが写す)。 */
function domain() {
  return specModel({ aggregates: [
    aggregate({ name: 'room', entity: entitySpec('room', [field('id', { kind: 'uuid' }), field('name', { kind: 'string' }, { personal: true }), field('state', { kind: 'string' })]) }),
    aggregate({ name: 'room_note', entity: entitySpec('room_note', [field('id', { kind: 'uuid' }), field('room_id', { kind: 'ref', entity: 'room' }), field('body', { kind: 'string' }, { personal: true })]) }),
    aggregate({ name: 'slot', entity: entitySpec('slot', [field('id', { kind: 'uuid' }), field('room_id', { kind: 'ref', entity: 'room' }), field('label', { kind: 'string' }, { personal: true })]) }),
    aggregate({ name: 'tag', entity: entitySpec('tag', [field('id', { kind: 'uuid' }), field('code', { kind: 'string' })]) }),
  ] });
}

/** 枠のトリガ(宣言を差し替える)。 */
function trigger(extra: Partial<DataTriggerDecl>): DataTriggerDecl {
  return { name: 'apply_slot', functionName: 'apply_slot', fires: 'before insert', deferred: false, supplies: ['label'], params: {}, ...extra };
}

const COPY = { column: 'label', fromTable: 'room_notes', fromColumn: 'body', match: { room_id: 'room_id' } };

/** 個人列の凍結の宣言(枠は個人列 label を持つので要る)。 */
const FREEZE = { word: 'slot_room_frozen', message: '消された部屋の枠は書き換えられません' };

function verify(slotTrigger: DataTriggerDecl, refuse?: { readonly references: string; readonly column: string; readonly freeze?: boolean }, extra: readonly ReturnType<typeof dataTable>[] = []) {
  const freeze = refuse?.freeze ?? true;
  const tables = [
    dataTable('rooms', { entity: 'room' }),
    dataTable('room_notes', { entity: 'room_note' }),
    dataTable('tags', { entity: 'tag' }),
    dataTable('slots', {
      entity: 'slot',
      foreignKeys: [
        {
          column: 'room_id',
          references: refuse?.references ?? 'rooms',
          onDelete: 'cascade',
          ...(refuse === undefined
            ? {}
            : { refuseErased: { column: refuse.column, values: ['erased'], word: 'slot_room_erased', message: '消された部屋には紐づけられません', ...(freeze ? { freezesPersonal: FREEZE } : {}) } }),
        },
      ],
      triggers: [slotTrigger],
    }),
    ...extra,
  ];
  return verifyLockDecls(domain(), dataTableModel(tables)).map((finding) => finding.message);
}

describe('T27 掴みの宣言の接地', () => {
  it('正しい宣言は通る', () => {
    expect(verify(trigger({ locks: { rooms: 'update' }, copiesFrom: [COPY] }), { references: 'rooms', column: 'state' })).toEqual([]);
  });

  it.each([
    ['直の外部キーで指さない表を掴む', trigger({ locks: { tags: 'update' }, copiesFrom: [COPY] }), undefined, /tags を掴むと宣言していますが、slots は tags を直の外部キーで指しません/],
    ['供給しない列の写し元', trigger({ copiesFrom: [COPY, { ...COPY, column: 'other' }] }), undefined, /copies_from の other が supplies にありません/],
    ['写し元の表が無い', trigger({ copiesFrom: [{ ...COPY, fromTable: 'ghosts' }] }), undefined, /写し元の表 ghosts が entity を持つ data_table にありません/],
    ['写し元の列が欄に無い', trigger({ copiesFrom: [{ ...COPY, fromColumn: 'nope' }] }), undefined, /room_notes\.nope/],
    ['個人列の写しに写し元が無い', trigger({}), undefined, /個人列 label を供給しますが、copies_from に写し元がありません/],
    ['関所の参照先が個人列を持たない', trigger({ copiesFrom: [COPY] }), { references: 'tags', column: 'code' }, /tags は個人列を持たず、消去の対象ではありません/],
    ['関所の印の列が欄に無い', trigger({ copiesFrom: [COPY] }), { references: 'rooms', column: 'gone' }, /印の列 gone が rooms の欄にありません/],
    ['個人列を持つ表の関所に凍結が無い(A20-1)', trigger({ copiesFrom: [COPY] }), { references: 'rooms', column: 'state', freeze: false }, /slots は個人列\(label\)を持つのに、room_id の refuse_erased に freezes_personal がありません/],
  ])('負例: %s', (_title, slotTrigger, refuse, expected) => {
    expect(verify(slotTrigger, refuse).join('\n')).toMatch(expected);
  });

  it('個人列を持たない表には凍結を書けない(凍らせる列が無い)', () => {
    const tagLinks = dataTable('tag_links', {
      entity: 'tag',
      foreignKeys: [{ column: 'room_id', references: 'rooms', onDelete: 'cascade', refuseErased: { column: 'state', values: ['erased'], word: 'w', message: 'm', freezesPersonal: FREEZE } }],
    });
    expect(verify(trigger({ copiesFrom: [COPY] }), undefined, [tagLinks]).join('\n')).toMatch(/tag_links は個人列を持たないので、freezes_personal で凍らせる列がありません/);
    const plain = dataTable('tag_links', { entity: 'tag', foreignKeys: [{ column: 'room_id', references: 'rooms', onDelete: 'cascade', refuseErased: { column: 'state', values: ['erased'], word: 'w', message: 'm' } }] });
    expect(verify(trigger({ copiesFrom: [COPY] }), undefined, [plain])).toEqual([]);
  });

  it('導出(derives)のトリガは写し元を求めない', () => {
    expect(verify(trigger({ derives: [] as unknown as NonNullable<DataTriggerDecl['derives']> }))).toEqual([]);
  });
  it('同じ表の BEFORE トリガが名前の順に同じ親を共有 → 排他と掴み直すと赤(点検 D25s-2)。強い方が先なら緑', () => {
    const shareFirst: DataTriggerDecl = { name: 'a_guard', functionName: 'a_guard', fires: 'before insert', deferred: false, supplies: [], params: {}, locks: { rooms: 'share' } };
    const exclusive = trigger({ locks: { rooms: 'update' }, copiesFrom: [COPY] });
    const tables = (triggers: readonly DataTriggerDecl[]) => [
      dataTable('rooms', { entity: 'room' }),
      dataTable('room_notes', { entity: 'room_note' }),
      dataTable('slots', { entity: 'slot', foreignKeys: [{ column: 'room_id', references: 'rooms', onDelete: 'cascade', refuseErased: { column: 'state', values: ['erased'], word: 'w', message: 'm', freezesPersonal: FREEZE } }], triggers: [...triggers] }),
    ];
    expect(verifyLockDecls(domain(), dataTableModel(tables([shareFirst, exclusive]))).map((finding) => finding.message)).toEqual([
      'slots の BEFORE トリガ a_guard が rooms を共有で掴んだ後に、名前の順で後の apply_slot が同じ親を排他で掴みます(insert の格上げ。同じ親への 2 本が共有を持ったまま互いの排他を待つ)',
    ]);
    expect(verifyLockDecls(domain(), dataTableModel(tables([{ ...shareFirst, name: 'z_guard', functionName: 'z_guard' }, exclusive]))).map((finding) => finding.message)).toEqual([]);
  });
});
