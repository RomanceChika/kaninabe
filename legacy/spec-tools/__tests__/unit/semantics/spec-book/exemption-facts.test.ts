/**
 * 表紙の「理由をつけて外している守り」の事実(`semantics/spec-book/exemption-facts.ts`)と節(`render/book/index-exemptions.ts`)のテスト。
 *
 * 宣言の種類ごとに拾うこと・並びが種類の表の順であること・受け入れた危険にだけ ⚠ が付くこと・雛形の行を 1 行にまとめること・
 * 1 件も無ければ 1 行で言うこと。仕様は検査に要る欄だけを手で組む。
 */

import { describe, expect, it } from 'vitest';
import { exemptionFacts } from '../../../../lib/semantics/spec-book/exemption-facts.js';
import type { AuthFlowSpec } from '../../../../lib/model/auth/types.js';
import type { ConfigCatalogSpec } from '../../../../lib/model/config/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';

const at = (pointer: string) => ({ file: 'x', pointer });

const model = {
  roles: { roles: [{ id: 'guest', label: '未ログイン' }, { id: 'owner', label: '持ち主' }, { id: 'admin', label: '管理者' }] },
  aggregates: new Map([
    [
      'thing',
      {
        name: 'thing',
        entity: { entity: 'thing', label: 'もの', fields: [{ name: 'code', bearer: { kind: 'reusable', reason: '配り直さない', location: at('fields.code') } }] },
        stateMachines: [{ events: [{ id: 'resume', label: '戻す', selfAssign: [{ entity: 'thing', field: 'state', by: ['owner'], reason: '本人の申し出', location: at('events.resume.self_assign.0') }], location: at('events.resume') }] }],
        access: {
          writes: [{ by: 'guest', fields: ['note'], public: '問い合わせの窓口', location: at('writes.0') }],
          deletes: [],
          creates: [],
          accepts: [{ by: 'owner', field: 'tenant', reason: '文脈の役は境界の中にしか立たない' }],
          location: at('access'),
        },
      },
    ],
  ]),
} as unknown as SpecModel;

const flow = {
  mfa: { kind: 'exempt', reason: '敷居を上げない', location: at('mfa') },
  sessions: { concurrent: { kind: 'unbounded', reason: '複数の端末で使う' } },
  localOnly: [{ method: 'email', reason: 'テストの利用者' }],
  location: at('auth'),
} as unknown as AuthFlowSpec;

const catalog = {
  variables: [
    { id: 'A', notInTemplateReason: '自分で立つ', location: at('a') },
    { id: 'B', location: at('b') },
    { id: 'C', notInTemplateReason: '外で渡す', location: at('c') },
  ],
} as unknown as ConfigCatalogSpec;

describe('exemptionFacts', () => {
  const facts = exemptionFacts(model, flow, catalog);

  it('宣言の種類ごとに拾い、種類の表の順に並べる', () => {
    expect(facts.map((fact) => fact.kind)).toEqual(['mfa-exempt', 'bearer-reusable', 'public-write', 'self-assign', 'tenant-accept', 'sessions-unbounded', 'local-only', 'env-template', 'env-template']);
  });

  it('verify が毎回名指すもの(多要素認証を外す・使い回し)だけが受け入れた危険になる', () => {
    expect(facts.filter((fact) => fact.accepted).map((fact) => fact.kind)).toEqual(['mfa-exempt', 'bearer-reusable']);
  });

  it('一部のロールにだけ求める多要素認証は、受け入れた危険でない緩めとして拾う', () => {
    const roles = { ...flow, mfa: { kind: 'require', scope: { kind: 'roles', roles: ['admin'] }, summary: '管理者だけ', location: at('mfa') } } as unknown as AuthFlowSpec;
    expect(exemptionFacts(model, roles, null)[0]).toMatchObject({ kind: 'mfa-roles', accepted: false, subjects: ['admin'] });
  });

  it('IdP に任せる多要素認証は、受け入れた危険として拾う', () => {
    const delegated = { ...flow, mfa: { kind: 'delegated', provider: 'idp', evidence: 'none', reason: '任せる', location: at('mfa') } } as unknown as AuthFlowSpec;
    expect(exemptionFacts(model, delegated, null)[0]).toMatchObject({ kind: 'mfa-delegated', accepted: true, subjects: ['idp'] });
  });

  it('認証と設定が読めなければドメインの宣言だけ', () => {
    expect(exemptionFacts(model, null, null).every((fact) => fact.source === 'domain')).toBe(true);
  });
});
