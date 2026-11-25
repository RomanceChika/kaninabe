/**
 * 「子の行の集合」判定(`lib/trace/compute-child-set.ts`)の規約網羅テスト。
 *
 * 子の集合と**構造で言える**のは「子が対象を参照する・対象の側に子への道が無い・子の親への参照が一意でない」の
 * 3 つがそろうときだけである。1 つでも欠ければ false(= A19 は error のまま)。A19 を通した見え方は
 * `verifiers/a19-compute-facts.test.ts` が持ち、ここは判定の関数を直接叩く(自己参照のように計画を通すと
 * 読めてしまう形も、ここなら見張れる)。
 */

import { describe, expect, it } from 'vitest';
import type { InvariantFormal } from '../../../lib/model/types.js';
import { isChildSetRead } from '../../../lib/trace/compute-child-set.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import {
  aggregate,
  entitySpec,
  field,
  invariant,
  invariantSpec,
  role,
  specModel,
} from '../../helpers/model-builder-v8plus.js';

const ROLES = [role('anonymous'), role('member'), role('system')];

/** 親 `order` と、親を `ref` で指す子 `line`。 */
function twoLevel(init: { parentRefsChild?: boolean; parentContext?: Record<string, string> } = {}) {
  return specModel({
    roles: ROLES,
    aggregates: [
      aggregate({
        name: 'order',
        entity: entitySpec(
          'order',
          [field('total', { kind: 'integer' }), ...(init.parentRefsChild === true ? [field('top_line_id', { kind: 'ref', entity: 'line' })] : [])],
          init.parentContext ?? {},
        ),
      }),
      aggregate({
        name: 'line',
        entity: entitySpec('line', [
          field('order_id', { kind: 'ref', entity: 'order' }, { required: true }),
          field('amount', { kind: 'integer' }),
        ]),
      }),
    ],
  });
}

describe('isChildSetRead', () => {
  it('子が親を ref で指し、親の側に道も一意性も無ければ子の集合', () => {
    expect(isChildSetRead(twoLevel(), undefined, 'order', 'line')).toBe(true);
  });

  it('名前は集約ディレクトリ名でもエンティティ名でも引ける・引けなければ false', () => {
    expect(isChildSetRead(twoLevel(), undefined, 'order', 'missing')).toBe(false);
    expect(isChildSetRead(twoLevel(), undefined, 'missing', 'line')).toBe(false);
  });

  it('親を指さない集約は子ではない', () => {
    expect(isChildSetRead(twoLevel(), undefined, 'line', 'order')).toBe(false);
  });

  it('親が子を ref で指す(双方向)なら false(親の側に道がある)', () => {
    expect(isChildSetRead(twoLevel({ parentRefsChild: true }), undefined, 'order', 'line')).toBe(false);
  });

  it('親の context に子へのキーがあれば false', () => {
    expect(isChildSetRead(twoLevel({ parentContext: { line: 'order.top_line_id' } }), undefined, 'order', 'line')).toBe(false);
  });

  it('自己参照(木構造。親と子が同じ集約)は false(自分を指す子は親の側にも自分への道を持つ)', () => {
    const tree = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({
          name: 'node',
          entity: entitySpec('node', [
            field('parent_id', { kind: 'ref', entity: 'node' }),
            field('weight', { kind: 'integer' }),
          ]),
        }),
      ],
    });

    expect(isChildSetRead(tree, undefined, 'node', 'node')).toBe(false);
  });

  it('子の context だけが親を指す形(ref の欄が無い)も子', () => {
    const domain = specModel({
      roles: ROLES,
      aggregates: [
        aggregate({ name: 'order', entity: entitySpec('order', [field('total', { kind: 'integer' })]) }),
        aggregate({
          name: 'line',
          entity: entitySpec('line', [field('order_key', { kind: 'string' })], { order: 'line.order_key' }),
        }),
      ],
    });

    expect(isChildSetRead(domain, undefined, 'order', 'line')).toBe(true);
  });

  it('子の親への参照が uniqueness の不変条件で一意なら 1:1 = false。複合・限定つきは集合のまま', () => {
    const withInvariant = (formal: InvariantFormal) => {
      const base = twoLevel();
      const line = base.aggregates.get('line');
      if (line === undefined) throw new Error('fixture');
      const aggregates = new Map(base.aggregates);
      aggregates.set('line', { ...line, invariants: invariantSpec([invariant({ id: 'INV-LINE-001', formal })]) });
      return { ...base, aggregates };
    };

    expect(isChildSetRead(withInvariant({ kind: 'uniqueness', keys: ['order_id'] }), undefined, 'order', 'line')).toBe(false);
    expect(isChildSetRead(withInvariant({ kind: 'uniqueness', keys: ['order_id', 'amount'] }), undefined, 'order', 'line')).toBe(true);
    expect(
      isChildSetRead(withInvariant({ kind: 'uniqueness', keys: ['order_id'], where: 'line.amount > 0' }), undefined, 'order', 'line'),
    ).toBe(true);
    // 別の欄の一意は親への参照の一意ではない
    expect(isChildSetRead(withInvariant({ kind: 'uniqueness', keys: ['amount'] }), undefined, 'order', 'line')).toBe(true);
  });

  it('子の表に、その列だけの一意索引があれば 1:1 = false。部分索引・複合・一意でない索引は集合のまま', () => {
    const tables = (index: { on: string[]; unique: boolean; where?: string }) =>
      dataTableModel([dataTable('lines', { entity: 'line', indexes: [{ name: 'lines_ix', ...index }] })]);

    expect(isChildSetRead(twoLevel(), tables({ on: ['order_id'], unique: true }), 'order', 'line')).toBe(false);
    expect(isChildSetRead(twoLevel(), tables({ on: ['order_id'], unique: false }), 'order', 'line')).toBe(true);
    expect(isChildSetRead(twoLevel(), tables({ on: ['order_id', 'amount'], unique: true }), 'order', 'line')).toBe(true);
    expect(isChildSetRead(twoLevel(), tables({ on: ['order_id'], unique: true, where: 'amount > 0' }), 'order', 'line')).toBe(true);
  });
  it('子の主キーそのものが親を指す形(子の id = 親の id。ref の欄でも context でも)は 1:1 = false。主キー以外の欄は集合のまま', () => {
    const viaRef = (column: string) =>
      specModel({
        roles: ROLES,
        aggregates: [
          aggregate({ name: 'order', entity: entitySpec('order', [field('total', { kind: 'integer' })]) }),
          aggregate({ name: 'line', entity: entitySpec('line', [field(column, { kind: 'ref', entity: 'order' }, { required: true })]) }),
        ],
      });
    const viaContext = (column: string) =>
      specModel({
        roles: ROLES,
        aggregates: [
          aggregate({ name: 'order', entity: entitySpec('order', [field('total', { kind: 'integer' })]) }),
          aggregate({ name: 'line', entity: entitySpec('line', [field(column, { kind: 'uuid' })], { order: `line.${column}` }) }),
        ],
      });

    expect(isChildSetRead(viaRef('id'), undefined, 'order', 'line')).toBe(false);
    expect(isChildSetRead(viaRef('order_id'), undefined, 'order', 'line')).toBe(true);
    expect(isChildSetRead(viaContext('id'), undefined, 'order', 'line')).toBe(false);
    expect(isChildSetRead(viaContext('order_key'), undefined, 'order', 'line')).toBe(true);
  });
});
