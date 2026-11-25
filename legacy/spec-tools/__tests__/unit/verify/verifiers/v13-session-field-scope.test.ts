/**
 * V13(セッション属性の集約スコープ)の規約網羅テスト。
 * 対象の要求(auth-spec-writing.md §session 属性):
 *   `session: true` は 1 集約(認証ユーザーに対応する集約)にしか付けられない。
 */

import { describe, expect, it } from 'vitest';
import { sessionFieldScopeVerifier } from '../../../../lib/verify/verifiers/v13-session-field-scope.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder-v8plus.js';

describe('V13 セッション属性の集約スコープ', () => {
  it('session: true が 0 件なら何も言わない', () => {
    const model = specModel({
      aggregates: [
        aggregate({ name: 'member', entity: entitySpec('member', [field('display_name', { kind: 'string' })]) }),
      ],
    });

    expect(sessionFieldScopeVerifier.verify(model, undefined as never)).toEqual([]);
  });

  it('session: true が 1 集約だけなら通す(personal との併存も可)', () => {
    const model = specModel({
      aggregates: [
        aggregate({
          name: 'member',
          entity: entitySpec('member', [
            field('display_name', { kind: 'string' }, { personal: true, session: true }),
            field('bio', { kind: 'text' }, { personal: true }),
          ]),
        }),
        aggregate({ name: 'workshop', entity: entitySpec('workshop', [field('title', { kind: 'string' })]) }),
      ],
    });

    expect(sessionFieldScopeVerifier.verify(model, undefined as never)).toEqual([]);
  });

  it('session: true が 2 集約にまたがると 2 集約目の各フィールドを指摘する', () => {
    const model = specModel({
      aggregates: [
        aggregate({
          name: 'member',
          entity: entitySpec('member', [field('display_name', { kind: 'string' }, { session: true })]),
        }),
        aggregate({
          name: 'workshop',
          entity: entitySpec('workshop', [field('title', { kind: 'string' }, { session: true })]),
        }),
      ],
    });

    const findings = sessionFieldScopeVerifier.verify(model, undefined as never);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      verifier: 'V13',
      severity: 'error',
      counterexample: { entity: 'workshop', field: 'title', first: 'member' },
    });
  });
});
