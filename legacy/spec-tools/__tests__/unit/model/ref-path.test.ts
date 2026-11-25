/**
 * 参照の道の探索(lib/model/ref-path.ts)のテスト。
 *
 * ここが固定するのは 1 つ —— **道と列は `context:` の宣言が決める**ことである。
 * 生の `ref(...)` 欄を宣言順に辿ると、同じ相手を指す参照が 2 本ある形で黙って先頭を選ぶ
 * ことになり、「verify は緑なのに別の行を指す」穴になる(path-hops.ts §経路が 2 通りあれば探さない)。
 *
 * 道の上限と曖昧さの扱いの正は `path-hops.ts`。ここは**呼び側から見た振る舞い**を実行する。
 */

import { describe, expect, it } from 'vitest';
import { refColumn, refPathTo } from '../../../lib/model/ref-path.js';
import { aggregate, entitySpec, field, specModel } from '../../helpers/model-builder.js';

/** `ref(...)` の欄 1 つ。 */
function ref(name: string, entity: string) {
  return field(name, { kind: 'ref', entity });
}

/**
 * 同じ相手(employee)を指す参照が 2 本ある集約(fixture expenses の claim と同じ形)。
 *
 * @param via `context:` が employee へ辿ると宣言する参照パス
 */
function twoRefsModel(via: string) {
  return specModel([
    aggregate('claim', {
      entity: entitySpec('claim', {
        context: { claim: 'claim.id', employee: via },
        fields: [field('id', { kind: 'uuid' }), ref('employee_id', 'employee'), ref('approver_id', 'employee')],
      }),
    }),
    aggregate('employee', {
      entity: entitySpec('employee', {
        context: { employee: 'employee.id' },
        fields: [field('id', { kind: 'uuid' })],
      }),
    }),
  ]);
}

describe('refColumn — 同じ相手への参照が 2 本ある形', () => {
  it('宣言順の先頭ではなく context: が名指しした列を選ぶ', () => {
    // 宣言順の先頭は employee_id だが、context: は approver_id を名指している。
    expect(refColumn(twoRefsModel('claim.approver_id'), 'claim', 'employee')).toBe('approver_id');
  });

  it('context: が先頭の列を名指していればその列(fixture expenses と同じ形)', () => {
    expect(refColumn(twoRefsModel('claim.employee_id'), 'claim', 'employee')).toBe('employee_id');
  });

  it('道の 1 段目も同じ列を通る(名指しされていない参照を根にしない)', () => {
    expect(refPathTo(twoRefsModel('claim.approver_id'), 'claim', 'employee')).toEqual(['employee']);
    expect(
      refPathTo(twoRefsModel('claim.approver_id'), 'claim', 'employee', (f) => f.name === 'employee_id'),
    ).toBeNull();
  });
});

describe('refColumn — context: に宣言が無い / 参照の欄でない', () => {
  const model = specModel([
    aggregate('claim', {
      entity: entitySpec('claim', {
        // employee への ref 欄は持つが、context: には宣言が無い。
        context: { claim: 'claim.id' },
        fields: [field('id', { kind: 'uuid' }), ref('employee_id', 'employee')],
      }),
    }),
    aggregate('employee', {
      entity: entitySpec('employee', { context: {}, fields: [field('id', { kind: 'uuid' })] }),
    }),
  ]);

  it('ref 欄があっても context: に無ければ道にならない', () => {
    expect(refColumn(model, 'claim', 'employee')).toBeNull();
    expect(refPathTo(model, 'claim', 'employee')).toBeNull();
  });

  it('自分自身を指す context:(id の欄)は参照の欄ではないので道にならない', () => {
    expect(refColumn(model, 'claim', 'claim')).toBeNull();
    expect(refPathTo(model, 'claim', 'claim')).toBeNull();
  });
});

/**
 * 中継を挟む題材。
 *
 * `shelf` は `section` 経由で `store` へ届く(2 段)。`shelf.store_id` は**持たない**。
 * `move` は `store` への直接の宣言と、`section` 経由の中継の両方を持つ。
 */
function relayModel() {
  return specModel([
    aggregate('shelf', {
      entity: entitySpec('shelf', {
        context: { shelf: 'shelf.id', section: 'shelf.section_id' },
        fields: [field('id', { kind: 'uuid' }), ref('section_id', 'section')],
      }),
    }),
    aggregate('section', {
      entity: entitySpec('section', {
        context: { section: 'section.id', store: 'section.store_id' },
        fields: [field('id', { kind: 'uuid' }), ref('store_id', 'store')],
      }),
    }),
    aggregate('store', {
      entity: entitySpec('store', { context: { store: 'store.id' }, fields: [field('id', { kind: 'uuid' })] }),
    }),
    aggregate('move', {
      entity: entitySpec('move', {
        context: { move: 'move.id', section: 'move.section_id', store: 'move.store_id' },
        fields: [field('id', { kind: 'uuid' }), ref('section_id', 'section'), ref('store_id', 'store')],
      }),
    }),
  ]);
}

describe('refPathTo — 中継', () => {
  it('直接の宣言が無ければ中継を 1 つ挟んだ道を返す', () => {
    expect(refPathTo(relayModel(), 'shelf', 'store')).toEqual(['section', 'store']);
  });

  it('直接の宣言があればそれを返す(中継を探さない)', () => {
    expect(refPathTo(relayModel(), 'move', 'store')).toEqual(['store']);
  });

  it('直接の宣言の列が使えない文脈では中継に落ちる(作成の RPC で写しの列がまだ無い形)', () => {
    // 根に使えるのは section_id だけ(store_id はまだ値が引けない)。
    expect(refPathTo(relayModel(), 'move', 'store', (f) => f.name === 'section_id')).toEqual(['section', 'store']);
  });

  it('使える中継が 2 通りあれば選ばずに断る', () => {
    const model = specModel([
      aggregate('move', {
        entity: entitySpec('move', {
          context: { left: 'move.left_id', right: 'move.right_id' },
          fields: [field('id', { kind: 'uuid' }), ref('left_id', 'left'), ref('right_id', 'right')],
        }),
      }),
      aggregate('left', {
        entity: entitySpec('left', {
          context: { store: 'left.store_id' },
          fields: [field('id', { kind: 'uuid' }), ref('store_id', 'store')],
        }),
      }),
      aggregate('right', {
        entity: entitySpec('right', {
          context: { store: 'right.store_id' },
          fields: [field('id', { kind: 'uuid' }), ref('store_id', 'store')],
        }),
      }),
      aggregate('store', {
        entity: entitySpec('store', { context: {}, fields: [field('id', { kind: 'uuid' })] }),
      }),
    ]);
    expect(refPathTo(model, 'move', 'store')).toBeNull();
    // 片方の根だけが使える文脈なら、道は 1 本に決まる。
    expect(refPathTo(model, 'move', 'store', (f) => f.name === 'right_id')).toEqual(['right', 'store']);
  });

  it('3 段目は辿らない(段の上限は path-hops が持つ)', () => {
    const model = specModel([
      aggregate('a', {
        entity: entitySpec('a', { context: { b: 'a.b_id' }, fields: [ref('b_id', 'b')] }),
      }),
      aggregate('b', {
        entity: entitySpec('b', { context: { c: 'b.c_id' }, fields: [ref('c_id', 'c')] }),
      }),
      aggregate('c', {
        entity: entitySpec('c', { context: { d: 'c.d_id' }, fields: [ref('d_id', 'd')] }),
      }),
      aggregate('d', { entity: entitySpec('d', { context: {}, fields: [field('id', { kind: 'uuid' })] }) }),
    ]);
    expect(refPathTo(model, 'a', 'c')).toEqual(['b', 'c']);
    expect(refPathTo(model, 'a', 'd')).toBeNull();
  });
});
