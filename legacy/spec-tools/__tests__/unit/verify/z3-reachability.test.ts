/**
 * V21 の有界到達性を Z3 に解かせる配線(先読み → 判定 → 本走)の単体テスト。
 *
 * 仕様: legacy/spec-tools/lib/verify/z3-reachability.ts の冒頭
 *       docs/design/v21-bounded-reachability.md §3
 *
 * 一番大事なのは **「有界到達性を問う検証器は V21 だけ」という事実そのものを実測する**目で
 * ある(`REACHABILITY_VERIFIER_IDS`)。将来、別の検証器が到達性を問い始めたとき、先読みの
 * 範囲に入っていなければ**その検証器だけが `no-solver` に落ちる** —— 答え(warning)は出るので、
 * 検査の範囲が縮んだことに誰も気づかない。充足性の側(z3-satisfiability.test.ts)と同じ目である。
 */

import { afterAll, describe, expect, it } from 'vitest';
import { createGuardServices } from '../../../lib/guard/services.js';
import { shutdownZ3 } from '../../../lib/guard/z3.js';
import {
  REACHABILITY_VERIFIER_IDS,
  collectReachProblems,
  recordReachability,
  withZ3Reachability,
  z3Reachability,
} from '../../../lib/verify/z3-reachability.js';
import { ALL_VERIFIERS } from '../../../lib/verify/verifiers/index.js';
import { reachProblems } from '../../../lib/reach/problems.js';
import type { SpecModel } from '../../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  role,
  specModel,
} from '../../helpers/model-builder-v8plus.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { NO_DOMAIN_INPUTS } from '../../helpers/verify-inputs.js';

afterAll(async () => {
  await shutdownZ3();
});

/** 2 状態 1 遷移の最小のモデル(問いは 3 件)。 */
function model(): SpecModel {
  return specModel({
    roles: [role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'entry',
        entity: entitySpec('entry', [field('state', { kind: 'state', machine: 'entry' })]),
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted'],
            events: [event({ id: 'submit', from: ['draft'], to: 'submitted' })],
          }),
        ],
        access: accessSpec('entry'),
      }),
    ],
  });
}

describe('recordReachability', () => {
  it('問いを記録しながら、答えは委譲先のものを返す', () => {
    const recorder = recordReachability(createGuardServices());
    const problem = reachProblems(model())[0];
    expect(problem).toBeDefined();
    if (problem === undefined) return;

    expect(recorder.services.boundedReachability(problem)).toEqual({
      verdict: 'unknown',
      reason: 'no-solver',
    });
    expect(recorder.problems).toEqual([problem]);
  });
});

describe('collectReachProblems', () => {
  it('V21 が問う問いを全部集める(状態 2 件 + 遷移 1 件)', () => {
    const problems = collectReachProblems(model(), { roots: TEST_ROOTS, guards: createGuardServices(), ...NO_DOMAIN_INPUTS });

    expect(problems.map((problem) => problem.key)).toEqual([
      'entry.entry.state.draft',
      'entry.entry.state.submitted',
      'entry.entry.event.submit',
    ]);
  });

  it('有界到達性を問う検証器は REACHABILITY_VERIFIER_IDS に挙がったものだけである(検査の漏れの見張り)', () => {
    const target = model();
    const askers = ALL_VERIFIERS.filter((verifier) => {
      const recorder = recordReachability(createGuardServices());
      verifier.verify(target, { roots: TEST_ROOTS, guards: recorder.services, ...NO_DOMAIN_INPUTS });
      return recorder.problems.length > 0;
    }).map((verifier) => verifier.id);

    expect(askers).toEqual([...REACHABILITY_VERIFIER_IDS]);
  });
});

describe('z3Reachability', () => {
  it('記録した問いには Z3 の答えを返し、記録に無い問いは委譲先に落ちる', async () => {
    const target = model();
    const [first, , third] = reachProblems(target);
    expect(first && third).toBeDefined();
    if (first === undefined || third === undefined) return;

    const { guards, stats } = await z3Reachability(createGuardServices(), target, [first]);

    expect(guards.boundedReachability(first)).toMatchObject({ verdict: 'reachable', bound: 1 });
    expect(guards.boundedReachability(third)).toEqual({ verdict: 'unknown', reason: 'no-solver' });
    expect(stats.solved).toBe(1);
  });
});

describe('withZ3Reachability', () => {
  it('解いた規模(問い・世界の数・最大 K)を報告する', async () => {
    const { stats } = await withZ3Reachability(model(), { roots: TEST_ROOTS, guards: createGuardServices(), ...NO_DOMAIN_INPUTS });

    expect(stats.solved).toBe(3);
    expect(stats.worlds).toBe(1);
    expect(stats.maxBound).toBe(1);
  });
});
