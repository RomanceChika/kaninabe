/**
 * 役の `claim` が state / enum の値の集合を指す形(E1)と、含意の先の行の条件を述語に足す規則(E2)の
 * SQL への翻訳。ADR-0018。
 *
 * 3 つの文脈(翻訳器そのもの / RPC の本文 / RLS のポリシーと補助関数)で、次の 3 点を固定する。
 *
 * 1. 値の集合の claim は `a.{欄} in ('{値}', ...)` に落ちる(boolean の欄は従来の `a.{欄}` のまま)。
 * 2. 含意の先に `claim` があるロールの述語は **自分の根拠 AND 含意の先の行の条件** になる。足すのは行の条件だけで、
 *    配列(`p_actor_roles`)の照合は足さない。RLS では補助関数 `is_{role}()` の呼び出しを足す。
 * 3. **宣言しなければ何も変わらない** — 含意の先に `claim` が無い入力の翻訳は、これまでの字面と 1 バイトも違わない。
 */

import { describe, expect, it } from 'vitest';
import type { RoleDef, SpecModel } from '../../../lib/model/types.js';
import { rolesToSql, type RoleSqlBindings } from '../../../lib/sql/roles-to-sql.js';
import { createRpcBindings } from '../../../lib/sql/rpc-reach.js';
import { buildHelperMigration, buildPolicyMigration } from '../../../lib/sql/rls-migration.js';
import { helperRoles, policyPlans } from '../../../lib/world/rls-plan.js';
import { TEST_PLATFORM } from '../../helpers/platform.js';
import { accessSpec, aggregate, entitySpec, field, read, role, roleSpec, specModel } from '../../helpers/model-builder.js';

/** 有効な利用者だけが立つ既定ロール(E1: kind と claim の併記)。 */
const member: RoleDef = {
  ...role('member', undefined, undefined, 'authenticated_default'),
  claim: 'member.state',
  claimValues: ['active'],
};

/** 条件を宣言しない既定ロール(従来の形)。 */
const plainMember: RoleDef = role('member', undefined, undefined, 'authenticated_default');

/** 運営(boolean の claim)。含意の先に member を持つ。 */
const staff: RoleDef = { ...role('staff', undefined, ['member']), claim: 'member.is_staff' };

/** 休会中だけが立つ役(kind なし・implies なしの値の集合。第 2 段で使う形)。 */
const paused: RoleDef = { ...role('paused'), claim: 'member.state', claimValues: ['suspended', 'lapsed'] };

/** 対象の行との関係で立つ役。 */
const manager = role('manager', 'project.manager_id == actor.id', ['member']);

const base: readonly RoleDef[] = [
  role('anonymous', undefined, undefined, 'anonymous'),
  role('system', undefined, undefined, 'system'),
];

const withCondition: readonly RoleDef[] = [...base, member, staff, paused, manager];
const withoutCondition: readonly RoleDef[] = [...base, plainMember, staff, paused, manager];

const bindings: RoleSqlBindings = {
  actorId: 'p_actor_id',
  actorRoles: 'p_actor_roles',
  reach: (entity) =>
    entity === 'project' ? { kind: 'join', table: 'public.projects', alias: 'c', on: 'c.id = t.project_id' } : null,
  actorRow: (entity) => (entity === 'member' ? { table: 'public.members' } : null),
  valueKind: () => 'opaque',
};

/** 訳せた前提で SQL を取り出す。 */
function translate(by: readonly string[], roles: readonly RoleDef[], b: RoleSqlBindings = bindings): string {
  const result = rolesToSql(by, roles, b);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error([...result.unresolved, ...result.rejected].join(', '));
  return result.sql;
}

const ACTIVE = "exists (select 1 from public.members a where a.id = p_actor_id and a.state in ('active'))";

describe('rolesToSql — 値の集合の claim(E1)', () => {
  it('値が 1 つなら in (...) の 1 要素になる', () => {
    const only: RoleDef = { ...role('active_only'), claim: 'member.state', claimValues: ['active'] };
    expect(translate(['active_only'], [...base, only])).toBe(ACTIVE);
  });

  it('値の集合は宣言順に in (...) へ並ぶ(kind も implies も無い役はそれだけで立つ)', () => {
    expect(translate(['paused'], withCondition)).toBe(
      "exists (select 1 from public.members a where a.id = p_actor_id and a.state in ('suspended', 'lapsed'))",
    );
  });

  it('値の綴りに引用符があっても SQL リテラルとして閉じる', () => {
    const odd: RoleDef = { ...role('odd'), claim: 'member.state', claimValues: ["it's"] };
    expect(translate(['odd'], [...base, odd])).toContain("a.state in ('it''s')");
  });

  it('boolean の claim は従来の字面のまま(値の集合を書かなければ変わらない)', () => {
    expect(translate(['staff'], withoutCondition)).toBe(
      'exists (select 1 from public.members a where a.id = p_actor_id and a.is_staff)',
    );
  });
});

describe('rolesToSql — 含意の先の行の条件(E2)', () => {
  it('claim を持つ役を含意する役は 自分の根拠 AND 含意の先の行の条件 になる(配列の照合は足さない)', () => {
    expect(translate(['staff'], withCondition)).toBe(
      `(exists (select 1 from public.members a where a.id = p_actor_id and a.is_staff) and ${ACTIVE})`,
    );
  });

  it('対象の行との関係で立つ役にも同じ条件が足される', () => {
    expect(translate(['manager'], withCondition)).toBe(
      '(exists (select 1 from public.projects c where c.id = t.project_id ' +
        `and coalesce(((c.manager_id) = (p_actor_id)), false)) and ${ACTIVE})`,
    );
  });

  it('含意の先の行の条件は by の論理和の中でも括弧で閉じる', () => {
    expect(translate(['staff', 'paused'], withCondition)).toBe(
      `((exists (select 1 from public.members a where a.id = p_actor_id and a.is_staff) and ${ACTIVE})` +
        " or exists (select 1 from public.members a where a.id = p_actor_id and a.state in ('suspended', 'lapsed')))",
    );
  });

  it('2 段先の含意でも条件を落とさない', () => {
    const mid: RoleDef = role('mid', undefined, ['member']);
    const top: RoleDef = { ...role('top', undefined, ['mid']), claim: 'member.is_staff' };
    expect(translate(['top'], [...base, member, mid, top])).toBe(
      `(exists (select 1 from public.members a where a.id = p_actor_id and a.is_staff) and ${ACTIVE})`,
    );
  });

  it('含意の先に claim が無ければ何も足さない(宣言しなければ字面は変わらない)', () => {
    expect(translate(['staff'], withoutCondition)).toBe(
      'exists (select 1 from public.members a where a.id = p_actor_id and a.is_staff)',
    );
    expect(translate(['manager'], withoutCondition)).toBe(
      'exists (select 1 from public.projects c where c.id = t.project_id ' +
        'and coalesce(((c.manager_id) = (p_actor_id)), false))',
    );
  });

  it('含意の先の条件を写せなければ(実行者の行の表が分からない)throw せず名前で返る', () => {
    const result = rolesToSql(['staff'], withCondition, { ...bindings, actorRow: () => null });
    expect(result).toEqual({ ok: false, unresolved: ['claim:staff', 'claim:member'], rejected: [] });
  });

  it('impliedGate を渡す文脈では、それが含意の先の条件を決める', () => {
    const sql = translate(['staff'], withCondition, { ...bindings, impliedGate: (gate) => `public.is_${gate.id}()` });
    expect(sql).toBe(
      '(exists (select 1 from public.members a where a.id = p_actor_id and a.is_staff) and public.is_member())',
    );
  });

  it('impliedGate が null を返せば既定(実行者の行で写す)に戻る', () => {
    expect(translate(['staff'], withCondition, { ...bindings, impliedGate: () => null })).toBe(
      translate(['staff'], withCondition),
    );
  });
});

/** RPC の本文の文脈(実行者の集約 member に state を持たせる)。 */
function rpcDomain(): SpecModel {
  return specModel([
    aggregate('member', {
      entity: entitySpec('member', {
        fields: [
          field('id', { kind: 'uuid' }),
          field('state', { kind: 'enum', values: ['guest', 'active', 'suspended', 'lapsed'] }, { session: true }),
          field('is_staff', { kind: 'boolean' }, { session: true }),
        ],
      }),
    }),
    aggregate('project', { entity: entitySpec('project', { fields: [field('id', { kind: 'uuid' })] }) }),
  ]);
}

function rpcRoleBindings(): RoleSqlBindings {
  return createRpcBindings({
    entity: 'project',
    domain: rpcDomain(),
    tableOf: (entity) => ({ member: 'members', project: 'projects' })[entity] ?? null,
    ownColumn: (name) => `t.${name}`,
    ownRefs: new Map(),
  }).role;
}

describe('RPC の本文 — 既定ロールに claim を併記する', () => {
  it('配列の照合を残したまま、行の実在に欄の条件を足す', () => {
    expect(translate(['member'], withCondition, rpcRoleBindings())).toBe(
      "(coalesce('member' = any(p_actor_roles), false) and exists (select 1 from public.members a " +
        "where a.id = p_actor_id and a.state in ('active')))",
    );
  });

  it('claim を併記しなければ従来の字面のまま', () => {
    expect(translate(['member'], withoutCondition, rpcRoleBindings())).toBe(
      "(coalesce('member' = any(p_actor_roles), false) and exists (select 1 from public.members a " +
        'where a.id = p_actor_id))',
    );
  });

  it('含意する役は、含意の先の行の条件だけを足す(配列の照合は足さない)', () => {
    expect(translate(['staff'], withCondition, rpcRoleBindings())).toBe(
      `(exists (select 1 from public.members a where a.id = p_actor_id and a.is_staff) and ${ACTIVE})`,
    );
  });
});

/** RLS の文脈: 実行者の集約 member・対象の集約 line。 */
const tableOf = (entity: string): string | null => ({ line: 'lines', member: 'members' })[entity] ?? null;

function rlsDomain(): SpecModel {
  return specModel(
    [
      aggregate('line', {
        entity: entitySpec('line', {
          context: { line: 'line.id' },
          fields: [field('id', { kind: 'uuid' }), field('owner_id', { kind: 'ref', entity: 'member' })],
        }),
      }),
      aggregate('member', {
        entity: entitySpec('member', {
          context: { member: 'member.id' },
          fields: [
            field('id', { kind: 'uuid' }),
            field('state', { kind: 'enum', values: ['guest', 'active', 'suspended', 'lapsed'] }, { session: true }),
            field('is_staff', { kind: 'boolean' }, { session: true }),
          ],
        }),
      }),
    ],
    roleSpec([...withCondition, role('line_owner', 'line.owner_id == actor.id', ['member'])]),
  );
}

/** line 表のポリシー migration の全文。 */
function linePolicies(roles: readonly RoleDef[], reads: Parameters<typeof read>[]): string {
  const access = accessSpec('line', { reads: reads.map((args) => read(...args)) });
  const result = buildPolicyMigration({
    plans: policyPlans(access, 'lines', roles),
    entity: 'line',
    table: 'lines',
    domain: rlsDomain(),
    tableOf,
    roles,
    platform: TEST_PLATFORM,
    specFiles: [],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.problems.map((problem) => problem.message).join('\n'));
  return result.sql;
}

const lineOwner = role('line_owner', 'line.owner_id == actor.id', ['member']);

describe('RLS — 補助関数の本体', () => {
  /** 補助関数の本文。 */
  function helperOf(target: RoleDef): string {
    const result = buildHelperMigration({ role: target, domain: rlsDomain(), tableOf, specFiles: [], platform: TEST_PLATFORM });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.problems.map((problem) => problem.message).join('\n'));
    return result.sql;
  }

  it('kind と claim を併記した既定ロールは 行の実在 AND 欄の条件', () => {
    expect(helperOf(member)).toContain("where a.id = (select auth.uid()) and a.state in ('active'));");
  });

  it('値の集合だけの役は 行の実在 AND 欄の条件(複数の値)', () => {
    expect(helperOf(paused)).toContain("and a.state in ('suspended', 'lapsed'));");
  });

  it('claim の無い既定ロールは従来どおり行の実在だけ', () => {
    const sql = helperOf(plainMember);
    expect(sql).toContain('where a.id = (select auth.uid()));');
    expect(sql).not.toContain(' and a.');
  });

  it('boolean の claim は従来どおり欄そのもの', () => {
    expect(helperOf(staff)).toContain('where a.id = (select auth.uid()) and a.is_staff);');
  });
});

describe('RLS — ポリシーは 自分の根拠 AND 含意の先の行の条件', () => {
  it('対象の行との関係で立つ役のポリシーに含意の先の補助関数が足される', () => {
    const sql = linePolicies([...base, member, lineOwner], [['line_owner', 'own']]);
    expect(sql).toContain(
      'using ((coalesce(((lines.owner_id) = ((select auth.uid()))), false) and public.is_member()));',
    );
  });

  it('claim の役のポリシーも一様に足される(自分の補助関数 AND 含意の先の補助関数)', () => {
    const sql = linePolicies([...base, member, staff], [['staff', 'all']]);
    expect(sql).toContain('using ((public.is_staff() and public.is_member()));');
  });

  it('含意の先自身のポリシーは自分の補助関数だけ', () => {
    const sql = linePolicies([...base, member], [['member', 'all']]);
    expect(sql).toContain('using (public.is_member());');
  });

  it('含意の先に claim が無ければポリシーの字面は変わらない', () => {
    const sql = linePolicies([...base, plainMember, staff, lineOwner], [['staff', 'all'], ['line_owner', 'own']]);
    expect(sql).toContain('using (public.is_staff());');
    expect(sql).toContain('using (coalesce(((lines.owner_id) = ((select auth.uid()))), false));');
    expect(sql).not.toContain('is_member');
  });

  it('境界(filters)があれば式全体を 1 回だけ 2 値に畳む形のまま、含意の先も論理積に入る', () => {
    // 境界の両辺は同じ値の種別でなければ写さない(参照の列は実行者の id と比べる)。
    const sql = linePolicies([...base, member, staff], [['staff', 'all', { owner_id: 'id' }]]);
    expect(sql).toContain('public.is_staff() and public.is_member()');
  });
});

describe('helperRoles — 含意の先の補助関数も要求する', () => {
  it('ポリシーの役が含意する、行の条件を持つ役の補助関数も数える(宣言順・重複なし)', () => {
    const access = accessSpec('line', { reads: [read('staff', 'all'), read('line_owner', 'own')] });
    const roles = [...base, member, staff, lineOwner];
    expect(helperRoles(policyPlans(access, 'lines', roles), roles)).toEqual(['staff', 'member']);
  });

  it('claim を持たない含意の先は要求しない(宣言しなければ増えない)', () => {
    const access = accessSpec('line', { reads: [read('staff', 'all'), read('line_owner', 'own')] });
    const roles = [...base, plainMember, staff, lineOwner];
    expect(helperRoles(policyPlans(access, 'lines', roles), roles)).toEqual(['staff']);
  });

  it('未ログインの役は含意の先でも補助関数を持たない(根拠が to anon そのものなので関数で判定しない)', () => {
    const anonymous: RoleDef = { ...role('anonymous', undefined, undefined, 'anonymous'), claim: 'member.is_staff' };
    const gated: RoleDef = role('gated', undefined, ['anonymous']);
    const access = accessSpec('line', { reads: [read('gated', 'all')] });
    const roles = [anonymous, gated];
    expect(helperRoles(policyPlans(access, 'lines', roles), roles)).toEqual(['gated']);
  });
});

describe('含意の先に行の条件を持つ役が複数あるとき — 並びは含意を辿った順(深さ優先・宣言順)', () => {
  /** 翻訳器の規則を見るための入力(V11 が許す含意の形かどうかは別の検査の領分)。 */
  const verified: RoleDef = { ...role('verified'), claim: 'member.is_staff' };
  const top: RoleDef = { ...role('top', undefined, ['member', 'verified']), claim: 'member.state', claimValues: ['guest'] };
  const roles: readonly RoleDef[] = [...base, member, verified, top];
  const VERIFIED = 'exists (select 1 from public.members a where a.id = p_actor_id and a.is_staff)';

  it('RPC の述語は 自分の根拠 AND 含意の先を含意の宣言順に', () => {
    expect(translate(['top'], roles)).toBe(
      "(exists (select 1 from public.members a where a.id = p_actor_id and a.state in ('guest')) " +
        `and ${ACTIVE} and ${VERIFIED})`,
    );
  });

  it('含意の宣言順を入れ替えれば並びも入れ替わる(同じ入力からは同じ並び)', () => {
    const swapped: readonly RoleDef[] = [...base, member, verified, { ...top, implies: ['verified', 'member'] }];
    expect(translate(['top'], swapped)).toBe(
      "(exists (select 1 from public.members a where a.id = p_actor_id and a.state in ('guest')) " +
        `and ${VERIFIED} and ${ACTIVE})`,
    );
  });

  it('RLS のポリシーも補助関数の呼び出しが同じ順に並び、補助関数の要求も同じ順(自分 → 含意の先)', () => {
    const rolesWithLine = [...roles, role('unused')];
    const sql = linePolicies(rolesWithLine, [['top', 'all']]);
    expect(sql).toContain('using ((public.is_top() and public.is_member() and public.is_verified()));');
    const access = accessSpec('line', { reads: [read('top', 'all')] });
    expect(helperRoles(policyPlans(access, 'lines', rolesWithLine), rolesWithLine)).toEqual(['top', 'member', 'verified']);
  });
});
