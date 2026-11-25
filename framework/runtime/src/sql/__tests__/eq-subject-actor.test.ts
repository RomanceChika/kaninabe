/**
 * 実行する相手の組み立て(`@kaninabe/runtime/sql/eq-subject`)が、**判断材料が実行者自身の行を名指しする集約**を
 * 実行者の行で引くこと(ADR-0018)の単体テスト。
 *
 * 系統の的は集約ごとに 1 行だが、同じ集約の行が系統に何本もあることがある(実行者自身の行と、束縛の列のために
 * 分けた別人の行)。集約の名前だけで引くと別人の行を実行者の行として読み、置き直しも別人の行に当たる。
 * 集約名・行の名前は仮の語である。
 */

import { describe, expect, it } from 'vitest';
import { eqSubjectValues } from '@kaninabe/runtime/sql/eq-subject';

const ROWS: Readonly<Record<string, { readonly id: string; readonly values: Readonly<Record<string, unknown>> }>> = {
  'actor:person': { id: 'id-actor', values: { state: 'active' } },
  'other:person': { id: 'id-other', values: { state: 'active' } },
  'target:doc': { id: 'id-doc', values: {} },
};

const BASE = {
  targets: { doc: 'target:doc', person: 'other:person' },
  rowOf: (key: string) => ROWS[key],
  actorRow: 'actor:person',
  placements: [{ into: 'row', entity: 'person', column: 'state', value: 'guest' }],
  state: null,
} as const;

describe('eqSubjectValues — 実行者の行で引く集約', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-ROLECLAIM-006
  it('名指しした集約は、的ではなく実行者の行を指す(置き直しも実行者の行に当たり、実行者の行の値に載る)', () => {
    const subject = eqSubjectValues({ ...BASE, actorEntities: ['person'] });
    expect(subject.ids.get('person')).toBe('id-actor');
    expect(subject.values.get('person')).toEqual({ state: 'guest' });
    expect(subject.actorRow).toEqual({ state: 'guest' });
    // 名指ししない集約は的のまま。
    expect(subject.ids.get('doc')).toBe('id-doc');
  });

  it('名指ししなければ従来どおり的の行を指す(別人の行に置き直しが当たり、実行者の行は元の値のまま)', () => {
    const subject = eqSubjectValues(BASE);
    expect(subject.ids.get('person')).toBe('id-other');
    expect(subject.values.get('person')).toEqual({ state: 'guest' });
    expect(subject.actorRow).toEqual({ state: 'active' });
  });

  it('実行者の行が無い人では名指しがあっても的のまま(他人の系統を借りる形)', () => {
    const subject = eqSubjectValues({ ...BASE, actorRow: null, actorEntities: ['person'] });
    expect(subject.ids.get('person')).toBe('id-other');
    expect(subject.actorRow).toEqual({});
  });
});
