/**
 * world の行で**空のままにする欄**を宣言から読む写像の単体テスト(束 ㉒)。
 *
 * 対象: `lib/world/rls-world-empty.ts`。
 * world の行は状態の列に値を置かない(DB の既定値 = 初期状態が入る)ので、`check` の不変条件を
 * 初期状態のもとで読み、「満たすほかない項」に現れる `is null` を空の要求として拾う。
 *
 * **読めない形では何も返さない**ことをここで固定する —— 空にするのは宣言から読めたときだけで
 * あり、勘で空にすると「束縛の列が空の world」が黙って生まれる。
 */

import { describe, expect, it } from 'vitest';
import { emptyFieldsOf, fieldPresenceOf, initialStatesOf } from '../../../lib/world/rls-world-empty.js';
import type { InvariantFormal, SpecModel } from '../../../lib/model/types.js';
import {
  aggregate,
  entitySpec,
  field,
  invariant,
  invariantSpec,
  machine,
  specModel,
} from '../../helpers/model-builder-v8plus.js';

/** 保管の 2 欄と状態を持つ doc 集約(初期状態は draft)。 */
function model(...formals: readonly InvariantFormal[]): SpecModel {
  return specModel({
    aggregates: [
      aggregate({
        name: 'doc',
        entity: entitySpec('doc', [
          field('archived_at', { kind: 'datetime' }),
          field('archived_by', { kind: 'ref', entity: 'staff' }),
          field('state', { kind: 'state', machine: 'doc' }),
        ]),
        stateMachines: [machine({ machine: 'doc', states: ['draft', 'archived'] })],
        invariants: invariantSpec(
          formals.map((formal, index) => invariant({ id: `INV-DOC-00${index + 1}`, formal })),
        ),
      }),
    ],
  });
}

/** `check` の形式定義のショートハンド。 */
function check(expr: string): InvariantFormal {
  return { kind: 'check', expr };
}

describe('初期状態の表', () => {
  it('状態の欄 → 初期状態を引ける', () => {
    expect([...initialStatesOf(model(), 'doc')]).toEqual([['state', 'draft']]);
  });
});

describe('空のままにする欄', () => {
  it('初期状態では満たせない項が 1 つだけ残るとき、その項の is null を要求として読む', () => {
    const empty = emptyFieldsOf(model(check('doc.state == archived or doc.archived_at is null')), 'doc');
    expect([...empty]).toEqual(['archived_at']);
  });

  it('初期状態で真になる項があれば何も要求しない(既に満たされている)', () => {
    const empty = emptyFieldsOf(model(check('doc.state != archived or doc.archived_at is null')), 'doc');
    expect([...empty]).toEqual([]);
  });

  it('連言の中の is null も読む(同値を 1 本の式で書いた形)', () => {
    const expr =
      'doc.state == archived and doc.archived_at is not null and doc.archived_by is not null' +
      ' or doc.state != archived and doc.archived_at is null and doc.archived_by is null';
    expect([...emptyFieldsOf(model(check(expr)), 'doc')].sort()).toEqual(['archived_at', 'archived_by']);
  });

  it('is not null は要求として扱わない(値を置くのが既定だから既定のまま満たされる)', () => {
    expect([...emptyFieldsOf(model(check('doc.archived_at is not null')), 'doc')]).toEqual([]);
  });

  it('偽でない項が 2 つ以上あれば何も要求しない(宣言から決まらない)', () => {
    const expr = 'doc.archived_by is null or doc.archived_at is null';
    expect([...emptyFieldsOf(model(check(expr)), 'doc')]).toEqual([]);
  });

  it('別の集約の欄は拾わない', () => {
    expect([...emptyFieldsOf(model(check('other.state == x or other.col is null')), 'doc')]).toEqual([]);
  });

  it('check 以外の形式定義は読まない', () => {
    const spec = model({ kind: 'uniqueness', keys: ['archived_at'], where: 'doc.archived_at is null' });
    expect([...emptyFieldsOf(spec, 'doc')]).toEqual([]);
  });
});

describe('別の状態のもとでの欄の埋め方(束 §14 の反例の行)', () => {
  const expr =
    'doc.state == archived and doc.archived_at is not null and doc.archived_by is not null' +
    ' or doc.state != archived and doc.archived_at is null and doc.archived_by is null';

  it('保管の状態では is not null の欄が「値が要る欄」になる', () => {
    const presence = fieldPresenceOf(model(check(expr)), 'doc', new Map([['state', 'archived']]));

    expect([...presence.filled].sort()).toEqual(['archived_at', 'archived_by']);
    expect([...presence.empty]).toEqual([]);
  });

  it('初期状態では同じ式が「空にする欄」を要求する(裏返しの側)', () => {
    const presence = fieldPresenceOf(model(check(expr)), 'doc', new Map([['state', 'draft']]));

    expect([...presence.empty].sort()).toEqual(['archived_at', 'archived_by']);
    expect([...presence.filled]).toEqual([]);
  });
});
