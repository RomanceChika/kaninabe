/**
 * 執行点が world の行では当たらないかの判定(`rls-world-vacuous.ts`。点検 20 回目 B20-1 の残り 3)のユニットテスト。
 *
 * 固定するもの:
 *   - 数の上限の `where` を world の値で評価する(必須の列挙は先頭・必須の真偽は false・状態は初期状態)。偽なら当たらない、
 *     真・不明(任意の欄・既定値を宣言した欄・ほかの型・読めない式)なら当たりうる(従来どおり止める)
 *   - 状態依存は前提が偽でも当たらないとはみなさない(本文が宣言より強い実例がある)
 *   - 未ログインの作成の天井は、全体・鍵ごとの天井が 2 以上のときだけ world を妨げない(その表の天井のトリガに限る)
 */

import { describe, expect, it } from 'vitest';
import { ceilingRoomy, vacuousInWorld } from '../../../lib/world/rls-world-vacuous.js';
import type { AbuseDecl, InvariantFormal, SpecModel } from '../../../lib/model/types.js';
import { accessSpec, aggregate, create, entitySpec, field, machine, specModel } from '../../helpers/model-builder.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 枠(slot。種別は必須の列挙・任意の列挙・真偽・状態)と資料(item)。 */
const DOMAIN: SpecModel = specModel([
  aggregate('slot', {
    entity: entitySpec('slot', {
      fields: [
        field('kind', { kind: 'enum', values: ['main', 'guest'] }, { required: true }),
        field('tone', { kind: 'enum', values: ['soft', 'loud'] }),
        field('open', { kind: 'boolean' }, { required: true }),
        field('seats', { kind: 'integer' }, { required: true }),
        field('state', { kind: 'state', machine: 'slot' }),
      ],
    }),
    stateMachines: [machine('slot', { states: ['draft', 'fixed'], initial: 'draft', events: [] })],
  }),
]);

const cardinality = (where: string): InvariantFormal => ({ kind: 'cardinality', keys: ['slot_id'], max: 0, where });

describe('vacuousInWorld — 数の上限の where', () => {
  it.each([
    { where: 'slot.kind == guest', vacuous: true, why: '必須の列挙は先頭(main)を置く' },
    { where: 'slot.kind == main', vacuous: false, why: '前提が真' },
    { where: 'slot.kind != main', vacuous: true, why: '否定の比較' },
    { where: 'slot.kind in [guest]', vacuous: true, why: 'in' },
    { where: 'slot.state == fixed', vacuous: true, why: '状態は初期状態(draft)' },
    { where: 'slot.open == true', vacuous: true, why: '必須の真偽は false' },
    { where: 'slot.kind == guest or slot.open == true', vacuous: true, why: 'or の両辺が偽' },
    { where: 'slot.kind == guest and slot.seats == 3', vacuous: true, why: 'and の片辺が偽なら不明があっても偽' },
    { where: 'slot.kind == main and slot.seats == 3', vacuous: false, why: '真 and 不明 = 不明' },
    { where: 'slot.tone == loud', vacuous: false, why: '任意の欄は置かないことがある(不明)' },
    { where: 'slot.seats == 3', vacuous: false, why: '数値の値は連番で決まらない(不明)' },
    { where: 'slot.missing == x', vacuous: false, why: '欄が無い(不明)' },
    { where: 'not (', vacuous: false, why: '読めない式' },
  ])('$where → $vacuous($why)', ({ where, vacuous }) => {
    expect(vacuousInWorld(cardinality(where), DOMAIN, [])).toBe(vacuous);
  });

  it('data_table が既定値を宣言した欄は world が置かないので不明', () => {
    const tables = [dataTable('slots', { entity: 'slot', defaults: { kind: "'guest'::text" } })];
    expect(vacuousInWorld(cardinality('slot.kind == guest'), DOMAIN, tables)).toBe(false);
  });

  it.each([
    { label: 'where の無い数の上限', formal: { kind: 'cardinality', keys: ['slot_id'], max: 0 } as InvariantFormal },
    { label: '状態依存(前提が偽でも見ない)', formal: { kind: 'state_dependency', if: 'slot.state == fixed', then: 'slot.kind == main' } as InvariantFormal },
    { label: '行内比較', formal: { kind: 'check', expr: 'slot.kind == guest' } as InvariantFormal },
  ])('当たらないとはみなさない: $label', ({ formal }) => {
    expect(vacuousInWorld(formal, DOMAIN, [])).toBe(false);
  });
});

describe('ceilingRoomy — 未ログインの作成の天井', () => {
  const LOC = { file: 'access.md', pointer: 'creates.anonymous' };
  const TABLE = dataTable('notes', { entity: 'note', ddlMigration: '20261020000613_ddl_notes.sql' });
  const withAbuse = (abuse: Partial<AbuseDecl>): SpecModel =>
    specModel([
      aggregate('note', {
        entity: entitySpec('note', {
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('sender', { kind: 'string' }, { required: true }),
            field('created_at', { kind: 'datetime' }, { auto: true }),
          ],
        }),
        access: accessSpec('note', { creates: [{ ...create('anonymous'), abuse: { globalCeiling: { max: 30, per: '1 hour' }, location: LOC, ...abuse } }] }),
      }),
    ]);

  it.each([
    { label: '全体 30・鍵ごと 5', abuse: { perKey: { column: 'sender', max: 5, per: '1 hour' } }, roomy: true },
    { label: '全体だけ 2', abuse: { globalCeiling: { max: 2, per: '1 hour' } }, roomy: true },
    { label: '全体 1(world の行と作成が収まらない)', abuse: { globalCeiling: { max: 1, per: '1 hour' } }, roomy: false },
    { label: '鍵ごと 1', abuse: { perKey: { column: 'sender', max: 1, per: '1 hour' } }, roomy: false },
  ])('$label → $roomy', ({ abuse, roomy }) => {
    expect(ceilingRoomy(TABLE, 'check_note_rate_limit', withAbuse(abuse))).toBe(roomy);
  });

  it('その表の天井のトリガでなければ見ない(名前違い・天井の宣言なし)', () => {
    expect(ceilingRoomy(TABLE, 'check_note_other', withAbuse({}))).toBe(false);
    expect(ceilingRoomy(TABLE, 'check_note_rate_limit', specModel([aggregate('note', { entity: entitySpec('note', {}) })]))).toBe(false);
  });
});
