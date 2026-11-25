/**
 * T23(一意の不変条件 ⇔ 実際の一意の索引。点検 13 回目 A13-1)のテスト。
 *
 * 表: 不変条件の側の過不足 × 索引の中身(`on` / `unique` / `where` / 表)× 索引の側の過不足。反例の名前は探り台本の U2〜U2f。
 */

import { describe, expect, it } from 'vitest';
import { verifyUniqueIndexGrounding } from '../../../../lib/data/verifiers/t23-unique-index-grounding.js';
import type { DataIndexDecl } from '../../../../lib/model/data/types-shape.js';
import type { InvariantDef } from '../../../../lib/model/types.js';
import { accessSpec, aggregate, entitySpec, invariant, invariantSpec, specModel } from '../../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { loc } from '../../../helpers/model-builder.js';

const ID = 'INV-ITEM-001';
const NAME = 'items_shop_code_unique';
/** 執行点 1 本。 */
const enforce = (kind: InvariantDef['enforcedBy'][number]['kind'], ref: string): InvariantDef['enforcedBy'][number] => ({ kind, ref, location: loc() });
const ENFORCED: InvariantDef['enforcedBy'] = [enforce('db_constraint', NAME)];
const KEYS = ['shop_id', 'code'];

/** 正しい索引。 */
const INDEX: DataIndexDecl = { name: NAME, on: KEYS, unique: true, invariant: ID };

/** 不変条件 1 本と、表の索引(`table` は索引を置く表)で検査を実行する。 */
function run(init: { readonly formal?: InvariantDef['formal']; readonly enforcedBy?: InvariantDef['enforcedBy']; readonly indexes?: readonly DataIndexDecl[]; readonly table?: 'items' | 'others' } = {}) {
  const formal = 'formal' in init ? init.formal : { kind: 'uniqueness' as const, keys: KEYS };
  const domain = specModel({
    aggregates: [
      aggregate({ name: 'item', entity: entitySpec('item', []), access: accessSpec('item', {}), invariants: invariantSpec([invariant({ id: ID, entities: ['item'], ...(formal === undefined ? {} : { formal }), enforcedBy: init.enforcedBy ?? ENFORCED })]) }),
      aggregate({ name: 'other', entity: entitySpec('other', []) }),
    ],
  });
  const indexes = init.indexes ?? [INDEX];
  const tables = [dataTable('items', { entity: 'item', indexes: init.table === 'others' ? [] : indexes }), dataTable('others', { entity: 'other', indexes: init.table === 'others' ? indexes : [] })];
  return verifyUniqueIndexGrounding(domain, dataTableModel(tables));
}

describe('T23 一意の不変条件 ⇔ 索引', () => {
  it('緑: 対照(列の順は問わない)', () => {
    expect(run()).toEqual([]);
    expect(run({ indexes: [{ ...INDEX, on: ['code', 'shop_id'] }] })).toEqual([]);
  });

  it.each<{ name: string; index: DataIndexDecl; message: string }>([
    { name: 'U2 索引が鍵の列を落とす', index: { ...INDEX, on: ['code'] }, message: '同じ列の集合ではありません' },
    { name: 'U2d 索引が不変条件より広い', index: { ...INDEX, on: [...KEYS, 'name'] }, message: '同じ列の集合ではありません' },
    { name: 'U2e 不変条件に無い where', index: { ...INDEX, where: 'unit_price > 0' }, message: '比べられる形ではありません' },
    { name: 'U2e 読める形でも不変条件に無い where', index: { ...INDEX, where: "state = 'a'" }, message: '同じ条件ではありません' },
    { name: 'U2f unique を書き忘れる', index: { ...INDEX, unique: false }, message: 'unique: true がありません' },
    { name: '索引の invariant が他を指す', index: { ...INDEX, invariant: 'INV-ITEM-002' }, message: 'この索引を執行点と宣言した' },
  ])('赤: $name', ({ index, message }) => {
    expect(run({ indexes: [index] })).toEqual(expect.arrayContaining([expect.objectContaining({ verifier: 'T23', severity: 'error', message: expect.stringContaining(message) })]));
  });

  it('赤: 別の集約の表の索引', () => {
    expect(run({ table: 'others' })).toEqual([expect.objectContaining({ message: expect.stringContaining('の表ではありません') })]);
  });

  it.each<{ name: string; formal: InvariantDef['formal']; where?: string; ok: boolean }>([
    { name: '両方に同じ where', formal: { kind: 'uniqueness', keys: KEYS, where: 'state != archived' }, where: "(state <> 'archived'::text)", ok: true },
    { name: '不変条件だけに where', formal: { kind: 'uniqueness', keys: KEYS, where: 'state != archived' }, ok: false },
    { name: '式が逆', formal: { kind: 'uniqueness', keys: KEYS, where: 'state != archived' }, where: "state = 'archived'", ok: false },
    { name: '鍵の列の is not null は where が無いのと同じ', formal: { kind: 'uniqueness', keys: KEYS }, where: 'code is not null', ok: true },
    { name: '鍵の全部の is not null', formal: { kind: 'uniqueness', keys: KEYS }, where: 'code is not null and shop_id is not null', ok: true },
    { name: '鍵でない列の is not null', formal: { kind: 'uniqueness', keys: KEYS }, where: 'name is not null', ok: false },
    { name: '別の集約の条件', formal: { kind: 'uniqueness', keys: KEYS, where: 'parent.state == a' }, where: "state = 'a'", ok: false },
  ])('where: $name', ({ formal, where, ok }) => {
    const found = run({ formal, indexes: [{ ...INDEX, ...(where === undefined ? {} : { where }) }] });
    if (ok) expect(found).toEqual([]);
    else expect(found).toEqual([expect.objectContaining({ verifier: 'T23', counterexample: expect.objectContaining({ index: NAME }) })]);
  });

  it.each<{ name: string; enforcedBy: readonly InvariantDef['enforcedBy'][number][]; message: string }>([
    { name: '執行点が無い', enforcedBy: [enforce('guard', 'item.create')], message: 'db_constraint の執行点がありません' },
    { name: '名指した索引が無い', enforcedBy: [enforce('db_constraint', 'typo_unique')], message: 'typo_unique' },
    { name: '名指しの 1 本が無い', enforcedBy: [...ENFORCED, enforce('db_constraint', 'typo_unique')], message: 'typo_unique' },
  ])('赤: 不変条件の側 — $name', ({ enforcedBy, message }) => {
    expect(run({ enforcedBy })).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining(message) })]));
  });

  it.each<{ name: string; init: Parameters<typeof run>[0]; message: string }>([
    { name: '索引の invariant が実在しない', init: { formal: undefined, indexes: [{ ...INDEX, invariant: 'INV-NONE' }] }, message: 'は実在しません' },
    { name: 'keys を持たない不変条件を指す', init: { formal: { kind: 'check', expr: 'a == b' } }, message: 'uniqueness ではありません' },
    { name: 'formal の無い不変条件を指す', init: { formal: undefined }, message: 'uniqueness ではありません' },
  ])('赤: 索引の側 — $name', ({ init, message }) => {
    expect(run(init)).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining(message) })]));
  });

  it('赤: uniqueness の enforced_by が別の索引だけを名指すとき、invariant を書いた索引も止まる', () => {
    const second: DataIndexDecl = { name: 'items_other_unique', on: KEYS, unique: true, invariant: ID };
    expect(run({ indexes: [INDEX, second] })).toEqual([expect.objectContaining({ message: expect.stringContaining('items_other_unique の由来') })]);
  });

  it('緑: invariant を持たない索引は見ない(テナントの範囲は V26)・cardinality は索引を要らない', () => {
    expect(run({ indexes: [INDEX, { name: 'bare_unique', on: ['code'], unique: true }] })).toEqual([]);
    expect(run({ formal: { kind: 'cardinality', keys: KEYS, max: 3 }, enforcedBy: [enforce('trigger', 'check_quota')], indexes: [] })).toEqual([]);
  });
});
