/**
 * V9(ガード充足性)の規約網羅テスト。
 * 対象の要求: guard / creates.when / writes.when / deletes.when / binding が恒偽(error)・恒真(warning)でないこと。
 */

import { describe, expect, it } from 'vitest';
import { guardSatisfiabilityVerifier } from '../../../../lib/verify/verifiers/v9-guard-satisfiability.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import {
  accessSpec,
  aggregate,
  createRule,
  deleteRule,
  entitySpec,
  event,
  field,
  machine,
  role,
  specModel,
  stubContext,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../../helpers/verify-inputs.js';

/** guard / when / binding を 1 つずつ持つモデル。 */
function model(
  init: {
    guard?: string;
    when?: string;
    createWhen?: string;
    deleteWhen?: string;
    binding?: string;
  } = {},
) {
  return specModel({
    roles: [role('member'), ...(init.binding === undefined ? [] : [role('performer', init.binding)])],
    aggregates: [
      aggregate({
        name: 'entry',
        entity: entitySpec('entry', [
          field('state', { kind: 'state', machine: 'entry' }),
          field('kind', { kind: 'enum', values: ['solo', 'duo'] }),
        ]),
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted'],
            events: [
              event({
                id: 'submit',
                from: ['draft'],
                to: 'submitted',
                by: ['member'],
                ...(init.guard === undefined ? {} : { guard: init.guard }),
              }),
            ],
          }),
        ],
        access: accessSpec('entry', {
          creates: init.createWhen === undefined ? [] : [createRule('member', init.createWhen)],
          deletes: init.deleteWhen === undefined ? [] : [deleteRule('member', init.deleteWhen)],
          writes: init.when === undefined ? [] : [writeRule('member', ['title'], init.when)],
        }),
      }),
    ],
  });
}

describe('guardSatisfiabilityVerifier', () => {
  it('恒偽の guard をエラーにする', () => {
    const guard = 'state == draft and state == submitted';
    const { ctx } = stubContext({ satisfiability: { [guard]: 'unsatisfiable' } });

    const findings = guardSatisfiabilityVerifier.verify(model({ guard }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V9');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('充足不能');
    expect(findings[0]?.message).toContain('entry.submit');
    expect(findings[0]?.suggestion.length).toBeGreaterThan(0);
    expect(findings[0]?.counterexample).toMatchObject({ guard, satisfiability: 'unsatisfiable' });
  });

  it('恒真の guard は warning にする', () => {
    const guard = 'kind in [solo, duo]';
    const { ctx } = stubContext({ satisfiability: { [guard]: 'tautology' } });

    const findings = guardSatisfiabilityVerifier.verify(model({ guard }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('恒真');
    expect(findings[0]?.counterexample).toMatchObject({ satisfiability: 'tautology' });
  });

  it('satisfiability の witness を反例に載せる', () => {
    const guard = 'kind in [solo, duo]';
    const { ctx } = stubContext({
      satisfiability: { [guard]: { verdict: 'tautology', witness: { 'entry.kind': 'solo' } } },
    });

    const [finding] = guardSatisfiabilityVerifier.verify(model({ guard }), ctx);

    expect(finding?.counterexample).toMatchObject({
      satisfiability: 'tautology',
      'entry.kind': 'solo',
    });
  });

  it('充足可能なら何も報告しない', () => {
    const guard = 'state == draft';
    const { ctx } = stubContext({ satisfiability: { [guard]: 'satisfiable' } });

    expect(guardSatisfiabilityVerifier.verify(model({ guard }), ctx)).toEqual([]);
  });

  // 判定器は Z3(既製品)なので、`unknown` が残るのは「時間内に答えなかった」ときだけである。
  // 黙って通すと恒偽・恒真の見落としが緑のまま生き延びるので warning で報告する(束 ⑳-5c)。
  it('判定不能(unknown)を warning で報告する', () => {
    const guard = 'created_at < now';
    const { ctx } = stubContext({ satisfiability: { [guard]: 'unknown' } });

    const findings = guardSatisfiabilityVerifier.verify(model({ guard }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V9');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('判定できませんでした');
    expect(findings[0]?.suggestion.length).toBeGreaterThan(0);
    expect(findings[0]?.counterexample).toMatchObject({ satisfiability: 'unknown' });
  });

  it('access_spec の when も対象にする', () => {
    const when = 'state == draft and state == submitted';
    const { ctx } = stubContext({ satisfiability: { [when]: 'unsatisfiable' } });

    const findings = guardSatisfiabilityVerifier.verify(model({ when }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('when');
    expect(findings[0]?.location.pointer).toBe('writes.member');
  });

  it('access_spec の creates.when も対象にする', () => {
    const createWhen = 'state == draft and state == submitted';
    const { ctx } = stubContext({ satisfiability: { [createWhen]: 'unsatisfiable' } });

    const findings = guardSatisfiabilityVerifier.verify(model({ createWhen }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('when');
    expect(findings[0]?.message).toContain('creates(by: member)');
    expect(findings[0]?.location.pointer).toBe('creates.member');
  });

  it('access_spec の deletes.when も対象にする', () => {
    const when = 'state == draft and state == submitted';
    const { ctx } = stubContext({ satisfiability: { [when]: 'unsatisfiable' } });

    const findings = guardSatisfiabilityVerifier.verify(model({ deleteWhen: when }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('V9');
    expect(findings[0]?.message).toContain('deletes(by: member)');
    expect(findings[0]?.location.pointer).toBe('deletes.member');
  });

  it('role_spec の binding も対象にする', () => {
    const binding = 'entry.performer_id == actor.id and entry.performer_id != actor.id';
    const { ctx } = stubContext({ satisfiability: { [binding]: 'unsatisfiable' } });

    const findings = guardSatisfiabilityVerifier.verify(model({ binding }), ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('ロール performer');
    expect(findings[0]?.message).toContain('binding');
  });

  it('式が 1 つも無いモデルでは何も報告しない(境界)', () => {
    const { ctx } = stubContext({});

    expect(guardSatisfiabilityVerifier.verify(model(), ctx)).toEqual([]);
  });

  it('パースできない式は V9 では報告しない(構文エラーは V1/V2 の担当)', () => {
    const guard = 'state === draft';
    const { ctx } = stubContext({
      unparsable: { [guard]: '演算子が不正です' },
      satisfiability: { [guard]: 'unsatisfiable' },
    });

    expect(guardSatisfiabilityVerifier.verify(model({ guard }), ctx)).toEqual([]);
  });

  // リテラルの接地は AST を見て決まるので、この 2 件だけは本物のガードサービスを注入する
  // (スタブの AST は生文字列を包んだだけで、比較の左辺が変数ドメインに接地しない)。
  it('値域に無いリテラルを含む式は V9 では報告しない(リテラルの接地は V2 の担当)', () => {
    const ctx = { guards: createGuardServices(), roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS };

    expect(guardSatisfiabilityVerifier.verify(model({ guard: 'state == drafft' }), ctx)).toEqual([]);
  });

  it('値域にあるリテラルなら従来どおり恒偽を報告する', () => {
    const ctx = { guards: createGuardServices(), roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS };

    const findings = guardSatisfiabilityVerifier.verify(
      model({ guard: 'state == draft and state == submitted' }),
      ctx,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('充足不能');
  });

  it('guard は自集約の裸フィールド名を含む変数ドメインで判定する', () => {
    const guard = 'state == draft';
    const { ctx, guards } = stubContext({});

    guardSatisfiabilityVerifier.verify(model({ guard }), ctx);

    const call = guards.satisfiabilityCalls.find((entry) => entry.source === guard);
    expect(call?.env.get('state')).toEqual({ kind: 'finite', values: ['draft', 'submitted'] });
    expect(call?.env.get('kind')).toEqual({ kind: 'finite', values: ['solo', 'duo'] });
  });

  it('binding はモデル全体のドメイン環境で判定する(裸フィールド名を含まない)', () => {
    const binding = 'entry.performer_id == actor.id';
    const { ctx, guards } = stubContext({});

    guardSatisfiabilityVerifier.verify(model({ binding }), ctx);

    const call = guards.satisfiabilityCalls.find((entry) => entry.source === binding);
    expect(call?.env.get('entry.state')).toEqual({ kind: 'finite', values: ['draft', 'submitted'] });
    expect(call?.env.has('state')).toBe(false);
  });
});
