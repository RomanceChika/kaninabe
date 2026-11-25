/**
 * RLS ポリシーの計画(lib/world/rls-plan.ts)のテスト。
 *
 * 期待ポリシー名の表と本文の生成器が**同じ 1 つの関数**から出ることの土台であり、
 * ここが決めるのは 4 つ —— 名前・宛先の Postgres ロール・刈り込み・補助関数が要るロール。
 * 名前の規約の正は ARCH-SP-BE-0001 §RLS の仕様をどこに置くか。
 */

import { describe, expect, it } from 'vitest';
import {
  deadConditions,
  helperName,
  helperRoles,
  needsHelper,
  policyPlans,
} from '../../../lib/world/rls-plan.js';
import { accessSpec, read, role, roleSpec } from '../../helpers/model-builder.js';

/** 題材のロール(グローバル 3 + claim 1 + 文脈 2)。 */
const roles = roleSpec([
  role('anonymous', undefined, undefined, 'anonymous'),
  role('member', undefined, undefined, 'authenticated_default'),
  role('system', undefined, undefined, 'system'),
  { ...role('staff', undefined, ['member']), claim: 'member.is_staff' },
  role('performer', 'entry.performer_id == actor.id', ['member']),
  role('organizer', 'workshop.organizer_id == actor.id', ['member']),
]).roles;

/** その access_spec の計画を名前で並べる。 */
function names(...reads: Parameters<typeof read>[]): readonly string[] {
  const access = accessSpec('entry', { reads: reads.map((args) => read(...args)) });
  return policyPlans(access, 'entries', roles).map((plan) => plan.name);
}

describe('policyPlans — 名前と宛先', () => {
  it('scope ごとに名前を作り、none と内部実行ロールは作らない', () => {
    expect(
      names(['performer', 'own'], ['organizer', 'context(workshop)'], ['member', 'none'], ['system', 'all']),
    ).toEqual(['entries_select_performer_own', 'entries_select_organizer_context']);
  });

  it('境界(filters)は名前に出る(宣言順)', () => {
    expect(names(['member', 'all', { company_id: 'company_id', region: 'region' }])).toEqual([
      'entries_select_member_all_within_company_id_within_region',
    ]);
  });

  it('未ログインのロールだけが anonymous 宛で、ほかは authenticated_default 宛である(役割の語。DB のロール名は SQL を書く側が設定から引く)', () => {
    const access = accessSpec('entry', { reads: [read('anonymous', 'all'), read('member', 'all')] });
    expect(policyPlans(access, 'entries', roles).map((plan) => plan.to)).toEqual(['anonymous', 'authenticated_default']);
  });
});

describe('policyPlans — 刈り込み', () => {
  it('scope: all のロールを含意するロールの own / context は作らない', () => {
    expect(names(['member', 'all'], ['performer', 'own'], ['organizer', 'context(workshop)'])).toEqual([
      'entries_select_member_all',
    ]);
  });

  it('境界を持つ scope: all は刈り込みの根拠にならない(狭いので包含しない)', () => {
    expect(names(['member', 'all', { company_id: 'company_id' }], ['performer', 'own'])).toEqual([
      'entries_select_member_all_within_company_id',
      'entries_select_performer_own',
    ]);
  });

  it('状態の条件を持つ scope: all も刈り込みの根拠にならない(束 §14)', () => {
    // 条件つきの「全件」は条件を外れた行を通さないので、own / context を包含しない ——
    // 刈り込むと、本人にも見えない行が生まれる。
    expect(names(['member', 'all', undefined, 'entry.state != cancelled'], ['performer', 'own'])).toEqual([
      'entries_select_member_all',
      'entries_select_performer_own',
    ]);
  });
});

describe('policyPlans — 状態の条件', () => {
  it('計画は条件をそのまま運ぶ(名前には出さない)', () => {
    const access = accessSpec('entry', {
      reads: [read('member', 'all', { company_id: 'company_id' }, 'entry.state != cancelled')],
    });
    const plans = policyPlans(access, 'entries', roles);
    expect(plans[0]?.name).toBe('entries_select_member_all_within_company_id');
    expect(plans[0]?.when).toBe('entry.state != cancelled');
  });

  it('条件が無ければ null(「条件が無い」を空文字で表さない)', () => {
    const access = accessSpec('entry', { reads: [read('member', 'all')] });
    expect(policyPlans(access, 'entries', roles)[0]?.when).toBeNull();
  });
});

describe('deadConditions — 書いても効かない状態の条件', () => {
  /** その集約の「効かない条件」を (ロール, 理由, 包含しているロール) で並べる。 */
  function dead(...reads: Parameters<typeof read>[]): readonly string[] {
    const access = accessSpec('entry', { reads: reads.map((args) => read(...args)) });
    return deadConditions(access, 'entries', roles).map(
      (entry) => `${entry.by}/${entry.reason}/${entry.coveredBy ?? '-'}`,
    );
  }

  it('刈り込まれる規則の条件を報告する(包含しているロールも)', () => {
    expect(dead(['member', 'all'], ['performer', 'own', undefined, 'entry.state != cancelled'])).toEqual([
      'performer/pruned/member',
    ]);
  });

  it('上界の規則に書いた条件は効く(1 件も出ない)', () => {
    expect(dead(['member', 'all', undefined, 'entry.state != cancelled'], ['performer', 'own'])).toEqual([]);
  });

  it('scope: none と内部実行ロールに書いた条件も報告する(ポリシーがそもそも無い)', () => {
    expect(
      dead(
        ['member', 'all'],
        ['anonymous', 'none', undefined, 'entry.state != cancelled'],
        ['system', 'all', undefined, 'entry.state != cancelled'],
      ),
    ).toEqual(['anonymous/invisible/-', 'system/bypass/-']);
  });

  it('条件を書いていない規則は数えない', () => {
    expect(dead(['member', 'all'], ['performer', 'own'])).toEqual([]);
  });
});

describe('helperRoles — 補助関数が要るロール', () => {
  it('セッションから立つロールと claim のロールだけが補助関数を要る', () => {
    const access = accessSpec('entry', {
      reads: [read('anonymous', 'all'), read('member', 'all'), read('staff', 'all'), read('performer', 'own')],
    });
    expect(helperRoles(policyPlans(access, 'entries', roles), roles)).toEqual(['member', 'staff']);
  });

  it('同じロールが 2 つのポリシーに出ても 1 度だけ数える', () => {
    const access = accessSpec('entry', { reads: [read('staff', 'all')] });
    const plans = [...policyPlans(access, 'entries', roles), ...policyPlans(access, 'entries', roles)];
    expect(helperRoles(plans, roles)).toEqual(['staff']);
  });

  it('未ログインのロールは根拠が to anon そのものなので補助関数を持たない', () => {
    expect(needsHelper(role('anonymous', undefined, undefined, 'anonymous'), 'anonymous')).toBe(false);
    expect(needsHelper(role('member', undefined, undefined, 'authenticated_default'), 'anonymous')).toBe(true);
  });

  it('関数名はロール ID から機械的に決まる', () => {
    expect(helperName('member')).toBe('is_member');
    expect(helperName('staff_member')).toBe('is_staff_member');
  });
});
