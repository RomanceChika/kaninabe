/**
 * 消去の本文が要約の錨に届くための期待(`digestAnchorsOf`。点検 23 回目 A23-4 / A23-2)のテスト。
 *
 * 枝は data_table の外部キーだけから閉じて決める。固定するのは 4 種類の枝(錨の表の本人の列・本人の表から錨への逆向き・手順が作る子の表・
 * 子の行を指す紐づけの記録)と、手順が作らない表の参照を数えないこと、消えうるかを呼び手の定義で決めること。
 */

import { describe, expect, it } from 'vitest';
import { digestAnchorsOf } from '../../../lib/usecase/resend-digest-cover.js';

const fk = (column: string, references: string) => ({ column, references, onDelete: 'cascade' as const });
const TABLES = [
  { table: 'members', foreignKeys: [fk('invited_via', 'invites')] },
  { table: 'slots', foreignKeys: [fk('owner_id', 'members'), fk('event_id', 'events')] },
  { table: 'companions', foreignKeys: [fk('slot_id', 'slots'), fk('member_id', 'members')] },
  { table: 'companion_history', foreignKeys: [fk('slot_id', 'slots'), fk('companion_id', 'companions'), fk('former_member_id', 'members')] },
  { table: 'songs', foreignKeys: [fk('slot_id', 'slots')] },
  { table: 'invites', foreignKeys: [fk('issued_by', 'members')] },
  { table: 'events', foreignKeys: [fk('organizer_id', 'members')] },
  { table: 'bookings', foreignKeys: [fk('event_id', 'events'), fk('booker_id', 'members')] },
];

describe('digestAnchorsOf', () => {
  it('錨の表の本人の列・手順が作る子の表の本人の列・子の行を指す紐づけの記録の本人の列を枝にし、枝が select すべき錨の id の列(up)を添える(手順が作らない表は数えない。点検 25 回目 A25-3)', () => {
    const anchors = digestAnchorsOf([{ event: 'usecase:s.register', anchor: 'slots', created: ['slots', 'companions', 'songs'] }], TABLES, 'members', (table) => table === 'slots');
    expect(anchors).toEqual([
      {
        event: 'usecase:s.register',
        table: 'slots',
        branches: [
          { from: 'slots', column: 'owner_id', up: 'id' },
          { from: 'companions', column: 'member_id', up: 'slot_id' },
          { from: 'companion_history', column: 'former_member_id', up: 'slot_id' },
        ],
        removable: true,
      },
    ]);
  });

  it('本人の表から錨の表への逆向きの参照(本人を生んだ招待)も枝にする', () => {
    const [anchor] = digestAnchorsOf([{ event: 'usecase:i.invite', anchor: 'invites', created: ['invites'] }], TABLES, 'members', () => false);
    expect(anchor?.branches).toEqual([
      { from: 'invites', column: 'issued_by', up: 'id' },
      { from: 'invites', column: 'invited_via', reverse: true, up: 'id' },
    ]);
    expect(anchor?.removable).toBe(false);
  });

  it('錨を指して本人を指す表でも、手順が作らない(催しを指す予約の予約者)なら枝にしない', () => {
    const [anchor] = digestAnchorsOf([{ event: 'usecase:e.create', anchor: 'events', created: ['events'] }], TABLES, 'members', () => false);
    expect(anchor?.branches).toEqual([{ from: 'events', column: 'organizer_id', up: 'id' }]);
  });

  it('保存点は event の辞書順に並べる(生成物が揺れない)', () => {
    const anchors = digestAnchorsOf(
      [
        { event: 'usecase:z.b', anchor: 'events', created: ['events'] },
        { event: 'usecase:a.b', anchor: 'invites', created: ['invites'] },
      ],
      TABLES,
      'members',
      () => false,
    );
    expect(anchors.map((anchor) => anchor.event)).toEqual(['usecase:a.b', 'usecase:z.b']);
  });
});
