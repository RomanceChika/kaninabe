/**
 * 導出の宣言の**親の下の末尾の番号**の形(`derives.{列}: { append_within: {親を指す列}, mode: initial }`。点検 24 回目 B24-1)の
 * ユニットテスト。通らない理由(`derive-append-problems.ts` / `derive-problems.ts`)と本文(`ddl-derive-triggers.ts`)を固定する
 * (読み取りの形は parse-data-table.test.ts)。
 *
 *   - 理由: 方式は initial だけ・対象は supplied_by: db の整数・範囲は親を直の外部キーで指す列・親を `locks` で排他に掴む・
 *     範囲の列を埋める別のトリガが名前の順で先に発火する・列の範囲(上端 max があり、下端 min が 1 以下。点検 25 回目 B25-1)。正しい宣言には理由が無い
 *   - 本文: 空のときだけ、親の行を排他で掴んでから同じ親の最大 + 1 を入れ、上端を越えたら閉じた語 append_full で断る。定義者の権限で実行する
 */

import { describe, expect, it } from 'vitest';
import { APPEND_FULL, deriveTriggersIn } from '../../../lib/sql/ddl-derive-triggers.js';
import { derivationProblemsOf } from '../../../lib/sql/derive-problems.js';
import { buildDdlMigration } from '../../../lib/sql/ddl-migration.js';
import { APPEND_WORDS } from '../../../lib/messages/messages-ddl.js';
import { tableDdlPlan } from '../../../lib/sql/ddl-plan.js';
import type { DataTableSpec, DataTriggerDecl } from '../../../lib/model/data/types.js';
import type { DataIndexDecl } from '../../../lib/model/data/types-shape.js';
import type { FieldDef, SpecModel } from '../../../lib/model/types.js';
import { accessSpec, aggregate, entitySpec, field, loc, specModel } from '../../helpers/model-builder.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 番号の欄(既定は範囲 1〜50 の supplied_by: db の整数)。 */
function positionField(range: { readonly min?: number; readonly max?: number } = { min: 1, max: 50 }): FieldDef {
  return { ...field('position', { kind: 'integer' }, { required: true }), suppliedBy: 'db', ...range };
}

/** 題材: 部屋(rooms)の下に並ぶ枠(slots)。枠の番号(position)は部屋の下の末尾。部屋の ID は写しのトリガが埋めうる。 */
function domain(position: FieldDef = positionField(), writable = false): SpecModel {
  return specModel([
    aggregate('room', { entity: entitySpec('room', { fields: [field('id', { kind: 'uuid' }, { auto: true })] }) }),
    aggregate('slot', {
      ...(writable ? { access: accessSpec('slot', { writes: [{ by: 'staff', fields: ['position'], location: loc() }] }) } : {}),
      entity: entitySpec('slot', {
        fields: [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('room_id', { kind: 'ref', entity: 'room' }, { required: true }),
          field('title', { kind: 'string' }, { required: true }),
          position,
        ],
      }),
    }),
  ]);
}

/** 番号のトリガ(既定は正しい宣言)。 */
function numbering(init: Partial<DataTriggerDecl> = {}): DataTriggerDecl {
  return {
    name: 'number_slot_position',
    functionName: 'number_slot_position',
    fires: 'before insert',
    deferred: false,
    supplies: ['position'],
    params: {},
    derives: [{ column: 'position', within: 'room_id', mode: 'initial' }],
    locks: { rooms: 'update' },
    ...init,
  };
}

/** (部屋, 番号)の一意の索引(点検 25 回目 A25-2。番号の一意は DB が最後に守る線)。 */
const ORDER_UNIQUE: DataIndexDecl = { name: 'slots_position_unique', on: ['room_id', 'position'], unique: true };

/** 枠の表(部屋を指す外部キーと、(部屋, 番号)の一意の索引つき)。 */
function table(triggers: readonly DataTriggerDecl[], indexes: readonly DataIndexDecl[] = [ORDER_UNIQUE]): DataTableSpec {
  return dataTable('slots', {
    entity: 'slot',
    foreignKeys: [{ column: 'room_id', references: 'rooms', onDelete: 'cascade' }],
    indexes: [...indexes],
    triggers: [...triggers],
  });
}

/** 通らない理由の文言。 */
function reasons(trigger: DataTriggerDecl, spec: DataTableSpec = table([trigger]), model: SpecModel = domain()): readonly string[] {
  return derivationProblemsOf(trigger, spec, model).map((entry) => entry.reason);
}

describe('末尾の番号の形が通らない理由', () => {
  it('正しい宣言には理由が無い(方式は initial と insert_at の 2 つ)', () => {
    expect(reasons(numbering())).toEqual([]);
    expect(reasons(numbering({ derives: [{ column: 'position', within: 'room_id', mode: 'insert_at' }] }))).toEqual([]);
  });

  it.each([
    ['方式が follow', numbering({ derives: [{ column: 'position', within: 'room_id', mode: 'follow' }] }), '方式(mode)が "follow"'],
    ['範囲が外部キーでない', numbering({ derives: [{ column: 'position', within: 'title', mode: 'initial' }] }), '親を直の外部キーで指す自表の欄ではありません'],
    ['範囲が自分自身', numbering({ derives: [{ column: 'position', within: 'position', mode: 'initial' }] }), '親を直の外部キーで指す自表の欄ではありません'],
    ['範囲が欄に無い', numbering({ derives: [{ column: 'position', within: 'missing_id', mode: 'initial' }] }), '親を直の外部キーで指す自表の欄ではありません'],
    ['親を掴む宣言が無い', numbering({ locks: {} }), '排他で掴むと宣言していません'],
    ['親を共有でしか掴まない', numbering({ locks: { rooms: 'share' } }), '排他で掴むと宣言していません'],
  ] as const)('%s', (_title, trigger, expected) => {
    expect(reasons(trigger).some((reason) => reason.includes(expected))).toBe(true);
  });

  it('対象が整数でない・supplied_by: db でないなら止める', () => {
    const text = { ...field('position', { kind: 'string' }, { required: true }), suppliedBy: 'db' as const };
    expect(reasons(numbering(), table([numbering()]), domain(text)).some((reason) => reason.includes('整数(integer)ではありません'))).toBe(true);
    const plain = field('position', { kind: 'integer' }, { required: true });
    expect(reasons(numbering(), table([numbering()]), domain(plain)).some((reason) => reason.includes('supplied_by: db を宣言していません'))).toBe(true);
  });

  // 点検 25 回目 B25-1: 末尾の番号は max + 1 を振るので、列の範囲の上端が無いと型の上限まで伸び(22003 の想定外の失敗)、append_full で断れない。
  // writes で人が番号を書き換えられるなら、件数より早く上端に届く(編集で最後の番号を上端にすると、以後足せない)。
  it.each([
    ['上端が無い', positionField({ min: 1 }), false, '範囲の上端(max)が宣言されていません'],
    ['上端が無く writes で書き換えられる', positionField({ min: 1 }), true, 'writes で人が書き換えられる'],
    ['下端が 1 より大きい', positionField({ min: 2, max: 50 }), false, '範囲の下端(min)2 が 1 より大きい'],
  ] as const)('列の範囲: %s', (_title, position, writable, expected) => {
    expect(reasons(numbering(), table([numbering()]), domain(position, writable)).some((reason) => reason.includes(expected))).toBe(true);
  });

  it('上端と下端があれば、writes で書き換えられても通す(上端に届いた作成は本文が append_full で断る)', () => {
    expect(reasons(numbering(), table([numbering()]), domain(positionField(), true))).toEqual([]);
    expect(reasons(numbering(), table([numbering()]), domain(positionField({ max: 50 }), true))).toEqual([]);
  });

  // 点検 25 回目 A25-2: 番号の一意は、並べ替えの口(人が書く)と隔離の水準の拒否を通らない経路も含めて DB が最後に守る線。
  it.each([
    ['索引が無い', [] as readonly DataIndexDecl[]],
    ['一意でない索引', [{ ...ORDER_UNIQUE, unique: false }]],
    ['部分の一意の索引(where)', [{ ...ORDER_UNIQUE, where: 'position is not null' }]],
    ['番号だけの一意の索引', [{ ...ORDER_UNIQUE, on: ['position'] }]],
    ['範囲だけの一意の索引', [{ ...ORDER_UNIQUE, on: ['room_id'] }]],
    ['ほかの列を足した一意の索引', [{ ...ORDER_UNIQUE, on: ['room_id', 'position', 'title'] }]],
  ] as const)('(範囲, 番号)の一意の索引: %s なら止める', (_title, indexes) => {
    expect(reasons(numbering(), table([numbering()], indexes)).some((reason) => reason.includes('(room_id, position) の一意の索引が宣言されていません'))).toBe(true);
  });

  it('(範囲, 番号)の一意の索引は列の順によらず通す', () => {
    expect(reasons(numbering(), table([numbering()], [{ ...ORDER_UNIQUE, on: ['position', 'room_id'] }]))).toEqual([]);
  });

  it('範囲の列を埋める別のトリガが名前の順で後に発火するなら止め、先なら通す', () => {
    const supplier = (name: string): DataTriggerDecl => ({ name, functionName: name, fires: 'before insert', deferred: false, supplies: ['room_id'], params: {} });
    expect(reasons(numbering(), table([supplier('zz_fill_room'), numbering()])).some((reason) => reason.includes('名前の順で先に発火します'))).toBe(true);
    expect(reasons(numbering(), table([supplier('apply_slot_room'), numbering()]))).toEqual([]);
  });
});

describe('末尾の番号の本文', () => {
  it('空のときだけ、repeatable read を共有の拒否で断り、親の行を排他で掴んでから同じ親の最大 + 1 を入れ、上端を越えたら append_full で断り、定義者の権限で実行する', () => {
    const planned = deriveTriggersIn(table([numbering()]), domain())[0];
    expect(planned?.function.body).toEqual([
      'if new.position is null then',
      "    if current_setting('transaction_isolation') <> 'read committed' then",
      '        raise exception using',
      `            message = '${APPEND_WORDS.isolationRefusal}',`,
      "            errcode = 'invalid_transaction_state';",
      '    end if;',
      '    perform 1 from public.rooms p where p.id = new.room_id for update;',
      '    new.position := (select coalesce(max(s.position), 0) + 1 from public.slots s where s.room_id = new.room_id);',
      '    if new.position > 50 then',
      "        raise exception using errcode = 'UC412', message = 'usecase_guard:', detail = 'append_full';",
      '    end if;',
      'end if;',
      'return new;',
    ]);
    expect(APPEND_FULL).toBe('append_full');
    expect(planned?.function.securityDefiner).toBe(true);
    expect(planned?.function.comment).toContain('position = max(position) + 1 within room_id (initial)');
  });

  // fix25s: 入れてきた値を位置と読む方式。後ろの番号から 1 行ずつずらす(1 文の + 1 は (範囲, 番号) の一意の索引に途中で当たる。
  // 一時の負の値は範囲の CHECK の下端に当たる)。ずらした後の最後は「いまの最大 + 1」なので、上端の断りは動かす前に置く。
  it('insert_at: repeatable read を断り、親を排他で掴み、ずらすと上端を越えるなら何も動かす前に断り、空か末尾の先なら末尾、それ以外は同じ親の行を id の順に掴んでから後ろから 1 行ずつずらす', () => {
    const trigger = numbering({ derives: [{ column: 'position', within: 'room_id', mode: 'insert_at' }] });
    const planned = deriveTriggersIn(table([trigger]), domain())[0];
    const tail = '(select coalesce(max(s.position), 0) from public.slots s where s.room_id = new.room_id)';
    expect(planned?.function.body).toEqual([
      "if current_setting('transaction_isolation') <> 'read committed' then",
      '    raise exception using',
      `        message = '${APPEND_WORDS.isolationRefusal}',`,
      "        errcode = 'invalid_transaction_state';",
      'end if;',
      'perform 1 from public.rooms p where p.id = new.room_id for update;',
      `if ${tail} + 1 > 50 then`,
      "    raise exception using errcode = 'UC412', message = 'usecase_guard:', detail = 'append_full';",
      'end if;',
      `if new.position is null or new.position > ${tail} then`,
      `    new.position := ${tail} + 1;`,
      'else',
      '    perform 1 from public.slots s where s.room_id = new.room_id order by s.id for update;',
      `    for shifted in reverse ${tail} .. new.position loop`,
      '        update public.slots s set position = shifted + 1 where s.room_id = new.room_id and s.position = shifted;',
      '    end loop;',
      'end if;',
      'return new;',
    ]);
    expect(planned?.function.securityDefiner).toBe(true);
    expect(planned?.function.comment).toContain('position = max(position) + 1 within room_id (insert_at)');
  });

  it('通らない宣言は本文を出さない', () => {
    expect(deriveTriggersIn(table([numbering({ locks: {} })]), domain())).toEqual([]);
    // 上端の無い列は断る語を出せないので、本文を出さない(T15 / T17 が理由を名指す)。
    expect(deriveTriggersIn(table([numbering()]), domain(positionField({ min: 1 })))).toEqual([]);
  });

  it('表の DDL に security definer の関数と存在ガード付きのトリガとして出る', () => {
    const spec = table([numbering()]);
    const plan = tableDdlPlan(spec, domain(), [spec]);
    const sql = plan === null ? '' : buildDdlMigration(plan);
    expect(sql).toContain('create or replace function public.number_slot_position() returns trigger');
    expect(sql).toContain('security definer');
    expect(sql).toContain('before insert on public.slots');
  });
});
