/**
 * 表をまたぐものの**置き場**(`lib/sql/ddl-placement.ts`)の単体テスト。
 *
 * 規約網羅(ARCH-SP-BE-0001 §テーブル仕様 / design/ddl-reissue-free-changes.md §4):
 *   - 外部キーは**両側の表**のファイルに出る(先に当たる側は存在ガードで通り過ぎる)
 *   - 採番の器は**名指す全表と宣言した表**のファイルに出る(`start` は宣言のまま)
 *   - **連番を 1 つも読まない** —— 番号を入れ替えても置き場が動かない(連鎖の不在そのもの)
 */

import { describe, expect, it } from 'vitest';
import { foreignKeysIn, sequencesIn } from '../../../lib/sql/ddl-placement.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 器を名指すが宣言はしない表。 */
const EARLY = dataTable('rooms', {
  entity: 'room',
  ddlMigration: '20260912120100_ddl_rooms.sql',
  defaults: { reference_no: "nextval('shared_seq')" },
});

/** 器を宣言し、`rooms` を参照する表。 */
const LATE = dataTable('bookings', {
  entity: 'booking',
  ddlMigration: '20260912120200_ddl_bookings.sql',
  sequences: [{ name: 'shared_seq', start: 1000 }],
  foreignKeys: [{ column: 'room_id', references: 'rooms', onDelete: 'cascade' }],
});

const TABLES = [EARLY, LATE];

/** 番号だけを入れ替えた同じ 2 表(置き場が連番に依らないことを見るため)。 */
const SWAPPED = [
  dataTable('rooms', {
    entity: 'room',
    ddlMigration: '20260912129900_ddl_rooms.sql',
    defaults: { reference_no: "nextval('shared_seq')" },
  }),
  dataTable('bookings', {
    entity: 'booking',
    ddlMigration: '20260912120001_ddl_bookings.sql',
    sequences: [{ name: 'shared_seq', start: 1000 }],
    foreignKeys: [{ column: 'room_id', references: 'rooms', onDelete: 'cascade' }],
  }),
];

describe('表をまたぐものの置き場', () => {
  it('器は名指す表のファイルに出る(名指す表を作るより前に要る)', () => {
    expect(sequencesIn(EARLY, TABLES)).toEqual([{ name: 'shared_seq', start: 1000 }]);
  });

  it('器は宣言した表のファイルにも出る(`create sequence if not exists` は冪等である)', () => {
    // 番号の小さい側だけに出す形は置き場を連番に縛る。両方に出しても結果は器 1 つである。
    expect(sequencesIn(LATE, TABLES)).toEqual([{ name: 'shared_seq', start: 1000 }]);
  });

  it('自表だけが名指す器は自表のファイルに出る', () => {
    const own = dataTable('patrons', {
      entity: 'patron',
      ddlMigration: '20260912120300_ddl_patrons.sql',
      sequences: [{ name: 'patron_card_seq' }],
      defaults: { card_number: "nextval('patron_card_seq')" },
    });
    expect(sequencesIn(own, [own])).toEqual([{ name: 'patron_card_seq', start: null }]);
  });

  it('誰も名指していない器も、宣言した表のファイルに出る(宣言を落とさない)', () => {
    const declared = dataTable('tickets', {
      entity: 'ticket',
      ddlMigration: '20260912120400_ddl_tickets.sql',
      sequences: [{ name: 'ticket_seq' }],
    });
    expect(sequencesIn(declared, [declared]).map((sequence) => sequence.name)).toEqual(['ticket_seq']);
  });

  it('外部キーは両側のファイルに出る(先に当たる側は存在ガードで通り過ぎる)', () => {
    expect(foreignKeysIn(LATE, TABLES).map((fk) => fk.name)).toEqual(['bookings_room_id_fkey']);
    expect(foreignKeysIn(EARLY, TABLES).map((fk) => fk.name)).toEqual(['bookings_room_id_fkey']);
    // 参照先のファイルに出るときも、制約を張るのは列を持つ側の表である。
    expect(foreignKeysIn(EARLY, TABLES).map((fk) => fk.table)).toEqual(['bookings']);
  });

  it('自分を参照する外部キー(自己参照)は 1 度だけ出る', () => {
    const tree = dataTable('folders', {
      entity: 'folder',
      ddlMigration: '20260912120500_ddl_folders.sql',
      foreignKeys: [{ column: 'parent_id', references: 'folders', onDelete: 'set_null' }],
    });
    expect(foreignKeysIn(tree, [tree]).map((fk) => fk.name)).toEqual(['folders_parent_id_fkey']);
  });

  it('連番を入れ替えても置き場は 1 つも動かない(再発行の連鎖が起きない条件)', () => {
    // **これが根 1 の不在そのものである。** 番号で置き場を決めていたあいだは、中心の表を
    // 再発行する(= 番号が上がる)だけで外部キーと器が隣の表のファイルへ移り、中身が 1 バイトも
    // 変わらない隣の migration を付け替えることになった(実測 9 本中 8 本)。
    for (const [before, after] of [
      [EARLY, SWAPPED[0]],
      [LATE, SWAPPED[1]],
    ] as const) {
      if (before === undefined || after === undefined) continue;
      expect(foreignKeysIn(after, SWAPPED)).toEqual(foreignKeysIn(before, TABLES));
      expect(sequencesIn(after, SWAPPED)).toEqual(sequencesIn(before, TABLES));
    }
  });
});
