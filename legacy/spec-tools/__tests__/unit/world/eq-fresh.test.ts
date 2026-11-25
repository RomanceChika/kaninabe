/**
 * 作成の入力の一意の鍵を world の行と当たらない値に置き直す(`eq-fresh.ts`)のユニットテスト(点検 20 回目 B20-1 の残り 2)。
 *
 * 雛形(world に既にある行)の値を写したままだと、許可された作成が全部その一意の索引に当たり、送り直しの性質が 1 度も
 * 実行されない。ここで固定するのは、置き直す欄の選び方(参照でない鍵を 1 つ・入力の欄だけ)と、値の決め方(world が使っていない
 * 値・宣言の範囲と長さの中)と、置き直さない場合(参照だけの鍵・pattern・範囲の使い切り・一意の宣言なし)の表である。
 */

import { describe, expect, it } from 'vitest';
import { freshInputsOf } from '../../../lib/world/eq-fresh.js';
import { aggregate, entitySpec, field, specModel } from '../../helpers/model-builder.js';
import type { AggregateSpecs, FieldDef, SpecModel } from '../../../lib/model/types.js';
import type { EqWorld } from '../../../lib/world/eq-world-types.js';

/** 部(part)1 集約。鍵の組 (event_id, order_index) が一意。 */
function domain(fields: readonly FieldDef[], keys: readonly (readonly string[])[], checks: readonly string[] = []): SpecModel {
  const invariants = {
    invariants: [
      ...keys.map((key, index) => ({ id: `INV-PART-00${String(index + 1)}`, entities: ['part'], formal: { kind: 'uniqueness', keys: key } })),
      ...checks.map((expr, index) => ({ id: `INV-PART-10${String(index + 1)}`, entities: ['part', 'event'], formal: { kind: 'check', expr } })),
    ],
  } as unknown as AggregateSpecs['invariants'];
  return specModel([aggregate('part', { entity: entitySpec('part', { fields: [...fields] }), invariants })]);
}

const PARENT = field('event_id', { kind: 'ref', entity: 'event' }, { required: true });
const ORDER = { ...field('order_index', { kind: 'integer' }, { required: true }), min: 1, max: 3 };
const LABEL = { ...field('label', { kind: 'string' }), maxLength: 20 };

/** world の行(集約 part の行と、別の集約の行)。 */
function world(values: readonly Readonly<Record<string, string | number>>[]): Pick<EqWorld, 'rows'> {
  return {
    rows: [
      ...values.map((row, index) => ({ key: `b${String(index)}:part`, table: 'parts', entity: 'part', values: row, refs: {}, actor: null, ancestry: {} })),
      { key: 'other', table: 'others', entity: 'other', values: { order_index: 2 }, refs: {}, actor: null, ancestry: {} },
      { key: 'c1', table: 'events', entity: 'event', values: { starts_at: '2031-10-04T00:00:00.000Z', capacity: 7 }, refs: {}, actor: null, ancestry: {} },
      { key: 'c2', table: 'events', entity: 'event', values: { starts_at: '2044-05-16T00:00:00.000Z', capacity: 3 }, refs: {}, actor: null, ancestry: {} },
    ],
  };
}

const STARTS = field('starts_at', { kind: 'datetime' });
const DAY = field('day', { kind: 'date' });
const SEATS = field('seats', { kind: 'integer' });

const INPUT_KEYS = ['event_id', 'order_index', 'label', 'starts_at', 'day', 'seats'];

describe('freshInputsOf', () => {
  it.each([
    {
      label: '参照でない鍵(数値)に、world の同じ集約が使っていない最小の値を置く(別の集約の行は数えない)',
      fields: [PARENT, ORDER, LABEL],
      keys: [['event_id', 'order_index']],
      rows: [{ order_index: 1 }, { order_index: 3 }],
      expected: { order_index: 2 },
    },
    {
      label: '文字列の鍵は {欄}-fresh(使われていれば番号を足す)',
      fields: [PARENT, LABEL],
      keys: [['event_id', 'label']],
      rows: [{ label: 'label-fresh' }],
      expected: { label: 'label-fresh-1' },
    },
    {
      label: '一意の宣言ごとに 1 欄(同じ欄を二度は置かない)',
      fields: [PARENT, ORDER, LABEL],
      keys: [['event_id', 'order_index'], ['label']],
      rows: [{ order_index: 1, label: 'x' }],
      expected: { order_index: 2, label: 'label-fresh' },
    },
    { label: '鍵が参照だけなら置き直さない', fields: [PARENT, ORDER], keys: [['event_id']], rows: [{ order_index: 1 }], expected: {} },
    { label: '宣言の範囲を world が使い切っていれば置き直さない', fields: [PARENT, ORDER], keys: [['event_id', 'order_index']], rows: [{ order_index: 1 }, { order_index: 2 }, { order_index: 3 }], expected: {} },
    { label: 'pattern を持つ欄は置き直さない', fields: [PARENT, { ...LABEL, pattern: '^[a-z]+$' }], keys: [['event_id', 'label']], rows: [], expected: {} },
    { label: '長さの上限に収まらなければ置き直さない', fields: [PARENT, { ...LABEL, maxLength: 5 }], keys: [['event_id', 'label']], rows: [], expected: {} },
    { label: '一意の宣言が無ければ置き直さない', fields: [PARENT, ORDER], keys: [], rows: [{ order_index: 1 }], expected: {} },
  ])('$label', ({ fields, keys, rows, expected }) => {
    expect(freshInputsOf(world(rows), { domain: domain(fields, keys), entity: 'part', inputKeys: INPUT_KEYS })).toEqual(expected);
  });

  it('入力の欄に無い鍵は置き直さない(作成が渡さない欄は DB が決める)', () => {
    const result = freshInputsOf(world([{ order_index: 1 }]), {
      domain: domain([PARENT, ORDER, LABEL], [['event_id', 'order_index', 'label']]),
      entity: 'part',
      inputKeys: ['event_id', 'label'],
    });
    expect(result).toEqual({ label: 'label-fresh' });
  });

  it.each([
    { label: '自集約の欄 >= 別の集約の欄: world の相手の最大から 1 日後', check: 'part.starts_at >= event.starts_at', expected: { starts_at: '2044-05-17T00:00:00.000Z' } },
    { label: '向きが逆の書き方(相手 <= 自集約)も同じ', check: 'event.starts_at <= part.starts_at', expected: { starts_at: '2044-05-17T00:00:00.000Z' } },
    { label: '自集約の欄 < 別の集約の欄: 相手の最小から 1 日前(日付の欄は日付で)', check: 'part.day < event.starts_at', expected: { day: '2031-10-03' } },
    { label: '数値は 1 ずらす', check: 'part.seats <= event.capacity', expected: { seats: 2 } },
    { label: '等値(写し)は置き直さない', check: 'part.starts_at == event.starts_at', expected: {} },
    { label: '同じ集約の欄どうしの順序は置き直さない(world の値の写像が持つ)', check: 'part.starts_at >= part.day', expected: {} },
    { label: '相手の欄に world の値が無ければ置き直さない', check: 'part.starts_at >= event.ends_at', expected: {} },
  ])('別の集約との順序: $label', ({ check, expected }) => {
    expect(freshInputsOf(world([]), { domain: domain([PARENT, STARTS, DAY, SEATS], [], [check]), entity: 'part', inputKeys: INPUT_KEYS })).toEqual(expected);
  });
});
