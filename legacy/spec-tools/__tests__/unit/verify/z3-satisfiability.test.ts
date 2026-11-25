/**
 * V9 / V10 の充足性判定を Z3 に差し替える配線(先読み → 判定 → 本走)の単体テスト。
 *
 * 仕様: legacy/spec-tools/lib/verify/z3-satisfiability.ts の冒頭
 *       BACKLOG「形式手法の導入」(b) Z3 を前倒し(束 ⑳-5c)
 *
 * ここで一番大事なのは **「充足性を問う検証器は V9 / V10 だけ」という事実そのものを実測する**
 * 目である(`SATISFIABILITY_VERIFIER_IDS`)。将来、別の検証器が充足性を問い始めたとき、
 * 先読みの範囲に入っていなければ**その検証器だけ黙って自作の列挙器に落ちる** ——
 * 落ちても答えは出るので、検査の範囲が縮んだことが誰にも見えない。
 */

import { afterAll, describe, expect, it } from 'vitest';
import { createGuardServices } from '../../../lib/guard/services.js';
import { shutdownZ3 } from '../../../lib/guard/z3.js';
import {
  SATISFIABILITY_VERIFIER_IDS,
  collectSatQueries,
  recordSatisfiability,
  withZ3Satisfiability,
  z3Satisfiability,
} from '../../../lib/verify/z3-satisfiability.js';
import { ALL_VERIFIERS } from '../../../lib/verify/verifiers/index.js';
import type { VerifyContext } from '../../../lib/check-api/contract.js';
import type { SpecModel } from '../../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
  createRule,
  entitySpec,
  event,
  field,
  invariant,
  invariantSpec,
  machine,
  role,
  specModel,
} from '../../helpers/model-builder-v8plus.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../helpers/verify-inputs.js';

afterAll(async () => {
  await shutdownZ3();
});

/** guard(V9)と kind: check の不変条件(V10)を 1 つずつ持つモデル。 */
function model(): SpecModel {
  return specModel({
    roles: [role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'entry',
        entity: entitySpec('entry', [
          field('state', { kind: 'state', machine: 'entry' }),
          field('duration_min', { kind: 'integer' }),
        ]),
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted'],
            events: [
              event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['member'], guard: 'state == draft' }),
            ],
          }),
        ],
        access: accessSpec('entry', { creates: [createRule('member', 'state == draft')] }),
        invariants: invariantSpec([
          invariant({
            id: 'INV-ENTRY-001',
            formal: { kind: 'check', expr: 'duration_min > 30 and duration_min < 10' },
            enforcedBy: [
              { kind: 'db_constraint', ref: 'entries_duration_check', location: { file: 'docs/specs/domain/entry/invariants.md' } },
            ],
          }),
        ]),
      }),
    ],
  });
}

/** 列挙器を配線した文脈。 */
function baseContext(): VerifyContext {
  return { guards: createGuardServices(), roots: TEST_ROOTS, ...NO_DOMAIN_INPUTS };
}

describe('recordSatisfiability', () => {
  it('問いを記録しながら、答えは委譲先(列挙器)のものを返す', () => {
    const base = createGuardServices();
    const recorder = recordSatisfiability(base);
    const parsed = recorder.services.parse('state == draft and state == submitted');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const env = new Map([['state', { kind: 'finite' as const, values: ['draft', 'submitted'] }]]);

    expect(recorder.services.satisfiability(parsed.expr, env).verdict).toBe('unsatisfiable');
    expect(recorder.queries).toHaveLength(1);
    expect(recorder.queries[0]?.env).toBe(env);
  });
});

describe('collectSatQueries', () => {
  it('V9 と V10 が問う式を集める', () => {
    const queries = collectSatQueries(model(), baseContext());
    expect(queries.length).toBeGreaterThanOrEqual(3);
  });

  it('充足性を問う検証器は SATISFIABILITY_VERIFIER_IDS に挙がったものだけである(検査の漏れの見張り)', () => {
    const target = model();
    const askers = ALL_VERIFIERS.filter((verifier) => {
      const recorder = recordSatisfiability(createGuardServices());
      verifier.verify(target, { roots: TEST_ROOTS, guards: recorder.services, ...NO_DOMAIN_INPUTS });
      return recorder.queries.length > 0;
    }).map((verifier) => verifier.id);

    expect(askers).toEqual([...SATISFIABILITY_VERIFIER_IDS]);
  });
});

describe('z3Satisfiability', () => {
  it('記録した問いには Z3 の答えを返し、記録に無い問いは列挙器に落ちる', async () => {
    const base = createGuardServices();
    const env = new Map([['doc.cnt', { kind: 'ordered' as const, discrete: true }]]);
    const recorded = base.parse('doc.cnt > 1 and doc.cnt < 2');
    const unrecorded = base.parse('doc.cnt > 1');
    expect(recorded.ok && unrecorded.ok).toBe(true);
    if (!recorded.ok || !unrecorded.ok) return;

    const guards = await z3Satisfiability(base, [{ expr: recorded.expr, env }]);

    expect(guards.satisfiability(recorded.expr, env).verdict).toBe('unsatisfiable');
    expect(guards.satisfiability(unrecorded.expr, env).verdict).toBe('satisfiable');
  });

  it('列挙器の上限を超える式にも答える(前倒しの実測)', async () => {
    const base = createGuardServices();
    const env = new Map([['doc.cnt', { kind: 'ordered' as const, discrete: true }]]);
    const source = `${Array.from({ length: 14 }, (_, i) => `doc.cnt > ${i}`).join(' and ')} and doc.cnt < 0`;
    const parsed = base.parse(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(base.satisfiability(parsed.expr, env).verdict).toBe('unknown');
    const guards = await z3Satisfiability(base, [{ expr: parsed.expr, env }]);
    expect(guards.satisfiability(parsed.expr, env).verdict).toBe('unsatisfiable');
  });
});

describe('答えの表の鍵(keyOf)', () => {
  it('値域だけが違う同じ字面の問いは別の問いとして解く(他の集約の綴りを反例に出さない)', async () => {
    const base = createGuardServices();
    // finite の値は SMT-LIB では採番した整数に潰れるので、declarations も formula も
    // 一字一句同じになる。鍵に綴りを混ぜないと、**後から解いた側に先の綴りの反例が返る**。
    const a = new Map([['state', { kind: 'finite' as const, values: ['draft', 'accepting', 'closed'] }]]);
    const b = new Map([['state', { kind: 'finite' as const, values: ['pending', 'confirmed', 'cancelled'] }]]);
    const parsedA = base.parse('state in [draft, accepting, closed]');
    const parsedB = base.parse('state in [pending, confirmed, cancelled]');
    expect(parsedA.ok && parsedB.ok).toBe(true);
    if (!parsedA.ok || !parsedB.ok) return;

    const guards = await z3Satisfiability(base, [
      { expr: parsedA.expr, env: a },
      { expr: parsedB.expr, env: b },
    ]);

    expect(guards.satisfiability(parsedA.expr, a).witness?.state).toBe('draft');
    expect(guards.satisfiability(parsedB.expr, b).witness?.state).toBe('pending');
  });
});

describe('withZ3Satisfiability', () => {
  it('V9 の判定が Z3 の答えになる(恒偽を Z3 が見つける)', async () => {
    const target = model();
    const { ctx, solved } = await withZ3Satisfiability(target, baseContext());
    // guard と creates.when が同じ字面なら同じ SMT-LIB になり、解くのは 1 回で済む。
    expect(solved).toBe(2);

    const v10 = ALL_VERIFIERS.find((verifier) => verifier.id === 'V10');
    const findings = v10?.verify(target, ctx) ?? [];
    expect(findings.map((finding) => finding.message).join('\n')).toContain('恒偽');
  });
});
