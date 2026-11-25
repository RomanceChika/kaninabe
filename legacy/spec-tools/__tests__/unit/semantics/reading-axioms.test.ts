/**
 * 必読に数える公理(不変条件のほかの 3 種類)の導出のテスト。
 *
 * アクセスの宣言(表の行)・状態の意味・要約の文。計算される欄は数えない(導出)。
 * 数える単位は 1 か所で、章も手引きも同じ関数から数える。
 */

import { describe, expect, it } from 'vitest';
import {
  accessRules,
  accessTable,
  accessUnits,
  axiomPartsTotal,
  computeItems,
  stateMeanings,
  summarySentences,
  summaryTableOf,
} from '../../../lib/semantics/reading-axioms.js';
import {
  accessSpec,
  aggregate,
  create,
  del,
  entitySpec,
  event,
  machine,
  read,
  specModel,
  write,
} from '../../helpers/model-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';

describe('accessRules(アクセスの宣言)', () => {
  const access = accessSpec('thing', {
    reads: [read('member', 'all'), read('owner', 'own', { tenant_id: 'tenant_id' }, 'state == open'), read('system', 'all')],
    creates: [create('member')],
    writes: [write('owner', ['title'], 'state == draft'), write('system', ['score'])],
    deletes: [del('owner', 'state == draft')],
  });

  it('読む → 作る → 書く → 消すの順に、宣言 1 本 = 1 件。内部実行の読み取りだけを除く', () => {
    const rules = accessRules(access, 'system');

    expect(rules.map((rule) => `${rule.kind}:${rule.by}`)).toEqual([
      'read:member',
      'read:owner',
      'create:member',
      'write:owner',
      'write:system',
      'delete:owner',
    ]);
  });

  it('範囲・書ける欄・条件の式・実行者の属性で絞る条件を、宣言のとおり持つ', () => {
    const [, owner, , write1] = accessRules(access, 'system');

    expect(owner).toMatchObject({ scope: { kind: 'own' }, when: 'state == open', filters: [{ field: 'tenant_id', actorField: 'tenant_id' }] });
    expect(write1).toMatchObject({ fields: ['title'], when: 'state == draft', filters: [] });
  });

  it('内部実行のロールが分からないとき(undefined)は、読み取りを除かない。アクセス仕様が無ければ 0 件', () => {
    expect(accessRules(access, undefined)).toHaveLength(7);
    expect(accessRules(undefined, 'system')).toEqual([]);
  });
});

describe('accessTable / accessUnits(必読に数える単位は表の行)', () => {
  const access = accessSpec('thing', {
    reads: [read('organizer', 'all'), read('staff', 'all'), read('member', 'none'), read('system', 'all')],
    creates: [create('organizer'), create('staff')],
    writes: [
      write('organizer', ['title'], 'state == draft'),
      write('staff', ['title'], 'state == draft'),
      write('organizer', ['title'], 'state == open'),
      write('staff', ['note'], 'state == draft'),
    ],
    deletes: [del('organizer', 'state == draft'), del('staff', 'state == draft')],
  });

  it('作る・書く・消すは、種類と書ける欄と条件が同じ宣言の役を 1 行にまとめる(宣言の並びの順)', () => {
    const table = accessTable(access, 'system');

    expect(table.rows.map((row) => `${row.kind}:${row.roles.join('+')}:${(row.fields ?? []).join(',')}:${row.when ?? ''}`)).toEqual([
      'create:organizer+staff::',
      'write:organizer+staff:title:state == draft',
      'write:organizer:title:state == open',
      'write:staff:note:state == draft',
      'delete:organizer+staff::state == draft',
    ]);
  });

  it('読むは内部実行を除いて残し、数える行は「読むの表の 1 行 + 作る・書く・消すの行」。宣言が無ければ 0', () => {
    const table = accessTable(access, 'system');

    expect(table.reads.map((rule) => rule.by)).toEqual(['organizer', 'staff', 'member']);
    // 宣言は 3 + 2 + 4 + 2 = 11 本だが、数えるのは 1 + 5 = 6 行。
    expect(accessUnits(table)).toBe(6);
    expect(accessUnits(accessTable(undefined, 'system'))).toBe(0);
    expect(accessUnits(accessTable(accessSpec('bare', { reads: [read('system', 'all')] }), 'system'))).toBe(0);
  });
});

describe('stateMeanings / summarySentences(状態の意味と要約の文)', () => {
  const states = machine('flow', {
    states: ['a', 'b', 'c'],
    initial: 'a',
    events: [event('go', { from: ['a'], to: 'b', by: ['member'] })],
    summary: '節の要約です。',
    stateSummaries: { a: 'a の場面です。', c: 'c の場面です。' },
  });

  it('summary を持つ状態だけを、状態の宣言順に返す', () => {
    expect(stateMeanings([states])).toEqual([
      { machine: 'flow', state: 'a', summary: 'a の場面です。' },
      { machine: 'flow', state: 'c', summary: 'c の場面です。' },
    ]);
    expect(stateMeanings([machine('empty', { states: ['x'], initial: 'x' })])).toEqual([]);
  });

  it('要約の文は、章頭の 1 文 → 節の順に、書かれているものだけ返す', () => {
    const specs = aggregate('thing', {
      entity: { ...entitySpec('thing'), summary: '章頭です。' },
      stateMachines: [states, machine('plain', { states: ['x'], initial: 'x' })],
    });

    expect(summarySentences(specs)).toEqual([
      { kind: 'entity', key: 'thing', text: '章頭です。' },
      { kind: 'machine', key: 'flow', text: '節の要約です。' },
    ]);
    expect(summarySentences(aggregate('bare'))).toEqual([]);
  });

  it('要約の文の写しは、エンティティ / 状態機械 / 状態ごとに、書かれたものだけを持つ', () => {
    const model = specModel([
      aggregate('thing', { entity: { ...entitySpec('thing'), summary: '章頭です。' }, stateMachines: [states] }),
      aggregate('other', { entity: entitySpec('other') }),
    ]);

    expect(summaryTableOf(model, [])).toEqual({
      entity: { thing: '章頭です。' },
      machine: { flow: '節の要約です。' },
      state: { 'flow.a': 'a の場面です。', 'flow.c': 'c の場面です。' },
      example: {},
    });
  });
});

describe('computeItems(計算される欄)', () => {
  it('操作の computes の宣言を 1 本ずつ、操作と仕様ファイルつきで返す', () => {
    const items = computeItems([
      actionSpec({ handles: 'order.confirm', computes: { 'order.total': 'calculateTotal', 'order.tax': 'calculateTax' } }),
      actionSpec({ handles: 'order.cancel' }),
    ]);

    expect(items).toEqual([
      { target: 'order.total', ref: 'calculateTotal', operation: 'order.confirm', file: 'docs/specs/backend/actions/order/confirm.md' },
      { target: 'order.tax', ref: 'calculateTax', operation: 'order.confirm', file: 'docs/specs/backend/actions/order/confirm.md' },
    ]);
  });
});

describe('axiomPartsTotal', () => {
  it('不変条件を除く 3 種類の合計(計算される欄は数えない)', () => {
    expect(axiomPartsTotal({ access: 5, states: 3, summaries: 2, examples: 4 })).toBe(14);
  });
});
