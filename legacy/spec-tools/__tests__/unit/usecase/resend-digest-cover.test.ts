/**
 * 要約が誰を覆うかの唯一の導出(`digestCoverOf`。点検 24 回目 O24-1)のテスト。
 *
 * 読み手は 2 つ(消去の本文の期待 `digestAnchorsOf` と T24 の錨の列の道)で、どちらもこれを呼ぶだけである。
 * 固定するのは 4 種類の枝と並び、手順が作る表が分からないとき(`created: null`。T24)は錨を指す表の全部を子とみなして
 * 期待の側の枝を含むこと、2 段の参照を数えないこと。
 */

import { describe, expect, it } from 'vitest';
import { digestCoverOf, foreignKeyRefs } from '../../../lib/usecase/resend-digest-cover.js';

const fk = (column: string, references: string) => ({ column, references, onDelete: 'cascade' as const });
const TABLES = [
  { table: 'members', foreignKeys: [fk('invited_via', 'slots')] },
  { table: 'slots', foreignKeys: [fk('owner_id', 'members'), fk('event_id', 'events')] },
  { table: 'companions', foreignKeys: [fk('slot_id', 'slots'), fk('member_id', 'members')] },
  { table: 'companion_history', foreignKeys: [fk('slot_id', 'slots'), fk('companion_id', 'companions'), fk('former_member_id', 'members')] },
  { table: 'events', foreignKeys: [fk('organizer_id', 'members')] },
];
const NAMES = TABLES.map((table) => table.table);
const REFS = foreignKeyRefs(TABLES);

describe('digestCoverOf', () => {
  it('錨の表 → 逆向き → 子の表 → 記録の表の順に、本人を指す列を枝にする(錨・逆向きの up は id、子と記録は錨を指す列)', () => {
    expect(digestCoverOf('slots', ['slots', 'companions'], NAMES, 'members', REFS)).toEqual([
      { from: 'slots', column: 'owner_id', kind: 'anchor', up: 'id' },
      { from: 'slots', column: 'invited_via', reverse: true, kind: 'reverse', up: 'id' },
      { from: 'companions', column: 'member_id', kind: 'child', up: 'slot_id' },
      { from: 'companion_history', column: 'former_member_id', kind: 'record', up: 'slot_id' },
    ]);
  });

  it('手順が作る表が分からない(created: null)なら、錨を指して本人を指す表の全部を子とみなし、期待の側の枝を全部含む', () => {
    const wide = digestCoverOf('slots', null, NAMES, 'members', REFS).map(({ from, column }) => `${from}.${column}`);
    const narrow = digestCoverOf('slots', ['slots', 'companions'], NAMES, 'members', REFS).map(({ from, column }) => `${from}.${column}`);
    expect(narrow.filter((branch) => !wide.includes(branch))).toEqual([]);
    expect(wide).toEqual(['slots.owner_id', 'slots.invited_via', 'companions.member_id', 'companion_history.former_member_id']);
  });

  it('2 段の参照(錨 → 中間の表 → 本人)は数えない(中間の表の人は要約の入力に名指されない)', () => {
    const tables = [{ table: 'members', foreignKeys: [] }, { table: 'events', foreignKeys: [fk('organizer_id', 'members')] }, { table: 'tickets', foreignKeys: [fk('event_id', 'events')] }];
    expect(digestCoverOf('tickets', null, tables.map((table) => table.table), 'members', foreignKeyRefs(tables))).toEqual([]);
  });
});
