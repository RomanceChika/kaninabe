/**
 * T28(個人列の写しの古い値の持ち主を記録する口)のテスト。点検 19 回目の後の性質テストの反例(FUZZ_SEED=601205923)。負例と正例を表で並べる。
 */

import { describe, expect, it } from 'vitest';
import { verifyCopyOwnerMemory } from '../../../../lib/data/verifiers/t28-copy-owner-memory.js';
import type { DataFunctionDecl, DataTriggerDecl } from '../../../../lib/model/data/types.js';
import type { JobSpecModel } from '../../../../lib/model/job/types.js';
import { accessSpec, aggregate, deleteRule, entitySpec, field, specModel, writeRule } from '../../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';

/** 人(消去の対象)・部屋・席(人を指す person_id と部屋を指す room_id。個人列 name)・掲示(個人列 label を席の name から写す)。 */
function domain(writes: { readonly transition?: readonly string[]; readonly edit?: readonly string[]; readonly deletable?: boolean; readonly roomDeletable?: boolean } = { transition: ['person_id'] }) {
  return specModel({
    aggregates: [
      aggregate({ name: 'person', entity: entitySpec('person', [field('id', { kind: 'uuid' }), field('name', { kind: 'string' }, { personal: true })]) }),
      aggregate({
        name: 'room',
        entity: entitySpec('room', [field('id', { kind: 'uuid' })]),
        ...(writes.roomDeletable === true ? { access: accessSpec('room', { transitionWrites: [], writes: [], deletes: [deleteRule('member')] }) } : {}),
      }),
      aggregate({
        name: 'seat',
        entity: entitySpec('seat', [field('id', { kind: 'uuid' }), field('person_id', { kind: 'ref', entity: 'person' }), field('room_id', { kind: 'ref', entity: 'room' }), field('name', { kind: 'string' }, { personal: true }), field('memo', { kind: 'string' })]),
        access: accessSpec('seat', { transitionWrites: writes.transition ?? [], writes: writes.edit === undefined ? [] : [writeRule('member', writes.edit)], deletes: writes.deletable === true ? [deleteRule('member')] : [] }),
      }),
      aggregate({ name: 'badge', entity: entitySpec('badge', [field('id', { kind: 'uuid' }), field('seat_id', { kind: 'ref', entity: 'seat' }), field('label', { kind: 'string' }, { personal: true })]) }),
    ],
  });
}

/** 消去の効果を持つジョブカタログ(本人 = person)。 */
const JOBS = { available: true, catalog: { jobs: [{ id: 'anonymize_person', anonymizes: 'person' }] } } as unknown as JobSpecModel;

/** 掲示のトリガ(席の name を写す)。 */
const COPY_TRIGGER: DataTriggerDecl = { name: 'apply_badge', functionName: 'apply_badge', fires: 'before insert', deferred: false, supplies: ['label'], params: {}, copiesFrom: [{ column: 'label', fromTable: 'seats', fromColumn: 'name', match: { id: 'seat_id' } }] };

/** 席の記録のトリガ(宣言を差し替える)。 */
function remember(extra: Partial<DataTriggerDecl>): DataTriggerDecl {
  return { name: 'remember_seat', functionName: 'remember_seat', fires: 'before update of person_id, name or delete', deferred: false, supplies: [], params: {}, remembersOwner: 'person_id', ...extra };
}

function verify(
  seatTriggers: readonly DataTriggerDecl[],
  options: { readonly writes?: Parameters<typeof domain>[0]; readonly copies?: boolean; readonly jobs?: JobSpecModel | undefined; readonly badgeLink?: 'cascade' | 'set_null'; readonly roomLink?: 'cascade' | 'set_null'; readonly personLink?: 'set_null'; readonly peopleFunctions?: readonly DataFunctionDecl[] } = {},
) {
  const tables = [
    dataTable('people', { entity: 'person', functions: [...(options.peopleFunctions ?? [])] }),
    dataTable('rooms', { entity: 'room' }),
    dataTable('seats', {
      entity: 'seat',
      triggers: [...seatTriggers],
      foreignKeys: [
        ...(options.roomLink === undefined ? [] : [{ column: 'room_id', references: 'rooms', onDelete: options.roomLink }]),
        ...(options.personLink === undefined ? [] : [{ column: 'person_id', references: 'people', onDelete: options.personLink }]),
      ],
    }),
    dataTable('badges', {
      entity: 'badge',
      triggers: options.copies === false ? [] : [COPY_TRIGGER],
      foreignKeys: options.badgeLink === undefined ? [] : [{ column: 'seat_id', references: 'seats', onDelete: options.badgeLink }],
    }),
  ];
  return verifyCopyOwnerMemory(domain(options.writes), dataTableModel(tables), 'jobs' in options ? options.jobs : JOBS).map((finding) => finding.message);
}

describe('T28 個人列の写しの古い値の持ち主を記録する口', () => {
  it.each([
    ['削除・持ち主の列・写される個人列の更新で発火する', remember({})],
    ['列を名指さない更新は全部の列を見る', remember({ fires: 'after update or delete' })],
    ['語順に依らない', remember({ fires: 'before delete or update of name, person_id' })],
  ])('正例: %s', (_title, trigger) => {
    expect(verify([trigger])).toEqual([]);
  });

  it.each([
    // 反例そのもの: 紐づけの解除と行の削除だけで発火し、名前の更新で発火しない(写しの古い名前の持ち主が消える)。
    ['写される個人列の更新で発火しない', remember({ fires: 'before update of person_id or delete' }), /update of name で発火しません/],
    ['持ち主の列の更新で発火しない', remember({ fires: 'before update of name or delete' }), /update of person_id で発火しません/],
    ['行の削除で発火しない', remember({ fires: 'before update of person_id, name' }), /delete で発火しません/],
    ['発火の宣言が無い', remember({ fires: undefined as unknown as string }), /delete \/ update of person_id \/ update of name で発火しません/],
    ['持ち主の列が参照の欄でない', remember({ remembersOwner: 'memo' }), /remembers_owner の memo は seat の参照\(ref\)の欄ではありません/],
  ])('負例: %s', (_title, trigger, expected) => {
    expect(verify([trigger]).join('\n')).toMatch(expected);
  });

  it.each([
    ['遷移が持ち主の列を書く', { transition: ['person_id'] }],
    ['編集の規則が持ち主の列を書く', { edit: ['person_id', 'name'] }],
  ])('負例: %s のに記録のトリガが無い', (_title, writes) => {
    expect(verify([], { writes }).join('\n')).toMatch(/持ち主の列 person_id は作った後に書けるのに、元の持ち主を記録するトリガ\(remembers_owner: person_id\)がありません/);
  });

  // 点検 20 回目 C20-8: 持ち主の列が書けなくても、行が消せて個人列が写されるなら、削除の瞬間に写しの値の持ち主が消える。
  it.each([
    ['行が消せる(持ち主の列も個人列も書けない)', { deletable: true }],
    ['行が消せて写し元の個人列が書ける(名前を直してから消す)', { edit: ['name'], deletable: true }],
  ])('負例: %s のに記録のトリガが無い', (_title, writes) => {
    expect(verify([], { writes }).join('\n')).toMatch(/行は操作で消せて写しは一緒に消えない\(access の deletes・写しの外部キーが cascade でない\)のに、元の持ち主を記録するトリガ\(remembers_owner: person_id\)がありません/);
    expect(verify([], { writes, badgeLink: 'set_null' }).join('\n')).toMatch(/remembers_owner: person_id/);
  });

  it('記録のトリガを求めない: 行が消せても、写しが写し元の id を cascade の外部キーで持つ(写しも一緒に消える)', () => {
    expect(verify([], { writes: { deletable: true }, badgeLink: 'cascade' })).toEqual([]);
    // 持ち主の列が書けるなら、cascade でも求める(付け替えでは写しは消えない)。
    expect(verify([], { writes: { transition: ['person_id'], deletable: true }, badgeLink: 'cascade' }).join('\n')).toMatch(/持ち主の列 person_id は作った後に書けるのに/);
  });

  it('正例: 行が消せても、削除と持ち主の列と写される個人列の更新で発火する記録のトリガがあれば鳴らない', () => {
    expect(verify([remember({})], { writes: { deletable: true } })).toEqual([]);
  });

  it.each([
    ['持ち主の列が作った後に書けない', [], { writes: { edit: ['name'] } }],
    ['個人列が写されない', [], { copies: false }],
    ['本人でない集約を指す参照(room_id)だけが書ける', [], { writes: { transition: ['room_id'] } }],
    ['消去の効果を持たない製品', [], { jobs: undefined }],
    ['行が消せても個人列が写されない', [], { writes: { deletable: true }, copies: false }],
  ] as const)('記録のトリガを求めない: %s', (_title, triggers, options) => {
    expect(verify(triggers, options)).toEqual([]);
  });

  it('写されない表でも、宣言した記録のトリガは削除と持ち主の列の更新で発火する', () => {
    expect(verify([remember({ fires: 'before update of person_id' })], { copies: false }).join('\n')).toMatch(/delete で発火しません/);
    expect(verify([remember({ fires: 'before update of person_id or delete' })], { copies: false })).toEqual([]);
  });

  // 点検 21 回目 A21-5: 発火を条件で絞った記録のトリガは、条件が外した瞬間に記録しない。
  it.each([
    ['削除の瞬間を紐づけの状態で絞る', "after delete or update of person_id, name when (old.memo = 'linked')"],
    ['更新だけを絞る', 'before update of person_id, name or delete when (new.person_id is distinct from old.person_id)'],
  ])('負例: 記録のトリガが when で発火を絞る(%s)', (_title, fires) => {
    expect(verify([remember({ fires })]).join('\n')).toMatch(/発火を when \(.+\) で絞っています/);
  });

  // 点検 21 回目 C21-6: 親の集約の削除の cascade でだけ消える行も、削除の瞬間に写しの値の持ち主が消える。
  it('負例: 自分の deletes は無いが、消せる部屋の削除の cascade で席が消えるのに記録のトリガが無い', () => {
    expect(verify([], { writes: { roomDeletable: true }, roomLink: 'cascade' }).join('\n')).toMatch(
      /行は操作で消せて写しは一緒に消えない.*remembers_owner: person_id/,
    );
  });

  it.each([
    ['部屋が消せない(cascade でも消える道が無い)', { writes: {}, roomLink: 'cascade' }],
    ['部屋は消せるが席の外部キーが set_null(席は残る)', { writes: { roomDeletable: true }, roomLink: 'set_null' }],
    ['部屋は消せるが席が部屋を外部キーで指さない', { writes: { roomDeletable: true } }],
    ['cascade で消えるが写しも席と一緒に消える', { writes: { roomDeletable: true }, roomLink: 'cascade', badgeLink: 'cascade' }],
  ] as const)('記録のトリガを求めない: %s', (_title, options) => {
    expect(verify([], options)).toEqual([]);
  });

  // 点検 21 回目 C の O21-1: 作った後に書き換わる列は 1 本の定義(model/written-after-create.ts)。遷移と編集の欄のほか、外部キーの set_null も数える。
  it('負例: 持ち主の列が親の削除の set_null で書き換わるのに記録のトリガが無い', () => {
    expect(verify([], { writes: {}, personLink: 'set_null' }).join('\n')).toMatch(/持ち主の列 person_id は作った後に書けるのに/);
  });

  // 点検 22 回目 A の O22-2: 遷移の RPC の後始末(also_writes の delete)でだけ消える行も、削除の瞬間に写しの値の持ち主が消える。
  it.each([
    ['also_writes の delete', { alsoWrites: ['seats'], alsoWriteKinds: { seats: ['delete'] } }, true],
    ['event_writes の delete(イベントごとの宣言)', { alsoWrites: [], eventWrites: { 'person.leave': { seats: ['delete'] } } }, true],
    ['also_writes の update だけ(行は残る)', { alsoWrites: ['seats'], alsoWriteKinds: { seats: ['update'] } }, false],
    ['ほかの表の delete', { alsoWrites: ['rooms'], alsoWriteKinds: { rooms: ['delete'] } }, false],
  ] as const)('RPC の副作用の削除: %s', (_title, writes, red) => {
    const fn = { name: 'apply_person_transition', kind: 'rpc', shape: 'transition', ...writes } as unknown as DataFunctionDecl;
    const found = verify([], { writes: {}, peopleFunctions: [fn] });
    if (red) expect(found.join('\n')).toMatch(/行は操作で消せて写しは一緒に消えない.*remembers_owner: person_id/);
    else expect(found).toEqual([]);
  });

  it('data_table が読めない構成では何も見ない', () => {
    expect(verifyCopyOwnerMemory(domain(), { available: false, tables: [] } as unknown as Parameters<typeof verifyCopyOwnerMemory>[1], JOBS)).toEqual([]);
  });
});
