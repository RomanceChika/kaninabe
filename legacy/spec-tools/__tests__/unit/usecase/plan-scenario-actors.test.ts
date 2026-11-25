/**
 * 生成テストの**誰として実行するか**(`lib/usecase/plan-scenario-actors.ts`。束 ⑰-3 / ⑰-3b)。
 *
 * ここで固定するのは `sessionProfileOf` —— セッションが運ぶ欄の既定の一式である。場面が
 * `true` にするのはロールの根拠になる欄だけだが、セッションの型はその 1 つでは満たされない
 * ので残りを埋める必要があり、**何で埋めるかは型が決める**。束 ⑰-3 はここに製品の欄名
 * (`display_name`)を直書きしていた —— 他システムでは型が合わず生成テストがコンパイル
 * できない形だった(独立レビュー 6-A)。
 */

import { describe, expect, it } from 'vitest';
import { claimProfile, claimsOfAll, sessionProfileOf } from '../../../lib/usecase/plan-scenario-actors.js';
import type { ScenarioContext } from '../../../lib/usecase/plan-scenario-rows.js';
import type { ScenarioInput } from '../../../lib/usecase/plan-scenario.js';
import type { RoleDef } from '../../../lib/model/types.js';
import {
  aggregate,
  entitySpec,
  field,
  role,
  specModel,
} from '../../helpers/model-builder-v8plus.js';

describe('セッションが運ぶ欄の既定', () => {
  it('session: true の欄だけを、型から決まる値で埋める', () => {
    const domain = specModel({
      aggregates: [
        aggregate({
          name: 'person',
          entity: entitySpec('person', [
            field('nickname', { kind: 'string' }, { session: true, required: true }),
            field('is_admin', { kind: 'boolean' }, { session: true }),
            field('memo', { kind: 'string' }),
          ]),
        }),
      ],
    });

    // 欄名は 1 つも仕組み側に無い —— 宣言された名前がそのまま出る。
    expect(sessionProfileOf(domain)).toEqual({ nickname: 'x', is_admin: false });
  });

  it('セッションを持つ集約が無ければ空になる', () => {
    const domain = specModel({
      aggregates: [aggregate({ name: 'widget', entity: entitySpec('widget', [field('name', { kind: 'string' })]) })],
    });

    expect(sessionProfileOf(domain)).toEqual({});
  });
});

/** 有効なメンバーだけが立つ既定のログインロール(行の条件の併記。ADR-0018)。 */
const member: RoleDef = {
  ...role('member', undefined, undefined, 'authenticated_default'),
  claim: 'person.status',
  claimValues: ['active'],
};
const staff: RoleDef = { ...role('staff', undefined, ['member']), claim: 'person.is_staff' };
const paused: RoleDef = { ...role('paused'), claim: 'person.status', claimValues: ['suspended'] };

function conditioned(roles: readonly RoleDef[]): ReturnType<typeof specModel> {
  return specModel({
    roles: [role('anonymous', undefined, undefined, 'anonymous'), ...roles, role('system', undefined, undefined, 'system')],
    aggregates: [
      aggregate({
        name: 'person',
        entity: entitySpec('person', [
          field('nickname', { kind: 'string' }, { session: true, required: true }),
          field('is_staff', { kind: 'boolean' }, { session: true }),
          field('status', { kind: 'enum', values: ['guest', 'active', 'suspended'] }, { session: true, required: true }),
        ]),
      }),
    ],
  });
}

describe('行の条件を宣言したときのセッション(ADR-0018)', () => {
  it('既定の一式は、既定のログインロールの条件を満たす値で埋める(全員が条件を満たさない人にならない)', () => {
    expect(sessionProfileOf(conditioned([member, staff]))).toEqual({
      nickname: 'x',
      is_staff: false,
      status: 'active',
    });
  });

  it('条件を宣言しなければ型から決まる値のまま(従来と同じ)', () => {
    expect(sessionProfileOf(conditioned([role('member', undefined, undefined, 'authenticated_default'), staff]))).toEqual({
      nickname: 'x',
      is_staff: false,
      status: 'guest',
    });
  });

  const ctx = (fields: readonly string[], roles: readonly string[]): ScenarioContext =>
    ({ claimFields: fields, claimRoles: roles }) as unknown as ScenarioContext;
  const input = (domain: ReturnType<typeof specModel>): ScenarioInput => ({ domain }) as unknown as ScenarioInput;

  it('claim のロールの実行者は、claim の欄を条件を満たす値にする(含意の先の条件も満たす値)', () => {
    const domain = conditioned([member, staff, paused]);
    expect(claimProfile(input(domain), ctx(['is_staff', 'status'], ['staff', 'paused']), 'staff')).toEqual({
      is_staff: true,
      status: 'active',
    });
    expect(claimProfile(input(domain), ctx(['is_staff', 'status'], ['staff', 'paused']), 'paused')).toEqual({
      status: 'suspended',
    });
  });

  it('claim が根拠でないロール・計画が欄を使わないロールは何も足さない', () => {
    const domain = conditioned([member, staff, paused]);
    expect(claimProfile(input(domain), ctx(['status'], ['paused']), 'member')).toEqual({});
    expect(claimProfile(input(domain), ctx(['status'], ['paused']), 'staff')).toEqual({});
  });

  it('性質の実行者は手順が認める claim のロールを全部持つ(同じ欄は先に来たロールを優先する)', () => {
    const domain = conditioned([member, staff, paused]);
    expect(claimsOfAll(input(domain), ctx(['is_staff', 'status'], ['staff', 'paused']))).toEqual({
      is_staff: true,
      status: 'active',
    });
    expect(claimsOfAll(input(domain), ctx([], []))).toEqual({});
  });
});
