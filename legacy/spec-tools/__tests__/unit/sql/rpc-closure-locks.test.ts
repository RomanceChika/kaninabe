/**
 * `rpc-closure-locks.ts` のユニットテスト —— 定型 RPC の書き込みが**トリガと外部キーの連鎖を通して**掴む行を、
 * 宣言から先掴みの列に入れる(点検 18 回目 O18-1)。
 *
 * 題材は合成の 3 表 + 監査ログ: 部屋(rooms)・部屋のメモ(room_notes。部屋を指す)・メモの添え書き(note_tags。メモを指す)。
 * 監査ログのトリガが room_notes を update する形が O18-1(催し → シートの項目)と同じ形である。
 */

import { describe, expect, it } from 'vitest';
import { closureLockRows, type ClosureLockInput } from '../../../lib/sql/rpc-closure-locks.js';
import type { DataForeignKeyDecl, DataFunctionDecl, DataTableSpec, DataTriggerDecl, DataWriteKind } from '../../../lib/model/data/types.js';
import type { TriggerCopySource } from '../../../lib/model/data/types-locks.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 関数の宣言(書き込み先の種類だけを持つ)。 */
function fn(name: string, kind: DataFunctionDecl['kind'], writes: Readonly<Record<string, readonly DataWriteKind[]>> = {}): DataFunctionDecl {
  return { name, args: [], params: [], kind, alsoWrites: Object.keys(writes), alsoWriteKinds: writes } as DataFunctionDecl;
}

/** トリガの宣言。 */
function trigger(name: string, fires: string): DataTriggerDecl {
  return { name, functionName: name, fires, deferred: false, supplies: [], params: {} } as DataTriggerDecl;
}

/** 外部キー。 */
function fk(column: string, references: string, onDelete: DataForeignKeyDecl['onDelete']): DataForeignKeyDecl {
  return { column, references, onDelete };
}

/** 全 data_table(監査ログのトリガ・外部キーの動作を差し替えられる)。 */
function tables(options: {
  readonly auditWrites?: Readonly<Record<string, readonly DataWriteKind[]>>;
  readonly auditFires?: string;
  readonly notesOnDelete?: DataForeignKeyDecl['onDelete'];
  readonly deleteWrites?: Readonly<Record<string, readonly DataWriteKind[]>>;
}): readonly DataTableSpec[] {
  return [
    dataTable('domain_events', {
      internal: true,
      framework: 'domain_events',
      triggers: [trigger('sync_notes', options.auditFires ?? 'after insert')],
      functions: [fn('sync_notes', 'trigger', options.auditWrites ?? { room_notes: ['update'] })],
    }),
    dataTable('rooms', {
      entity: 'room',
      functions: [
        { ...fn('delete_room', 'rpc', options.deleteWrites ?? { domain_events: ['insert'], room_notes: ['delete'], note_tags: ['update'] }), shape: 'delete' } as DataFunctionDecl,
      ],
    }),
    dataTable('room_notes', { entity: 'room_note', foreignKeys: [fk('room_id', 'rooms', options.notesOnDelete ?? 'cascade')] }),
    dataTable('note_tags', { entity: 'note_tag', foreignKeys: [fk('note_id', 'room_notes', 'set_null'), fk('owner_id', 'auth.users', 'cascade')] }),
  ];
}

/** 入力(部屋の RPC 1 本)。 */
function input(shape: ClosureLockInput['shape'], all: readonly DataTableSpec[], name = 'apply_room_transition'): ClosureLockInput {
  const table = all.find((candidate) => candidate.table === 'rooms');
  if (table === undefined) throw new Error('rooms がありません');
  return { name, shape, table, tables: all, targetId: 'p_room_id' };
}

describe('監査ログのトリガが書く行(O18-1 の形)', () => {
  it('遷移・編集・削除は、トリガが書く表のうち自表を直に指す行を掴む', () => {
    for (const shape of ['transition', 'update'] as const) {
      expect(closureLockRows(input(shape, tables({})))).toEqual([
        { table: 'room_notes', alias: 'c0', from: ['public.room_notes c0'], where: ['c0.room_id = p_room_id'], mode: 'update', idKey: null, ordered: true },
      ]);
    }
  });

  it('作成は子の行を掴まない(対象の行がまだ無く、それを指す行も無い)', () => {
    expect(closureLockRows(input('create', tables({})))).toEqual([]);
  });

  it.each([
    ['トリガ関数が書き込みを宣言しない', { auditWrites: {} }],
    ['書き込みが insert だけ(既存の行を掴まない)', { auditWrites: { room_notes: ['insert'] as const } }],
    ['トリガが追記で発火しない', { auditFires: 'after update' }],
  ])('掴まない: %s', (_, options) => {
    expect(closureLockRows(input('transition', tables(options)))).toEqual([]);
  });

  it('scrub も既存の行を書き換えるので掴む', () => {
    expect(closureLockRows(input('transition', tables({ auditWrites: { room_notes: ['scrub'] } }))).map((row) => row.table)).toEqual(['room_notes']);
  });
});

describe('削除の外部キーの連鎖(also_writes の閉包)', () => {
  it('cascade で消える表を経て、set null で書き換わる孫まで、自表から鎖を辿って掴む', () => {
    const rows = closureLockRows(input('delete', tables({ auditWrites: {} }), 'delete_room'));
    expect(rows).toEqual([
      { table: 'room_notes', alias: 'c0', from: ['public.room_notes c0'], where: ['c0.room_id = p_room_id'], mode: 'update', idKey: null, ordered: true },
      {
        table: 'note_tags',
        alias: 'c1',
        from: ['public.room_notes c1_0', 'public.note_tags c1'],
        where: ['c1_0.room_id = p_room_id', 'c1.note_id = c1_0.id'],
        mode: 'update',
        idKey: null,
        ordered: true,
      },
    ]);
  });

  it('set null で書き換わるだけの表の子は辿らない(その削除では動かない)', () => {
    const rows = closureLockRows(input('delete', tables({ auditWrites: {}, notesOnDelete: 'set_null', deleteWrites: { room_notes: ['update'], note_tags: ['update'] } }), 'delete_room'));
    expect(rows.map((row) => row.table)).toEqual(['room_notes']);
  });

  it('also_writes に無い表・連鎖しない外部キー(no_action)は掴まない', () => {
    expect(closureLockRows(input('delete', tables({ auditWrites: {}, deleteWrites: { domain_events: ['insert'] } }), 'delete_room'))).toEqual([]);
    expect(closureLockRows(input('delete', tables({ auditWrites: {}, notesOnDelete: 'no_action' }), 'delete_room'))).toEqual([]);
  });

  it('監査ログのトリガと連鎖が同じ道を指せば 1 回だけ掴む', () => {
    const rows = closureLockRows(input('delete', tables({}), 'delete_room'));
    expect(rows.map((row) => row.where.join(' and '))).toEqual(['c0.room_id = p_room_id', 'c1_0.room_id = p_room_id and c1.note_id = c1_0.id']);
  });
});

describe('トリガの掴みの宣言(locks)と写し元(copies_from)(点検 19 回目 A19-1 / A19-3 / O19-3)', () => {
  /** 枠(slots)は部屋を指し、トリガが部屋を排他で掴み、メモの本文を写す。 */
  function declared(options: { readonly fires?: string; readonly locks?: Readonly<Record<string, 'share' | 'update'>>; readonly copies?: readonly TriggerCopySource[] }): readonly DataTableSpec[] {
    return [
      dataTable('rooms', { entity: 'room' }),
      dataTable('room_notes', { entity: 'room_note', foreignKeys: [fk('room_id', 'rooms', 'cascade')] }),
      dataTable('slots', {
        entity: 'slot',
        foreignKeys: [fk('room_id', 'rooms', 'cascade')],
        triggers: [
          {
            ...trigger('check_slot', options.fires ?? 'before insert or update of state, room_id'),
            ...(options.locks === undefined ? {} : { locks: options.locks }),
            ...(options.copies === undefined ? {} : { copiesFrom: options.copies }),
          } as DataTriggerDecl,
        ],
      }),
    ];
  }
  function slotInput(shape: ClosureLockInput['shape'], all: readonly DataTableSpec[], written: readonly string[] | null = ['state']): ClosureLockInput {
    const table = all.find((candidate) => candidate.table === 'slots');
    if (table === undefined) throw new Error('slots がありません');
    return {
      name: 'apply_slot_transition',
      shape,
      table,
      tables: all,
      targetId: shape === 'create' ? 'p_id' : 'p_slot_id',
      writtenColumns: written,
      insertExpression: (column) => (column === 'room_id' ? 'p_room_id' : null),
    };
  }

  it('遷移は、トリガが掴む親の行を宣言の強さで、対象の行の外部キーから引いて掴む(畳みの鍵は t.{列})', () => {
    expect(closureLockRows(slotInput('transition', declared({ locks: { rooms: 'update' } })))).toEqual([
      { table: 'rooms', alias: 'c0', from: ['public.slots c0_t', 'public.rooms c0'], where: ['c0_t.id = p_slot_id', 'c0.id = c0_t.room_id'], mode: 'update', idKey: 't.room_id', ordered: false, ids: [] },
    ]);
  });

  it('作成も掴む(入れる値で親の行を引く。O19-3)', () => {
    expect(closureLockRows(slotInput('create', declared({ locks: { rooms: 'update' } })))).toEqual([
      { table: 'rooms', alias: 'c0', from: ['public.rooms c0'], where: ['c0.id = p_room_id'], mode: 'update', idKey: 'p_room_id', ordered: false, ids: [{ column: 'room_id' }] },
    ]);
  });

  it.each([
    ['update of の列を書かない編集', 'update', ['note'], 0],
    ['update of の列を書く編集', 'update', ['room_id'], 1],
    ['列が読めない編集(どの列も書くと読む)', 'update', null, 1],
    ['削除はトリガが発火しない', 'delete', null, 0],
  ] as const)('発火の引き当て: %s', (_title, shape, written, count) => {
    expect(closureLockRows(slotInput(shape, declared({ locks: { rooms: 'update' } }), written))).toHaveLength(count);
  });

  it('写し元は共有で、match の等式で選ぶ行を id の昇順に掴む(id で選ぶなら畳みの鍵を付ける)', () => {
    const copies: readonly TriggerCopySource[] = [
      { column: 'label', fromTable: 'room_notes', fromColumn: 'body', match: { room_id: 'room_id' } },
      { column: 'room_name', fromTable: 'rooms', fromColumn: 'name', match: { id: 'room_id' } },
    ];
    expect(closureLockRows(slotInput('create', declared({ copies, fires: 'before insert' })))).toEqual([
      { table: 'room_notes', alias: 'c0', from: ['public.room_notes c0'], where: ['c0.room_id = p_room_id'], mode: 'share', idKey: null, ordered: true, ids: [] },
      { table: 'rooms', alias: 'c1', from: ['public.rooms c1'], where: ['c1.id = p_room_id'], mode: 'share', idKey: 'p_room_id', ordered: true, ids: [{ column: 'room_id' }] },
    ]);
  });

  it('入れる値が言えない列の写し元・親は掴まない(黙って別の行を掴まない。検査が赤にする)', () => {
    const all = declared({ locks: { rooms: 'update' } });
    const base = slotInput('create', all);
    expect(closureLockRows({ ...base, insertExpression: () => null })).toEqual([]);
  });

  it('宣言が無ければ何も足さない', () => {
    expect(closureLockRows(slotInput('transition', declared({})))).toEqual([]);
  });

  // 編集が書き換えうる参照の欄は、書いた後の値(本文の代入と同じ字面・自表の別名 t)で親を掴み、値が 1 つと言えないので id の順にする(fix25s)。
  it('編集が書き換えうる参照の欄の親は、書いた後の値で id の順に掴む', () => {
    const changed = "case when p_changes ? 'room_id' then (p_changes ->> 'room_id')::uuid else t.room_id end";
    const base = slotInput('update', declared({ locks: { rooms: 'share' } }), ['room_id']);
    expect(closureLockRows({ ...base, updateExpression: (column) => (column === 'room_id' ? changed : null) })).toEqual([
      { table: 'rooms', alias: 'c0', from: ['public.slots t', 'public.rooms c0'], where: ['t.id = p_slot_id', `c0.id = ${changed}`], mode: 'share', idKey: 't.room_id:changed', ordered: true, ids: [{ column: 'room_id' }] },
    ]);
    // 書き換えない列(編集の式が無い)は、書く前の行の値のまま。
    expect(closureLockRows({ ...base, updateExpression: () => null })[0]?.idKey).toBe('t.room_id');
  });
  describe('親を指す列が作成の入れない写しの列(点検 24 回目 B24-1)', () => {
    /** 枠は部屋のメモを入力で指し、部屋の ID は写しのトリガがメモから写す。番号のトリガが部屋を排他で掴む。 */
    function copied(options: { readonly copyFires?: string; readonly match?: Readonly<Record<string, string>> } = {}): readonly DataTableSpec[] {
      return [
        dataTable('rooms', { entity: 'room' }),
        dataTable('room_notes', { entity: 'room_note', foreignKeys: [fk('room_id', 'rooms', 'cascade')] }),
        dataTable('slots', {
          entity: 'slot',
          foreignKeys: [fk('room_id', 'rooms', 'cascade'), fk('note_id', 'room_notes', 'cascade')],
          triggers: [
            { ...trigger('apply_slot_room', options.copyFires ?? 'before insert'), supplies: ['room_id'], copiesFrom: [{ column: 'room_id', fromTable: 'room_notes', fromColumn: 'room_id', match: options.match ?? { id: 'note_id' } }] } as DataTriggerDecl,
            { ...trigger('number_slot', 'before insert'), supplies: ['position'], locks: { rooms: 'update' } } as DataTriggerDecl,
          ],
        }),
      ];
    }
    function createInput(all: readonly DataTableSpec[]): ClosureLockInput {
      const table = all.find((candidate) => candidate.table === 'slots');
      if (table === undefined) throw new Error('slots がありません');
      return { name: 'insert_slot', shape: 'create', table, tables: all, targetId: 'p_id', insertExpression: (column) => (column === 'note_id' ? 'p_note_id' : null) };
    }
    const ROOM_OF_NOTE = '(select r1.room_id from public.room_notes r1 where r1.id = p_note_id)';

    it('写し元の行を作成の値で選ぶ副問い合わせで親を引き、宣言の強さで掴む(畳みの鍵はその式)', () => {
      expect(closureLockRows(createInput(copied())).filter((row) => row.table === 'rooms')).toEqual([
        { table: 'rooms', alias: 'c1', from: ['public.rooms c1'], where: [`c1.id = ${ROOM_OF_NOTE}`], mode: 'update', idKey: ROOM_OF_NOTE, ordered: false, ids: [] },
      ]);
    });

    it.each([
      ['写しのトリガが挿入で発火しない', { copyFires: 'before update of note_id' }],
      ['写し元の選び方が 2 つの等式', { match: { id: 'note_id', room_id: 'room_id' } }],
      ['写し元の選び方の自表の列を作成が入れない', { match: { id: 'other_id' } }],
    ] as const)('引けなければ掴まない(黙って別の行を掴まない): %s', (_title, options) => {
      expect(closureLockRows(createInput(copied(options))).filter((row) => row.table === 'rooms')).toEqual([]);
    });
  });
});
