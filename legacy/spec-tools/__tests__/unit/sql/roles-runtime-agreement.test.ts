/**
 * 行の条件(`claim`)の **SQL の述語** と **実行時のロール解決の表** が同じ判定を下すこと(E2。ADR-0018)。
 *
 * 同じ 1 つの宣言を、DB の述語(`rolesToSql` が書く `by` の翻訳)と実行時の先読み(`RoleTables` を読む
 * `resolveActorRolesWith`)が別々に読む。どちらかだけが `claim` の値の集合・含意の先の条件を落とすと、
 * 「先読みは通すが DB が落とす」「DB は通すが先読みが落とす」が黙って作れる。ここでは実 DB を使わず、
 * 翻訳した述語を**小さな評価器**(このテストの中だけにある)で実行者の行に対して評価し、
 * 実行者の行の状態 × boolean の claim × 束縛の成否の全組み合わせで、ロールが立つかが一致することを見る。
 *
 * 評価器が読めるのは翻訳器が書く原子(`exists (…)` / `'ロール' = any(p_actor_roles)` / 束縛の列比較)と
 * `and` / `or` / 丸括弧だけである。翻訳器の字面が変わって読めなくなったら、評価ではなくこのテストが落ちる
 * (一致が検証できなくなったことが見える)。
 */

import { describe, expect, it } from 'vitest';
import { resolveActorRolesWith } from '@kaninabe/runtime/template/actor-roles';
import { rowConditionHolds } from '@kaninabe/runtime/step-decision';
import { rowConditionOf } from '../../../lib/model/role-claim.js';
import { roleTablesOf } from '../../../lib/results/decide.js';
import { rolesToSql, type RoleSqlBindings } from '../../../lib/sql/roles-to-sql.js';
import { createRpcBindings } from '../../../lib/sql/rpc-reach.js';
import type { RoleDef, SpecModel } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, role, roleSpec, specModel } from '../../helpers/model-builder.js';

const ACTOR = 'actor-1';

const login: RoleDef = {
  ...role('member', undefined, undefined, 'authenticated_default'),
  claim: 'member.state',
  claimValues: ['active'],
};
const staff: RoleDef = { ...role('staff', undefined, ['member']), claim: 'member.is_staff' };
const paused: RoleDef = { ...role('paused'), claim: 'member.state', claimValues: ['suspended'] };
const manager = role('manager', 'project.manager_id == actor.id', ['member']);
const roles: readonly RoleDef[] = [
  role('anonymous', undefined, undefined, 'anonymous'),
  login,
  staff,
  paused,
  manager,
  role('system', undefined, undefined, 'system'),
];

function domain(roleList: readonly RoleDef[]): SpecModel {
  return specModel(
    [
      aggregate('member', {
        entity: entitySpec('member', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('state', { kind: 'enum', values: ['guest', 'active', 'suspended', 'left'] }, { session: true }),
            field('is_staff', { kind: 'boolean' }, { session: true }),
          ],
        }),
      }),
      aggregate('project', {
        entity: entitySpec('project', {
          fields: [field('id', { kind: 'uuid' }), field('manager_id', { kind: 'ref', entity: 'member' })],
        }),
      }),
    ],
    roleSpec(roleList),
  );
}

function bindingsOf(model: SpecModel): RoleSqlBindings {
  return createRpcBindings({
    entity: 'project',
    domain: model,
    tableOf: (entity) => ({ member: 'members', project: 'projects' })[entity] ?? null,
    ownColumn: (name) => `t.${name}`,
    ownRefs: new Map(),
  }).role;
}

/** 実行者の行(`null` は行が無い人)と、束縛が成立するか、`p_actor_roles` に渡す配列。 */
interface Situation {
  readonly row: Readonly<Record<string, string | boolean>> | null;
  readonly bound: boolean;
  readonly array: readonly string[];
}

/** SQL の述語を、実行者の行に対して評価する(読めない字面は throw する)。 */
function evaluate(sql: string, situation: Situation): boolean {
  const atoms = sql
    .replace(
      /exists \(select 1 from public\.members a where a\.id = p_actor_id(?: and a\.(\w+)(?: in \(([^)]*)\))?)?\)/g,
      (_, column: string | undefined, list: string | undefined) => {
        if (situation.row === null) return '0';
        if (column === undefined) return '1';
        const value = situation.row[column];
        if (list === undefined) return value === true ? '1' : '0';
        const values = list.split(',').map((item) => item.trim().replace(/^'|'$/g, ''));
        return typeof value === 'string' && values.includes(value) ? '1' : '0';
      },
    )
    .replace(/coalesce\('(\w+)' = any\(p_actor_roles\), false\)/g, (_, id: string) =>
      situation.array.includes(id) ? '1' : '0',
    )
    .replace(/coalesce\(\(\(t\.manager_id\) = \(p_actor_id\)\), false\)/g, () => (situation.bound ? '1' : '0'));
  const tokens = atoms.match(/\(|\)|and|or|[01]/g) ?? [];
  if (tokens.join('').length !== atoms.replace(/\s+/g, '').length) throw new Error(`評価できない字面です: ${sql}`);
  let at = 0;
  const parseOr = (): boolean => {
    let value = parseAnd();
    while (tokens[at] === 'or') {
      at += 1;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  };
  const parseAnd = (): boolean => {
    let value = parseAtom();
    while (tokens[at] === 'and') {
      at += 1;
      const right = parseAtom();
      value = value && right;
    }
    return value;
  };
  const parseAtom = (): boolean => {
    const token = tokens[at];
    at += 1;
    if (token === '(') {
      const inner = parseOr();
      at += 1;
      return inner;
    }
    return token === '1';
  };
  return parseOr();
}

/** 先読み(実行時のロール解決)が立てるロール。`claim` だけが根拠のロールは写しの欄で、束縛は成否で決まる。 */
function resolved(model: SpecModel, situation: Situation): readonly string[] {
  const profile = situation.row;
  const bindings: Record<string, string | null> = { manager: situation.bound ? ACTOR : null };
  for (const candidate of model.roles.roles) {
    const condition = rowConditionOf(candidate);
    if (candidate.kind !== undefined || condition === null) continue;
    bindings[candidate.id] = profile !== null && rowConditionHolds(condition, profile) ? ACTOR : null;
  }
  return resolveActorRolesWith(roleTablesOf(model), ACTOR, profile, bindings, false);
}

const STATES = ['guest', 'active', 'suspended', 'left'] as const;

/** 全組み合わせ(行が無い人 + 状態 4 通り × boolean 2 通り × 束縛の成否 2 通り)の行と束縛。 */
function combos(): readonly Pick<Situation, 'row' | 'bound'>[] {
  const rows: (Readonly<Record<string, string | boolean>> | null)[] = [
    null,
    ...STATES.flatMap((state) => [true, false].map((isStaff) => ({ state, is_staff: isStaff }))),
  ];
  return rows.flatMap((row) => [true, false].map((bound) => ({ row, bound })));
}

/** 全組み合わせ。配列は実行時のロール解決がその組で作るもの(honest な配列)。 */
function situations(model: SpecModel): readonly Situation[] {
  return combos().map((found) => ({ ...found, array: resolved(model, { ...found, array: [] }) }));
}

/** DB が見るべき真偽(宣言だけから書く。実行時の表にも SQL にも依らない): 行の条件を満たすか。 */
function truth(target: string, found: Pick<Situation, 'row' | 'bound'>): boolean {
  const state = found.row?.state;
  const active = state === 'active';
  if (target === 'member') return active;
  if (target === 'staff') return found.row?.is_staff === true && active;
  if (target === 'paused') return state === 'suspended';
  return found.bound && active;
}

const TARGETS = ['member', 'staff', 'paused', 'manager'] as const;

/**
 * 古い / 偽のロール配列(**全ロールを含む**。既定のログインロールを含む kind のロールは常に配列にいる)を渡しても、
 * DB の述語が行の条件だけで決まることを見る。食い違った組の説明を返す(空なら一致)。
 */
function staleMismatches(bindings: RoleSqlBindings): readonly string[] {
  const array = roles.map((candidate) => candidate.id);
  const found: string[] = [];
  for (const situation of combos()) {
    for (const target of TARGETS) {
      const translated = rolesToSql([target], roles, bindings);
      if (!translated.ok) throw new Error(`SQL に写せません: ${target}`);
      if (evaluate(translated.sql, { ...situation, array }) !== truth(target, situation)) {
        found.push(`${target} / ${JSON.stringify(situation)}`);
      }
    }
  }
  return found;
}

/** 実行時が解決した配列を渡したとき、ロールが立つかが先読みと DB で一致しない組の説明(空なら一致)。 */
function honestMismatches(model: SpecModel, roleList: readonly RoleDef[], bindings: RoleSqlBindings): readonly string[] {
  const found: string[] = [];
  for (const situation of situations(model)) {
    for (const target of TARGETS) {
      const translated = rolesToSql([target], roleList, bindings);
      if (!translated.ok) throw new Error(`SQL に写せません: ${target}`);
      if (evaluate(translated.sql, situation) !== situation.array.includes(target)) {
        found.push(`${target} / ${JSON.stringify(situation)}`);
      }
    }
  }
  return found;
}

/** ログインロールの行の条件だけを落とした翻訳(変異)。 */
function withoutLoginCondition(bindings: RoleSqlBindings): RoleSqlBindings {
  return {
    ...bindings,
    globalRole: (target) => {
      const sql = bindings.globalRole?.(target) ?? null;
      return sql === null ? null : sql.replace(" and a.state in ('active')", '');
    },
  };
}

describe('SQL の述語と実行時のロール解決の一致(行の条件・含意の先の条件)', () => {
  it('条件を宣言した版: どの実行者の行・束縛の成否でも、ロールが立つかが一致する', () => {
    const model = domain(roles);
    expect(honestMismatches(model, roles, bindingsOf(model))).toEqual([]);
  });

  it('条件を宣言しない版: 従来どおり(行があれば既定のロール・含意も条件なし)で、やはり一致する', () => {
    const plainRoles = roles.map((candidate) =>
      candidate.id === 'member' ? role('member', undefined, undefined, 'authenticated_default') : candidate,
    );
    const model = domain(plainRoles);
    const bindings = bindingsOf(model);
    // 行が無いのに束縛だけが成立する実行者は、条件の無い版では先読みが束縛のロールの含意で既定のロールを
    // 足してしまう(従来の振る舞い。DB は行の実在で落とすので権威は変わらない)。ここでは比べない。
    const found: string[] = [];
    for (const situation of situations(model).filter((one) => !(one.row === null && one.bound))) {
      for (const target of TARGETS) {
        const translated = rolesToSql([target], plainRoles, bindings);
        if (!translated.ok) throw new Error(`SQL に写せません: ${target}`);
        if (evaluate(translated.sql, situation) !== situation.array.includes(target)) found.push(target);
      }
    }
    expect(found).toEqual([]);
  });

  it('古い / 偽の配列(全ロール入り)でも、DB の述語は行の条件だけで決まる(配列を信じない)', () => {
    expect(staleMismatches(bindingsOf(domain(roles)))).toEqual([]);
  });

  describe('変異: 条件を落とした翻訳は、必ずどれかの検査が赤になる', () => {
    it('ログインロールの行の条件を落とすと、古い配列の検査が食い違いを見つける', () => {
      const mutated = withoutLoginCondition(bindingsOf(domain(roles)));
      expect(staleMismatches(mutated).length).toBeGreaterThan(0);
      expect(staleMismatches(mutated).some((line) => line.startsWith('member / '))).toBe(true);
    });

    it('含意の先の条件を落とすと、実行時の表との一致の検査が食い違いを見つける', () => {
      const model = domain(roles);
      const mutated: RoleSqlBindings = { ...bindingsOf(model), impliedGate: () => '1' };
      expect(honestMismatches(model, roles, mutated).length).toBeGreaterThan(0);
      expect(staleMismatches(mutated).length).toBeGreaterThan(0);
    });
  });
});
