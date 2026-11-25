/**
 * engine ⇔ RPC の一致の証明の**world と軸**(`eq-world` / `eq-cases`)のテスト(束 ⑳-5a)。
 *
 * ここで固定するのは 3 つである。
 *   1. 実行者の並び(役ごとに 1 人 + 既定 + 行が無い人)と、**的が自分の行になる条件**
 *      (本人ロールだけ。それ以外は「自分ではない誰か」の行を動かす)
 *   2. 軸の値(状態の全数・ガード変数の境界値)と、上限を超えたときの畳み方
 *   3. 行を置けない集約は world を作らない(理由を報告する)
 *
 * 実物の 4 題材(`__tests__/samples/**`)が通しの回帰を受け持つので、ここは**判断の分かれ目**
 * だけを小さな題材で固定する。
 */

import { describe, expect, it } from 'vitest';
import { buildEqWorld } from '../../../lib/world/eq-world.js';
import { CASE_LIMIT, eqCasesOf } from '../../../lib/world/eq-cases.js';
import { eqTestCaseIdOf } from '../../../lib/world/eq-catalog.js';
import { layoutPath } from '../../../lib/model/product/layout.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';
import type { EqWorld } from '../../../lib/world/eq-world-types.js';
import type { ScenarioContext } from '../../../lib/usecase/plan-scenario-rows.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';
import type { SpecModel } from '../../../lib/model/types.js';
import {
  aggregate,
  entitySpec,
  field,
  machine,
  role,
  roleSpec,
  specModel,
} from '../../helpers/model-builder.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 題材: 棚(shelf)と実行者の集約 staff_member(棚の担当者が束縛の役)。 */
function domain(): SpecModel {
  return specModel(
    [
      aggregate('shelf', {
        entity: entitySpec('shelf', {
          context: { shelf: 'shelf.id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('label', { kind: 'string' }, { required: true }),
            field('keeper_id', { kind: 'ref', entity: 'staff_member' }, { required: true }),
          ],
        }),
      }),
      aggregate('staff_member', {
        entity: entitySpec('staff_member', {
          context: { staff_member: 'staff_member.id' },
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('is_lead', { kind: 'boolean' }, { required: true, session: true }),
          ],
        }),
      }),
    ],
    roleSpec([
      role('anonymous', undefined, undefined, 'anonymous'),
      role('staff_member', undefined, undefined, 'authenticated_default'),
      role('keeper', 'shelf.keeper_id == actor.id'),
      { ...role('lead'), claim: 'staff_member.is_lead' },
      role('system', undefined, undefined, 'system'),
    ]),
  );
}

/** 2 表。 */
function tables(): readonly DataTableSpec[] {
  return [dataTable('shelves', { entity: 'shelf' }), dataTable('staff_members', { entity: 'staff_member' })];
}

/** world 1 つ(束縛の役 keeper と claim の役 lead を使う集約)。 */
function world(entity = 'shelf'): EqWorld {
  const built = buildEqWorld(entity, {
    domain: domain(),
    tables: tables(),
    bindingRoles: new Map([['keeper', 'shelf.keeper_id']]),
    claimRoles: ['lead'],
  });
  if (!built.ok) throw new Error(built.problems.map((problem) => problem.message).join(' / '));
  return built.world;
}

/** 場面の材料(実行計画から取り出す形を手で組む)。 */
function context(overrides: Partial<ScenarioContext> = {}): ScenarioContext {
  return {
    op: 'shelf.update',
    label: '棚の編集',
    kind: 'update',
    resultIdField: 'id',
    entity: 'shelf',
    event: null,
    domain: domain(),
    reads: [],
    allowedRoles: ['keeper'],
    guardSource: null,
    variables: [],
    sessionVariables: [],
    nowVariables: {},
    stateVariable: null,
    fromStates: [],
    outsideStates: [],
    resultState: null,
    claimFields: ['is_lead'],
    claimRoles: ['lead'],
    invariant: null,
    roleRefs: new Map([['keeper', 'shelf.keeper_id']]),
    inputKeys: ['id', 'label'],
    rules: [{ by: 'keeper', fields: ['label'] }],
    selfRefs: new Map(),
    rpc: 'update_shelf',
    ...overrides,
  };
}

describe('eq-world: world の設計図', () => {
  it('役ごとに 1 人 + 既定 + 行が無い人を置き、束縛の役の系統では的がその人を指す', () => {
    const built = world();
    expect(built.actors.map((actor) => `${actor.key}/${actor.basis}`)).toEqual([
      'keeper/binding',
      'lead/claim',
      'staff_member/default',
      'staff_member_without_row/no_row',
    ]);
    // 行が無い人は系統を持たない(実行する相手は他の系統から借りる)。
    expect(built.actors.at(-1)?.row).toBeNull();
    // 束縛の役の系統では、的の行の束縛の列がその人自身の行を指す。
    const target = built.rows.find((row) => row.key === 'keeper:shelf');
    expect(target?.refs['keeper_id']).toBe('keeper:staff_member');
    // `claim` の役の人の行だけ、根拠の欄が真である。
    expect(built.rows.find((row) => row.key === 'lead:staff_member')?.values['is_lead']).toBe(true);
    expect(built.rows.find((row) => row.key === 'keeper:staff_member')?.values['is_lead']).toBe(false);
  });

  it('`claim` の役ごとに、誰の実行者でもない控えの行を 1 つ置く', () => {
    const spare = world().rows.filter((row) => row.key.startsWith('lead_spare:'));
    expect(spare.map((row) => row.entity)).toContain('staff_member');
    expect(spare.every((row) => row.actor === null)).toBe(true);
    expect(spare.find((row) => row.entity === 'staff_member')?.values['is_lead']).toBe(true);
  });

  it('対象が実行者の集約そのものなら、本人ロール以外の的は別の行になる', () => {
    const built = buildEqWorld('staff_member', {
      domain: domain(),
      tables: tables(),
      bindingRoles: new Map([['account_owner', 'staff_member.id']]),
      claimRoles: ['lead'],
    });
    if (!built.ok) throw new Error('world を作れませんでした');
    const owner = built.world.actors.find((actor) => actor.key === 'account_owner');
    const lead = built.world.actors.find((actor) => actor.key === 'lead');
    // 本人ロールは自分の行が的(分けたら根拠が消える)。
    expect(owner?.target).toBe(owner?.row);
    // それ以外は「自分ではない誰か」の行を動かす。
    expect(lead?.target).not.toBe(lead?.row);
  });

  it('テーブル仕様が無い集約は world を作らず、理由を報告する', () => {
    const built = buildEqWorld('ghost', {
      domain: domain(),
      tables: tables(),
      bindingRoles: new Map(),
      claimRoles: [],
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.problems[0]?.message).toContain('土台がありません');
  });
});

describe('eq-cases: 実行する組み合わせの軸', () => {
  it('編集は「その操作が受け取る欄」を軸にする(writes の欄ではない)', () => {
    const cases = eqCasesOf(world(), context(), 'named');
    expect(cases.fields).toEqual(['label']);
    expect(cases.states).toEqual([null]);
    expect(cases.count).toBe(cases.states.length * cases.actors.length * cases.arrays.length * 1);
  });

  it('遷移は状態機械の全状態を振り、宣言された遷移元が先に並ぶ', () => {
    const cases = eqCasesOf(
      world(),
      context({
        kind: 'transition',
        stateVariable: { key: '#shelf.state', ref: 'shelf.state', inGuard: false },
        fromStates: ['open'],
        outsideStates: ['closed', 'sealed'],
      }),
      'named',
    );
    expect(cases.states).toEqual(['open', 'closed', 'sealed']);
    expect(cases.stateColumn).toBe('state');
  });

  it('実行者自身の行を読む操作からは、行が無い人が外れる', () => {
    const cases = eqCasesOf(
      world(),
      context({
        reads: [{ entity: 'staff_member', table: 'staff_members', idFrom: { kind: 'actor' }, fields: [] }],
      }),
      'named',
    );
    expect(cases.actors).not.toContain('staff_member_without_row');
  });

  it('上限を超えたらガード変数の境界値を 2 値に畳み、畳んだことを報告する', () => {
    const many = Array.from({ length: 12 }, (_, index) => `s${index}`);
    const cases = eqCasesOf(
      world(),
      context({
        kind: 'transition',
        stateVariable: { key: '#shelf.state', ref: 'shelf.state', inGuard: false },
        fromStates: many,
        outsideStates: [],
        variables: [
          {
            key: 'shelf.tone',
            ref: 'shelf.tone',
            bounds: {},
      type: { kind: 'enum', values: ['a', 'b', 'c', 'd'] },
            states: [],
          },
        ],
      }),
      'named',
    );
    expect(cases.count).toBeGreaterThan(CASE_LIMIT);
    expect(cases.folded).toEqual(['guard']);
    expect(cases.axes[0]?.values).toHaveLength(2);
  });

  // 宣言順の両端を残すと、**そのガードを成立させる値**が落ちることがある —— そうなると
  // その操作は「許可される組み合わせを 1 つも実行しない」テストになり、どちら向きの変異でも
  // 赤にならない(束 ⑳-5a の独立レビュー 2-b)。残すのは成立側と不成立側の両方である。
  it('畳んでも「ガードを成立させる値」が必ず残る(宣言順の両端ではない)', () => {
    const many = Array.from({ length: 12 }, (_, index) => `s${index}`);
    const cases = eqCasesOf(
      world(),
      context({
        kind: 'transition',
        stateVariable: { key: '#shelf.state', ref: 'shelf.state', inGuard: false },
        fromStates: many,
        outsideStates: [],
        guardSource: 'shelf.tone == c',
        variables: [
          {
            key: 'shelf.tone',
            ref: 'shelf.tone',
            bounds: {},
      type: { kind: 'enum', values: ['a', 'b', 'c', 'd'] },
            states: [],
          },
        ],
      }),
      'named',
    );
    const values = (cases.axes[0]?.values ?? []).map((value) => value.label);
    // 成立させる唯一の値 `c` は宣言順の両端(a / d)のどちらでもないが、必ず残る。
    expect(values).toContain('c');
    expect(values).toHaveLength(2);
    expect(cases.foldedGuards).toEqual([
      { key: 'shelf.tone', satisfying: ['c'], refuting: expect.any(Array) },
    ]);
    expect(cases.foldedGuards[0]?.refuting).not.toContain('c');
  });

  it('規則が複数あれば、規則ごとの成立側がそれぞれ残る', () => {
    const cases = eqCasesOf(
      world(),
      context({
        rules: [
          { by: 'keeper', fields: ['label'], when: 'shelf.tone == b' },
          { by: 'lead', fields: ['label'], when: 'shelf.tone == d' },
        ],
        inputKeys: ['id', 'label', 'note', 'memo', 'color', 'size', 'place'],
        variables: [
          {
            key: 'shelf.tone',
            ref: 'shelf.tone',
            bounds: {},
      type: { kind: 'enum', values: ['a', 'b', 'c', 'd'] },
            states: [],
          },
        ],
      }),
      'named',
    );
    const values = (cases.axes[0]?.values ?? []).map((value) => value.label);
    expect(values).toContain('b');
    expect(values).toContain('d');
    expect(cases.foldedGuards[0]?.satisfying).toEqual(['b', 'd']);
  });

  it('実行者自身の行から読む集約は actorReads に載る(対象の集約と、入力から引く読みは載らない)', () => {
    const cases = eqCasesOf(
      world(),
      context({
        reads: [
          { entity: 'staff_member', table: 'staff_members', idFrom: { kind: 'actor' }, fields: ['is_lead'] },
          { entity: 'staff_member', table: 'staff_members', idFrom: { kind: 'actor' }, fields: [] },
          { entity: 'shelf', table: 'shelves', idFrom: { kind: 'actor' }, fields: [] },
          { entity: 'shelf', table: 'shelves', idFrom: { kind: 'input', step: 0, field: 'id' }, fields: [] },
        ],
      }),
      'named',
    );
    expect(cases.actorReads).toEqual(['staff_member']);
    expect(eqCasesOf(world(), context(), 'named').actorReads).toEqual([]);
  });

  it('条件を満たさない人だけが古いロール一覧を持つ世界では、組み合わせの数は実行者が持つ配列だけを数える(実行する側の直積と同じ)', () => {
    const gated = specModel(
      [
        aggregate('shelf', {
          entity: entitySpec('shelf', {
            context: { shelf: 'shelf.id' },
            fields: [
              field('id', { kind: 'uuid' }, { auto: true }),
              field('label', { kind: 'string' }, { required: true }),
              field('keeper_id', { kind: 'ref', entity: 'staff_member' }, { required: true }),
            ],
          }),
        }),
        aggregate('staff_member', {
          entity: entitySpec('staff_member', {
            context: { staff_member: 'staff_member.id' },
            fields: [
              field('id', { kind: 'uuid' }, { auto: true }),
              field('state', { kind: 'state', machine: 'staff_member' }, { session: true }),
            ],
          }),
          stateMachines: [machine('staff_member', { states: ['guest', 'active'], initial: 'guest' })],
        }),
      ],
      roleSpec([
        role('anonymous', undefined, undefined, 'anonymous'),
        { ...role('staff_member', undefined, undefined, 'authenticated_default'), claim: 'staff_member.state', claimValues: ['active'] },
        role('keeper', 'shelf.keeper_id == actor.id', ['staff_member']),
        role('system', undefined, undefined, 'system'),
      ]),
    );
    const built = buildEqWorld('shelf', {
      domain: gated,
      tables: tables(),
      bindingRoles: new Map([['keeper', 'shelf.keeper_id']]),
      claimRoles: [],
    });
    if (!built.ok) throw new Error(built.problems.map((problem) => problem.message).join(' / '));
    const cases = eqCasesOf(built.world, context({ domain: gated, claimFields: [], claimRoles: [] }), 'named');

    expect(cases.arrays).toContain('from_stale');
    const holders = built.world.actors.filter((actor) => actor.arrays.some((array) => array.name === 'from_stale'));
    expect(holders.length).toBeGreaterThan(0);
    expect(holders.length).toBeLessThan(cases.actors.length);
    const pairs = cases.actors.reduce(
      (total, key) =>
        total +
        (built.world.actors.find((actor) => actor.key === key)?.arrays.filter((array) => cases.arrays.includes(array.name)).length ?? 0),
      0,
    );
    expect(cases.count).toBe(cases.states.length * pairs * cases.fields.length);
    // 全員が全配列を持つと数えた場合の積より小さい(古いロール一覧は条件を満たさない人だけ)。
    expect(cases.count).toBeLessThan(cases.states.length * cases.actors.length * cases.arrays.length * cases.fields.length);
  });

  describe('他のテナントの行の組み合わせ(crossTenant。点検 3 回目 A3-1・A3-2(c))', () => {
    const BOUND = 'shelf.company_id == actor.company_id';
    const bound = (when: string | undefined, extra: Partial<ScenarioContext> = {}): ScenarioContext =>
      context({ rules: [{ by: 'keeper', fields: ['label'], ...(when === undefined ? {} : { when }) }], ...extra });

    /** 表: 規則の when の形 → 他の系統の行でも実行するか。 */
    const CASES: readonly { readonly name: string; readonly when: string | undefined; readonly cross: boolean }[] = [
      { name: 'when が実行者の属性(id 以外)と結ぶ', when: BOUND, cross: true },
      { name: '辺を入れ替えても同じ', when: 'actor.company_id == shelf.company_id', cross: true },
      { name: 'and の項として結ぶ', when: `shelf.label == x and ${BOUND}`, cross: true },
      { name: 'when が無い', when: undefined, cross: false },
      { name: 'actor.id との比較は境界ではない', when: 'shelf.keeper_id == actor.id', cross: false },
      { name: 'or の片側だけ', when: `${BOUND} or shelf.keeper_id == actor.id`, cross: false },
      { name: '!= は結ばない', when: 'shelf.company_id != actor.company_id', cross: false },
    ];
    for (const row of CASES) {
      it(`${row.name} → ${row.cross ? '実行する' : '実行しない'}`, () => {
        expect(eqCasesOf(world(), bound(row.when), 'named').crossTenant).toBe(row.cross);
      });
    }

    it('規則の 1 本でも結ばなければ実行しない(その規則で他の系統に届くのは仕様どおりかもしれない)', () => {
      const ctx = context({ allowedRoles: ['keeper', 'lead'], rules: [{ by: 'keeper', fields: ['label'], when: BOUND }, { by: 'lead', fields: ['label'] }] });
      expect(eqCasesOf(world(), ctx, 'named').crossTenant).toBe(false);
    });

    it('RPC が判定しない操作(composite)では実行しない', () => {
      expect(eqCasesOf(world(), bound(BOUND), 'none').crossTenant).toBe(false);
      expect(eqCasesOf(world(), bound(BOUND), 'unnamed').crossTenant).toBe(true);
    });

    it('遷移はガードで決まる', () => {
      const transition = (guardSource: string | null): ScenarioContext =>
        context({ kind: 'transition', guardSource, stateVariable: { key: '#shelf.state', ref: 'shelf.state', inGuard: false }, fromStates: ['open'], outsideStates: ['closed'] });
      expect(eqCasesOf(world(), transition(BOUND), 'named').crossTenant).toBe(true);
      expect(eqCasesOf(world(), transition(null), 'named').crossTenant).toBe(false);
    });

    it('件数は「行を持つ実行者 × 他の系統」の分だけ増え、実行する側の列挙(enumerate)と一致する', async () => {
      const { enumerate } = await import('@kaninabe/runtime/testing/equivalence/expect');
      const built = world();
      const plain = eqCasesOf(built, bound(undefined), 'named');
      const cross = eqCasesOf(built, bound(BOUND), 'named');
      const withRow = cross.actors.filter((key) => built.actors.find((actor) => actor.key === key)?.target !== null);
      const pairs = withRow.reduce((total, key) => total + (built.actors.find((actor) => actor.key === key)?.arrays.filter((array) => cross.arrays.includes(array.name)).length ?? 0), 0);
      expect(cross.crossCount).toBe(cross.states.length * pairs * cross.fields.length);
      expect(cross.count).toBe(plain.count + cross.crossCount);
      const operation = { ...cross, crossTenant: true } as never;
      const selections = enumerate({ ...built, operations: [operation] } as never, operation);
      expect(selections).toHaveLength(cross.count);
      // 他の系統の組み合わせは、どれも自分と違う系統の対象の行を指す。
      const foreign = selections.filter((selection) => selection.branch !== null);
      expect(foreign).toHaveLength(cross.crossCount);
      expect(foreign.every((selection) => selection.branch !== selection.actor.target)).toBe(true);
      expect(foreign.every((selection) => selection.label.includes('他のテナントの行'))).toBe(true);
    });
  });

  it('宣言(handwritten / composite)はそのまま軸に写る', () => {
    expect(eqCasesOf(world(), context(), 'unnamed').enforcement).toBe('unnamed');
    expect(eqCasesOf(world(), context(), 'none').enforcement).toBe('none');
  });

  it('テストケースの宣言の宛先は集約名から機械的に決まる', () => {
    expect(layoutPath(TEST_LAYOUT, 'app', 'eq-test', 'shelf')).toBe(
      'app/src/infrastructure/__tests__/generated/equivalence/shelf.eq.test.ts',
    );
    expect(eqTestCaseIdOf('shelf', 3)).toBe('TC-EQ-SHELF-0003');
  });
});
