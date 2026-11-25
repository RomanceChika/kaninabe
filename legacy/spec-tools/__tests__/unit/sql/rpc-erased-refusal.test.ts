/**
 * `rpc-erased-refusal.ts` のユニットテスト —— 消去された行への紐づけの関所(点検 19 回目 A19-4)と、指したままの行の個人列の凍結(20 回目 A20-1)。
 */

import { describe, expect, it } from 'vitest';
import { erasedRefusalChecks, erasedRefusalsOf, frozenBeforeCapture, frozenOwnerChecks, frozenOwnersOf, type FrozenOwner } from '../../../lib/sql/rpc-erased-refusal.js';
import { lockGuardRows } from '../../../lib/sql/rpc-body-lock.js';
import type { RpcBodyFacts } from '../../../lib/sql/rpc-facts.js';
import type { RpcParam } from '../../../lib/sql/rpc-params.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 引数(名前だけを見る)。 */
function params(...names: readonly string[]): readonly RpcParam[] {
  return names.map((name) => ({ name, type: 'uuid', role: { kind: 'actor' } }) as unknown as RpcParam);
}

const TABLE = dataTable('slots', {
  entity: 'slot',
  foreignKeys: [
    { column: 'person_id', references: 'people', onDelete: 'no_action', refuseErased: { column: 'state', values: ['erased'], word: 'slot_person_erased', message: '消された人には紐づけられません' } },
    { column: 'room_id', references: 'rooms', onDelete: 'cascade' },
  ],
});

describe('紐づけの関所の引き当て', () => {
  it.each([
    ['引数で宣言の列を書く', ['person_id'], params('p_person_id'), ['person_id']],
    ['列を書かない', ['state'], params('p_person_id'), []],
    ['引数が無い(変更集合から書く形は検査が赤にする)', ['person_id'], params('p_changes'), []],
    ['宣言の無い外部キー', ['room_id'], params('p_room_id'), []],
  ] as const)('%s', (_title, written, given, expected) => {
    expect(erasedRefusalsOf(TABLE, given, written).map((refusal) => refusal.column)).toEqual(expected);
  });

  it('関所の本文は、紐づけ先が消去済みなら宣言の語で断る(操作 ID の式はそのまま埋める)', () => {
    const [refusal] = erasedRefusalsOf(TABLE, params('p_person_id'), ['person_id']);
    if (refusal === undefined) throw new Error('関所がありません');
    expect(refusal).toMatchObject({ table: 'people', param: 'p_person_id', markColumn: 'state', values: ['erased'], word: 'slot_person_erased' });
    const sql = erasedRefusalChecks([refusal], 'p_event_id').join('\n');
    expect(sql).toContain("if exists (select 1 from public.people le where le.id = p_person_id and le.state in ('erased')) then");
    expect(sql).toContain("raise exception using errcode = 'UC412', message = 'usecase_guard:' || p_event_id, detail = 'slot_person_erased';");
    expect(erasedRefusalChecks([], 'p_event_id')).toEqual([]);
  });
});

/** 個人列 label・memo を持つ枠(持ち主 person_id は凍結つき)。 */
const FROZEN_TABLE = dataTable('slots', {
  entity: 'slot',
  foreignKeys: [
    {
      column: 'person_id',
      references: 'people',
      onDelete: 'no_action',
      refuseErased: { column: 'state', values: ['erased', 'gone'], word: 'slot_person_erased', message: 'm', freezesPersonal: { word: 'slot_person_frozen', message: 'f' } },
    },
    { column: 'room_id', references: 'rooms', onDelete: 'cascade', refuseErased: { column: 'state', values: ['erased'], word: 'slot_room_erased', message: 'm' } },
  ],
});

/** 掴む文を組み立てるのに要る事実だけの束(他の欄は掴む文に効かない)。 */
function lockFacts(frozenOwners: readonly FrozenOwner[], actorTable: string | null): RpcBodyFacts {
  return {
    table: 'slots',
    targetId: 'p_slot_id',
    guardRows: [],
    guardLockRows: [],
    closureLockRows: [],
    erasedRefusals: [],
    frozenOwners,
    hasActor: actorTable !== null,
    actorTable,
  } as unknown as RpcBodyFacts;
}

describe('指したままの行の個人列の凍結(点検 20 回目 A20-1)', () => {
  it.each([
    ['個人列を書く', ['label'], ['person_id']],
    ['個人列を書かない(凍結は出ない)', [], []],
  ] as const)('引き当て: %s', (_title, personal, expected) => {
    // 凍結を宣言しない外部キー(room_id)は、書く個人列があっても凍結を出さない。
    expect(frozenOwnersOf(FROZEN_TABLE, personal).map((owner) => owner.column)).toEqual(expected);
  });

  it('関所の本文: 控えた値から個人列が変わり、指す行が消去済みなら凍結の語で断る', () => {
    const owners = frozenOwnersOf(FROZEN_TABLE, ['label', 'memo']);
    expect(owners).toEqual([{ column: 'person_id', table: 'people', markColumn: 'state', values: ['erased', 'gone'], word: 'slot_person_frozen', personal: ['label', 'memo'] }]);
    expect(frozenBeforeCapture(owners, 'slots', 'p_slot_id').join('\n')).toContain('select * into v_frozen_before from public.slots where id = p_slot_id;');
    const sql = frozenOwnerChecks(owners, "'slot.update'").join('\n');
    expect(sql).toContain('if (v_row.label is distinct from v_frozen_before.label\n        or v_row.memo is distinct from v_frozen_before.memo)');
    // 断る値は書いた後の行の外部キー(掴んだ行と同じ列。紐づけを外した行は null で凍らない)。
    expect(sql).toContain("and exists (select 1 from public.people le where le.id = v_row.person_id and le.state in ('erased', 'gone')) then");
    expect(sql).toContain("raise exception using errcode = 'UC412', message = 'usecase_guard:' || 'slot.update', detail = 'slot_person_frozen';");
    expect(frozenBeforeCapture([], 'slots', 'p_slot_id')).toEqual([]);
    expect(frozenOwnerChecks([], "'slot.update'")).toEqual([]);
  });

  it('掴む文: 指す行が実行者の集約と同じ表なら、対象の行の列から引いて実行者の行と 1 文で id の昇順に共有で掴む', () => {
    const owners = frozenOwnersOf(FROZEN_TABLE, ['label']);
    const sql = lockGuardRows(lockFacts(owners, 'people'), true).join('\n');
    expect(sql).toContain('from public.people la, public.slots t\n    where t.id = p_slot_id\n      and la.id in (p_actor_id, t.person_id)\n    order by la.id\n    for share of la;');
    // 対象の行の先掴み(排他)は表名のバイト順で people の後(slots)に来る。
    expect(sql.indexOf('for share of la;')).toBeLessThan(sql.indexOf('for update of t;'));
  });

  it('掴む文: 別の表なら、対象の行の列から引いて共有で掴む(実行者が無くても掴む)', () => {
    const owners = frozenOwnersOf(FROZEN_TABLE, ['label']);
    const sql = lockGuardRows(lockFacts(owners, 'members'), true).join('\n');
    expect(sql).toContain('from public.slots t, public.people lf0\n    where t.id = p_slot_id\n      and lf0.id = t.person_id\n    for share of lf0;');
    expect(sql).toContain('from public.members la\n    where la.id = p_actor_id\n    for share of la;');
    expect(lockGuardRows(lockFacts(owners, null), true).join('\n')).toContain('for share of lf0;');
  });

  it('掴む文: 凍結が無い・作成(対象の行が無い)なら、実行者の行の掴みは今までの 1 行の形のまま', () => {
    const owners = frozenOwnersOf(FROZEN_TABLE, ['label']);
    for (const sql of [lockGuardRows(lockFacts([], 'people'), true).join('\n'), lockGuardRows(lockFacts(owners, 'people'), false).join('\n')]) {
      expect(sql).toContain('from public.people la\n    where la.id = p_actor_id\n    for share of la;');
      expect(sql).not.toContain('person_id');
    }
  });
});
