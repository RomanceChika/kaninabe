/**
 * プラットフォームの設定(`PlatformProfile`)から SQL の字面を導く純関数(`lib/sql/platform-sql.ts`)と、
 * 設定を引数に取る外から届く surface の ACL(`api-acl.ts`)のテスト。
 *
 * 規約網羅: ロールの並び(一般利用者 → 内部実行)・実行者の式の包み(初期計画に畳む `(select …)`)・
 * セッション属性の枝の辿り方(鍵が 2 つでも 1 つでも)・外に出すスキーマの修飾名・ACL の閉世界。
 * 設定の中身を持たない関数なので、本番の設定と別の設定の両方で同じ形が出ることを見る。
 */

import { describe, expect, it } from 'vitest';
import { apiViewAcl } from '../../../lib/sql/api-acl.js';
import type { FunctionCreator } from '../../../lib/model/product/platform-profile.js';
import { actorIdSql, callerRoles, endUserRoles, exposed, platformProfileProblems, privilegedRole } from '../../../lib/sql/platform-sql.js';
import { FOREIGN_PLATFORM, TEST_PLATFORM } from '../../helpers/platform.js';

describe('ロールの並び', () => {
  it('一般利用者は未ログイン → ログイン済みの順で、内部実行は別に引ける', () => {
    expect(endUserRoles(TEST_PLATFORM)).toEqual(['anon', 'authenticated']);
    expect(privilegedRole(TEST_PLATFORM)).toBe('service_role');
    expect(callerRoles(TEST_PLATFORM)).toEqual(['anon', 'authenticated', 'service_role']);
    expect(callerRoles(FOREIGN_PLATFORM)).toEqual(['visitor', 'signed_in', 'worker']);
  });
});

describe('設定の契約: roles の 3 つの値は互いに異なる', () => {
  it('互いに異なれば違反は無い(本番の設定・別の設定とも)', () => {
    expect(platformProfileProblems(TEST_PLATFORM)).toEqual([]);
    expect(platformProfileProblems(FOREIGN_PLATFORM)).toEqual([]);
  });

  it('重なる組ごとに理由を返す(throw しない)', () => {
    const roles = { anonymous: 'a', authenticated_default: 'a', system: 'a' } as const;
    const problems = platformProfileProblems({ ...FOREIGN_PLATFORM, roles });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('roles.anonymous と roles.authenticated_default');
    expect(platformProfileProblems({ ...FOREIGN_PLATFORM, roles: { ...roles, anonymous: 'x', authenticated_default: 'y' } })).toEqual([]);
    const one = platformProfileProblems({ ...FOREIGN_PLATFORM, roles: { anonymous: 'x', authenticated_default: 'y', system: 'x' } });
    expect(one).toHaveLength(1);
    expect(one[0]).toContain('roles.anonymous と roles.system');
  });
});

describe('設定の契約: ログインセッションの生死を答える式を持つ', () => {
  it('空・空白だけなら理由を返す(土台の関数が select ; になり、欠けたら閉じる前提が崩れる)', () => {
    for (const sessionAliveExpr of ['', '  \n ']) {
      const problems = platformProfileProblems({ ...FOREIGN_PLATFORM, sessionAliveExpr });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('sessionAliveExpr が空です');
    }
  });
});

describe('設定の契約: 関数を作る役は 1 つ以上で、一般利用者を含まず、扱いが決まっている', () => {
  const required = (role: string): FunctionCreator => ({ role, handling: 'migration' });

  it('空なら理由を返す(新しい関数の既定が誰の分も閉じない)', () => {
    const problems = platformProfileProblems({ ...FOREIGN_PLATFORM, functionCreators: [] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('functionCreators が空です');
  });

  it('一般利用者のロールを含めると役ごとに理由を返す', () => {
    const problems = platformProfileProblems({
      ...FOREIGN_PLATFORM,
      functionCreators: [required('builder'), required('visitor'), required('signed_in')],
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('visitor');
    expect(problems[1]).toContain('signed_in');
  });

  it('理由の無い external は拒む(空白だけも同じ)', () => {
    for (const reason of ['', '  \n ']) {
      const problems = platformProfileProblems({
        ...FOREIGN_PLATFORM,
        functionCreators: [required('builder'), { role: 'operator', handling: 'external', reason }],
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('operator が external なのに reason がありません');
    }
  });

  it('理由つきの external は通る', () => {
    expect(
      platformProfileProblems({
        ...FOREIGN_PLATFORM,
        functionCreators: [required('builder'), { role: 'operator', handling: 'external', reason: '別の層が持つ役' }],
      }),
    ).toEqual([]);
  });

  it('同じ役を 2 度挙げると理由を返す(扱いが食い違う形を塞ぐ)', () => {
    const problems = platformProfileProblems({
      ...FOREIGN_PLATFORM,
      functionCreators: [required('builder'), { role: 'builder', handling: 'external', reason: 'x' }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('builder');
    expect(problems[0]).toContain('2 度');
  });

  it('知らない扱いは拒む(型を迂回した値でも黙って required / external 扱いにしない)', () => {
    const odd = { role: 'builder', handling: 'optional' } as unknown as FunctionCreator;
    const problems = platformProfileProblems({ ...FOREIGN_PLATFORM, functionCreators: [odd] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('optional');
  });
});

describe('実行者・セッション属性・スキーマの字面', () => {
  it('実行者の式は `(select …)` で包む(初期計画に畳ませる Postgres の都合は SQL の側が持つ)', () => {
    expect(actorIdSql(TEST_PLATFORM)).toBe('(select auth.uid())');
    expect(actorIdSql(FOREIGN_PLATFORM)).toBe('(select ctx.actor_id())');
  });

  it('外に出すスキーマの修飾名', () => {
    expect(exposed(TEST_PLATFORM, 'actor_id()')).toBe('api.actor_id()');
    expect(exposed(FOREIGN_PLATFORM, 'actor_id()')).toBe('edge.actor_id()');
  });
});

describe('外から届く surface の ACL(閉世界)', () => {
  it('surface に出るビューは一般利用者に select・内部実行に全権限、内部テーブルのビューは一般利用者に何も与えない', () => {
    const surfaced = Object.fromEntries(apiViewAcl(false, FOREIGN_PLATFORM).map((entry) => [entry.role, entry.privileges]));
    expect(surfaced['visitor']).toEqual(['select']);
    expect(surfaced['signed_in']).toEqual(['select']);
    expect(surfaced['worker']).toContain('truncate');
    const internal = Object.fromEntries(apiViewAcl(true, FOREIGN_PLATFORM).map((entry) => [entry.role, entry.privileges]));
    expect(internal['visitor']).toEqual([]);
    expect(internal['signed_in']).toEqual([]);
    expect(Object.keys(internal)).toEqual(['visitor', 'signed_in', 'worker']);
  });

  it('本番の設定ではロール名が Supabase の名前になる(並びは宣言順)', () => {
    expect(apiViewAcl(false, TEST_PLATFORM).map((entry) => entry.role)).toEqual(['anon', 'authenticated', 'service_role']);
  });
});
