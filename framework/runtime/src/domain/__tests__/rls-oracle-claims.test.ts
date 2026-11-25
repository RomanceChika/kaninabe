/**
 * RLS のオラクル(`@kaninabe/runtime/testing/rls/oracle`)が **`claim` の値の集合と含意の先の行の条件**を読むこと
 * (ADR-0018)の単体テスト。実 DB は使わない(固定した world のリテラルを渡す)。
 *
 * 見るのは 4 点である。
 *   1. 既定のログインロールが値の集合の条件を併記していれば、行があるだけでは立たない(行 AND 条件)
 *   2. 条件を持つロールを含意するロール(束縛・boolean の claim)は、含意の先の条件を満たさないと立たない(E2)
 *   3. 含意しないロール(本人)は、条件を満たさない人にも立つ
 *   4. 条件を宣言していなければ従来のまま(boolean の claim だけでロールが立つ)
 *
 * ロール ID・集約名は仮の語である(オラクルは設計図の語しか知らない)。
 */

import { describe, expect, it } from 'vitest';
import { oracleVisibility } from '@kaninabe/runtime/testing/rls/oracle';
import type { RlsWorld, RlsWorldRole } from '@kaninabe/runtime/testing/rls/types';
import type { BuiltRlsActor, BuiltRlsRow, BuiltRlsWorld } from '@kaninabe/runtime/testing/rls/world';

/** ロールの根拠(`state in [active]` を併記した既定のログインロールと、それを含意する束縛 / boolean の claim)。 */
function roles(options: { readonly conditioned: boolean }): readonly RlsWorldRole[] {
  const base = { anonymous: false, system: false, authenticatedDefault: false, claimField: null, binding: null, implies: [] };
  return [
    { ...base, id: 'anonymous', anonymous: true },
    {
      ...base,
      id: 'member',
      authenticatedDefault: true,
      ...(options.conditioned ? { claimField: 'state', claimValues: ['active'] } : {}),
    },
    { ...base, id: 'system', system: true },
    { ...base, id: 'staff', claimField: 'is_staff', implies: ['member'] },
    { ...base, id: 'owner', binding: { entity: 'project', column: 'owner_id', many: false }, implies: ['member'] },
    { ...base, id: 'self', binding: { entity: 'person', column: 'id', many: false } },
  ] as const;
}

/** 実行者 4 人(通常 / 条件を満たさない)の設計図。実行者の行は person、対象は project。 */
const WORLD: RlsWorld = {
  table: 'projects',
  entity: 'project',
  actorTable: 'people',
  actors: [
    { key: 'owner', role: 'owner', anonymous: false, row: 'owner:person' },
    { key: 'owner_unmet', role: 'owner', anonymous: false, row: 'owner_unmet:person', unmet: 'member' },
    { key: 'staff', role: 'staff', anonymous: false, row: 'staff:person' },
    { key: 'staff_unmet', role: 'staff', anonymous: false, row: 'staff_unmet:person', unmet: 'member' },
    { key: 'member', role: 'member', anonymous: false, row: 'member:person' },
    { key: 'member_unmet', role: 'member', anonymous: false, row: 'member_unmet:person', unmet: 'member' },
    { key: 'self_unmet', role: 'self', anonymous: false, row: 'self_unmet:person', unmet: 'member' },
    { key: 'anonymous', role: 'anonymous', anonymous: true, row: null },
  ],
  rows: ['owner', 'owner_unmet', 'staff', 'staff_unmet', 'member', 'member_unmet', 'self_unmet'].flatMap((key) => [
    {
      key: `${key}:person`,
      table: 'people',
      entity: 'person',
      values: {},
      refs: {},
      actor: key,
      ancestry: { person: `${key}:person` },
    },
    {
      key: `${key}:project`,
      table: 'projects',
      entity: 'project',
      values: {},
      refs: { owner_id: `${key}:person` },
      actor: null,
      ancestry: { project: `${key}:project`, person: `${key}:person` },
    },
  ]),
  targets: ['owner', 'owner_unmet', 'staff', 'staff_unmet', 'member', 'member_unmet', 'self_unmet'].map(
    (key) => `${key}:project`,
  ),
  reads: [
    { by: 'anonymous', scope: 'none', filters: [], when: null },
    { by: 'member', scope: 'all', filters: [], when: null },
    { by: 'staff', scope: 'all', filters: [], when: null },
    { by: 'owner', scope: 'own', filters: [], when: null },
    { by: 'system', scope: 'all', filters: [], when: null },
  ],
};

/** 実行者のセッションの写し(通常は有効・条件を満たさない人は退会)。 */
function claims(key: string): Readonly<Record<string, unknown>> {
  return { state: key.endsWith('_unmet') ? 'left' : 'active', is_staff: key.startsWith('staff') };
}

/** 実 DB に作った world。 */
function built(): BuiltRlsWorld {
  const keys = ['owner', 'owner_unmet', 'staff', 'staff_unmet', 'member', 'member_unmet', 'self_unmet'];
  const rows: BuiltRlsRow[] = keys.flatMap((key) => [
    { key: `${key}:person`, table: 'people', entity: 'person', id: `id-${key}`, values: { id: `id-${key}` } },
    {
      key: `${key}:project`,
      table: 'projects',
      entity: 'project',
      id: `project-${key}`,
      values: { owner_id: `id-${key}` },
    },
  ]);
  const actors: BuiltRlsActor[] = [
    ...keys.map((key) => ({ key, id: `id-${key}`, token: 't', claims: claims(key) })),
    { key: 'anonymous', id: null, token: null, claims: {} },
  ];
  return {
    rows: new Map(rows.map((row) => [row.key, row])),
    actors: new Map(actors.map((actor) => [actor.key, actor])),
  };
}

/** 本人のロールにも読み取りを宣言した設計図(本人は全員に立つので、ほかの検査には混ぜない)。 */
const WORLD_WITH_SELF: RlsWorld = {
  ...WORLD,
  reads: [...WORLD.reads, { by: 'self', scope: 'own', filters: [], when: null }],
};

/** その実行者に見えるべき行の id(拒否なら null)。 */
function seen(actor: string, conditioned = true, world: RlsWorld = WORLD): readonly string[] | null {
  const result = oracleVisibility(world, built(), actor, roles({ conditioned }));
  return result.denied ? null : result.ids;
}

describe('RLS のオラクル — 行の条件(claim の値の集合と含意の先の条件)', () => {
  it('条件を満たす人: 既定のログインロール・束縛・boolean の claim のどれも、宣言どおりに立つ', () => {
    expect(seen('member')).toEqual([...WORLD.targets.map((key) => `project-${key.split(':')[0]}`)]);
    expect(seen('owner')).toContain('project-owner');
    expect(seen('staff')).toHaveLength(WORLD.targets.length);
  });

  it('既定のログインロールの条件を満たさない人は、行があっても既定のロールを持たず、何も見えない', () => {
    expect(seen('member_unmet')).toEqual([]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-ROLECLAIM-004
  it('含意の先の条件を満たさない人は、束縛が成立していても boolean の claim が真でも立たない(E2)', () => {
    expect(seen('owner_unmet')).toEqual([]);
    expect(seen('staff_unmet')).toEqual([]);
  });

  it('含意しないロール(本人)は、条件を満たさない人にも立つ', () => {
    expect(seen('self_unmet', true, WORLD_WITH_SELF)).toEqual(['project-self_unmet']);
    expect(seen('self_unmet')).toEqual([]);
  });

  it('未ログインは条件に関係なく未ログインのロールの読み取りだけを見る', () => {
    expect(oracleVisibility(WORLD, built(), 'anonymous', roles({ conditioned: true })).denied).toBe(true);
  });

  it('条件を宣言していなければ従来のまま(行があれば既定のロールが立ち、含意で閉じる)', () => {
    expect(seen('member_unmet', false)).toHaveLength(WORLD.targets.length);
    expect(seen('owner_unmet', false)).toHaveLength(WORLD.targets.length);
  });

  it('値の集合の条件は、欄が文字列でない・無いときも満たさない', () => {
    const odd = built();
    const actor = odd.actors.get('member');
    if (actor === undefined) throw new Error('fixture');
    const noState = { ...odd, actors: new Map(odd.actors).set('member', { ...actor, claims: { state: true } }) };
    expect(oracleVisibility(WORLD, noState, 'member', roles({ conditioned: true })).ids).toEqual([]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-ROLECLAIM-005
  it('未ログインのロールの読み取りは、ログイン中の人にも同じに効く(条件を満たさない人・行が無い人も、見られるものが減らない)', () => {
    const openWorld: RlsWorld = {
      ...WORLD,
      reads: WORLD.reads.map((rule) => (rule.by === 'anonymous' ? { ...rule, scope: 'all' as const } : rule)),
    };
    const everything = WORLD.targets.map((key) => `project-${key.split(':')[0]}`);
    expect(seen('anonymous', true, openWorld)).toEqual(everything);
    // 条件を満たさない人も、未ログインのロールとして全部読める(本人の束縛で読むわけではない)。
    expect(seen('member_unmet', true, openWorld)).toEqual(everything);
    expect(seen('owner_unmet', true, openWorld)).toEqual(everything);
    // 行が無いログイン実行者(実行者の集約に行が無い人)も同じ。
    const noRow = built();
    const actor = noRow.actors.get('member');
    if (actor === undefined) throw new Error('fixture');
    const withoutRow: BuiltRlsWorld = {
      ...noRow,
      rows: new Map([...noRow.rows].filter(([key]) => key !== 'member:person')),
      actors: new Map(noRow.actors).set('member', { ...actor, id: 'id-nobody', claims: {} }),
    };
    expect(oracleVisibility(openWorld, withoutRow, 'member', roles({ conditioned: true })).ids).toEqual(everything);
    // 未ログインのロールが読めない表では、条件を満たさない人は権限ごと無い(拒否ではなく 0 行になるのは読める表だけ)。
    expect(seen('member_unmet')).toEqual([]);
  });

  it('boolean の条件を既定のログインロールに併記したときは、真のときだけ立つ(行 AND 条件)', () => {
    const booleanLogin: readonly RlsWorldRole[] = roles({ conditioned: false }).map((role) =>
      role.id === 'member' ? { ...role, claimField: 'is_staff' } : role,
    );
    expect(oracleVisibility(WORLD, built(), 'member', booleanLogin).ids).toEqual([]);
    expect(oracleVisibility(WORLD, built(), 'staff', booleanLogin).ids).toHaveLength(WORLD.targets.length);
  });
});
