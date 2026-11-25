/**
 * 作成の**実行者の参照の欄**と規則ごとの縛り(`usecase/actor-bound.ts`)の規約網羅テスト。
 *
 * 同じ 1 本を engine の作成規則表(`self`)・実行計画の事実(環境の変数)・一致の証明の軸(本人 / 他人)が読む。
 * ここで固定するのは、その 3 つが同じ欄・同じ規則を指すこと —— engine と DB がずれた実測(一致の証明 loan.create の
 * 9 通り)の再発防止である。
 *
 *   - A(input に無い必須の欄)は system の規則だけが解く。B(input にある欄)は system の規則と、その欄を delegate で名指した規則が解く
 *   - engine の作成規則表は、縛る規則にだけ `self: ['{集約}.{欄}']` を載せる
 *   - 一致の証明は B の欄に「実行者本人」と「他人」の 2 値の軸を持つ(A は実行者で埋まるので軸を持たない)
 */

import { describe, expect, it } from 'vitest';
import type { CreateRule } from '../../../lib/model/types-access.js';
import type { SpecModel } from '../../../lib/model/types.js';
import type { ScenarioContext } from '../../../lib/usecase/plan-scenario-rows.js';
import { actorBoundFields, boundFieldsOfCreate, declaredOwner, relaxesBinding, ruleBoundFields } from '../../../lib/usecase/actor-bound.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import { createTableData } from '../../../lib/results/engine-tables.js';
import { boundAxesOf } from '../../../lib/world/eq-case-axes.js';
import { accessSpec, aggregate, create, entitySpec, field, role, roleSpec, specModel, stubGuards } from '../../helpers/model-builder.js';

/** 代理の欄と理由を足す(名指した欄だけを解く。点検 10 回目 A10-2)。 */
function delegated(rule: CreateRule, field = 'patron_id'): CreateRule {
  return { ...rule, delegate: [{ entity: 'loan', field, reason: '窓口担当が代わりに作る', location: { file: 'access.md', pointer: 'creates[0].delegate[0]' } }] };
}

/** 利用者(実行者・司書の claim)/ 貸出(持ち主 = 利用者・任意の承認者)の最小ドメイン。 */
function domain(creates: readonly CreateRule[]): SpecModel {
  return specModel(
    [
      aggregate('patron', {
        entity: entitySpec('patron', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('name', { kind: 'string' }, { required: true, session: true }),
            field('is_librarian', { kind: 'boolean' }, { session: true }),
          ],
        }),
      }),
      aggregate('loan', {
        entity: entitySpec('loan', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('patron_id', { kind: 'ref', entity: 'patron' }, { required: true }),
            field('reviewer_id', { kind: 'ref', entity: 'patron' }),
            field('note', { kind: 'string' }),
          ],
        }),
        access: accessSpec('loan', { creates }),
      }),
    ],
    roleSpec([role('patron', undefined, undefined, 'authenticated_default'), role('anonymous'), role('system'), { ...role('librarian'), claim: 'patron.is_librarian' }]),
  );
}

describe('実行者の参照の欄(A / B)', () => {
  it('input にある欄は B、input に無い必須の欄は A、input に無い任意の欄は行に入らないので外す', () => {
    expect(actorBoundFields(domain([create('patron')]), 'loan', ['note'])).toEqual([{ name: 'patron_id', inInput: false }]);
    expect(actorBoundFields(domain([create('patron')]), 'loan', ['patron_id', 'reviewer_id'])).toEqual([
      { name: 'patron_id', inInput: true },
      { name: 'reviewer_id', inInput: true },
    ]);
  });

  it('A は system の規則だけが解き、delegate では解けない。B は delegate でも解ける', () => {
    const model = domain([create('patron')]);
    const roles = model.roles.roles;
    const a = { name: 'patron_id', inInput: false };
    const b = { name: 'patron_id', inInput: true };

    expect(relaxesBinding(create('system'), roles, a)).toBe(true);
    expect(relaxesBinding(create('system'), roles, b)).toBe(true);
    expect(relaxesBinding(create('librarian'), roles, a)).toBe(false);
    expect(relaxesBinding(create('patron'), roles, a)).toBe(false);
    expect(relaxesBinding(delegated(create('patron')), roles, a)).toBe(false);
    expect(relaxesBinding(delegated(create('patron')), roles, b)).toBe(true);
    expect(ruleBoundFields(create('patron'), roles, [a])).toEqual(['patron_id']);
  });

  // 点検 11 回目 A11-3: 「既定のログインロールでない claim のロール = 管理のロール」の推測をしない。
  it.each([
    { name: 'claim のロールは B を解かない(探り台本の形: 一般の利用者の役)', rule: create('librarian'), field: { name: 'patron_id', inInput: true }, relaxes: false },
    { name: 'claim のロールは A を解かない', rule: create('librarian'), field: { name: 'patron_id', inInput: false }, relaxes: false },
    { name: 'claim のロールも名指した B の欄は解く', rule: delegated(create('librarian')), field: { name: 'patron_id', inInput: true }, relaxes: true },
    { name: 'claim のロールが名指しても A は解かない', rule: delegated(create('librarian')), field: { name: 'patron_id', inInput: false }, relaxes: false },
    { name: 'claim のロールが別の欄を名指しても B は解かない', rule: delegated(create('librarian'), 'reviewer_id'), field: { name: 'patron_id', inInput: true }, relaxes: false },
  ])('ロールの種類では解かない: $name', ({ rule, field, relaxes }) => {
    expect(relaxesBinding(rule, domain([create('patron')]).roles.roles, field)).toBe(relaxes);
  });

  it.each([
    { name: '名指した B の欄は解く', delegate: 'patron_id', field: { name: 'patron_id', inInput: true }, relaxes: true },
    { name: '別の欄を名指した delegate は、この B の欄を解かない(後から input に足した欄の縛りを外さない)', delegate: 'reviewer_id', field: { name: 'patron_id', inInput: true }, relaxes: false },
    { name: '名指した欄でも A(input に無い)は解かない', delegate: 'patron_id', field: { name: 'patron_id', inInput: false }, relaxes: false },
  ])('delegate は名指した欄だけを解く(点検 10 回目 A10-2): $name', ({ delegate, field, relaxes }) => {
    const roles = domain([create('patron')]).roles.roles;

    expect(relaxesBinding(delegated(create('patron'), delegate), roles, field)).toBe(relaxes);
  });

  it('delegate が 1 欄だけを名指す規則は、名指していない B の欄を縛ったまま(承認者のための理由が別の欄を覆わない)', () => {
    const model = domain([delegated(create('patron'), 'reviewer_id')]);
    const fields = actorBoundFields(model, 'loan', ['patron_id', 'reviewer_id']);

    expect(ruleBoundFields(delegated(create('patron'), 'reviewer_id'), model.roles.roles, fields)).toEqual(['patron_id']);
  });

  it('どの規則も縛らない欄は「縛る欄」に数えない', () => {
    expect(boundFieldsOfCreate(domain([delegated(create('librarian')), create('system')]), 'loan', ['patron_id'])).toEqual([]);
    expect(boundFieldsOfCreate(domain([create('patron'), delegated(create('librarian'))]), 'loan', ['patron_id'])).toEqual([
      { name: 'patron_id', inInput: true },
    ]);
    expect(boundFieldsOfCreate(domain([create('librarian'), create('system')]), 'loan', ['patron_id'])).toEqual([{ name: 'patron_id', inInput: true }]);
  });
});

describe('engine の作成規則表の self(DB の作成 RPC と同じ導出)', () => {
  it('縛る規則にだけ self を載せ、欄を delegate で名指した司書(claim)の規則には載せない', () => {
    const model = domain([create('patron', 'loan.note == x'), delegated(create('librarian', 'loan.note == x'))]);
    const access = model.aggregates.get('loan')?.access;
    expect(access).toBeDefined();
    if (access === undefined) return;

    const table = createTableData(access, stubGuards(), { domain: model, inputFields: ['patron_id'] });

    expect(table.rules.map((rule) => ({ by: rule.by, self: rule.self }))).toEqual([
      { by: 'patron', self: ['loan.patron_id'] },
      { by: 'librarian', self: undefined },
    ]);
  });

  it('縛りの材料を渡さなければ self を載せない', () => {
    const model = domain([create('patron')]);
    const access = model.aggregates.get('loan')?.access;
    expect(access).toBeDefined();
    if (access === undefined) return;

    expect(createTableData(access, stubGuards()).rules[0]?.self).toBeUndefined();
  });
});

describe('一致の証明の軸(実行者本人 / 他人)', () => {
  /** 作成の場面の材料(この関数が読む欄だけ)。 */
  function context(model: SpecModel, inputKeys: readonly string[]): ScenarioContext {
    return { kind: 'create', domain: model, entity: 'loan', inputKeys } as unknown as ScenarioContext;
  }

  it('B の欄ごとに、本人と他人の 2 値の軸を持つ(正しく縛られた成功と、他人の名義の拒否の両方を実行する)', () => {
    const axes = boundAxesOf(context(domain([create('patron'), delegated(create('librarian'))]), ['patron_id', 'note']));

    expect(axes).toEqual([
      {
        key: 'loan.patron_id',
        values: [
          { label: '実行者本人', placements: [], actorInputs: [{ column: 'patron_id', who: 'self' }] },
          { label: '他人', placements: [], actorInputs: [{ column: 'patron_id', who: 'other' }] },
        ],
      },
    ]);
  });

  it('A の欄(実行者で埋まる)と、縛られない欄は軸を持たない', () => {
    expect(boundAxesOf(context(domain([create('patron')]), ['note']))).toEqual([]);
    expect(boundAxesOf(context(domain([delegated(create('librarian'))]), ['patron_id']))).toEqual([]);
  });
});

describe('持ち主の欄は action_spec の owner の明示だけ(点検 9 回目 A9-1)', () => {
  /** 1 本の action_spec を持つモデル。 */
  function actions(...specs: ReturnType<typeof actionSpec>[]) {
    return { actions: specs, unhandled: [], scans: [], unscanned: [], testTagBaseline: [] };
  }

  it.each([
    { name: '作成の owner を返す', actions: actions(actionSpec({ handles: 'loan.create', input: ['loan.note'], owner: 'loan.patron_id' })), expected: 'patron_id' },
    { name: '宣言が無ければ null(必須で入力に無い実行者参照があっても推測しない)', actions: actions(actionSpec({ handles: 'loan.create', input: ['loan.note'] })), expected: null },
    { name: '別の集約の欄を指す宣言は持ち主にしない', actions: actions(actionSpec({ handles: 'loan.create', input: [], owner: 'patron.id' })), expected: null },
    { name: '作成でない操作の宣言は読まない', actions: actions(actionSpec({ handles: 'loan.renew', input: [], owner: 'loan.patron_id' })), expected: null },
    { name: 'action_spec が無ければ null', actions: undefined, expected: null },
  ])('$name', ({ actions: model, expected }) => {
    expect(declaredOwner(model, 'loan')).toBe(expected);
  });
});
