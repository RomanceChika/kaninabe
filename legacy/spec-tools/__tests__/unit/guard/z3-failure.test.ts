/**
 * **判定器が壊れたら error になる**ことの単体テスト(束 ⑳-5c-b)。
 *
 * 仕様: legacy/spec-tools/lib/guard/ast.ts の `SatResult.failure`
 *       legacy/spec-tools/lib/verify/satisfiability-findings.ts の冒頭
 *
 * `unknown` には 2 つの意味がある —— 「時間内に答えられなかった」と「判定器が動かなかった」で
 * ある。束 ⑳-5c は両方を同じ `unknown` に畳み、V9 は固定文言で「**判定器が時間内に答えて
 * いません**」と報告していた。WASM のロードが失敗したときも、写像が吐いた SMT-LIB を判定器が
 * 拒んだとき(= 写像のバグ)も、診断が丸ごと嘘になる。しかも severity が warning なので、
 * **Z3 が 1 件も解けない状態でも `npm run verify` は exit 0** で終わる。
 *
 * ここで固定するのは 2 段である。
 *  1. ソルバーが例外を投げたら `SatResult.failure` が立つ(本物の Z3 は壊さない —— 差し替える)
 *  2. `failure` が立った `unknown` を V9 / V10 は **error** で報告する
 */

import { describe, expect, it } from 'vitest';
import { createGuardServices } from '../../../lib/guard/services.js';
import { satisfiabilityByZ3, type SmtSolver } from '../../../lib/guard/z3.js';
import { z3Satisfiability } from '../../../lib/verify/z3-satisfiability.js';
import { guardSatisfiabilityVerifier } from '../../../lib/verify/verifiers/v9-guard-satisfiability.js';
import { ALL_VERIFIERS } from '../../../lib/verify/verifiers/index.js';
import type { DomainEnv, GuardExpr, GuardServices, SatResult } from '../../../lib/guard/ast.js';
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

/** 起動そのものが失敗する判定器(WASM のロード失敗に相当)。 */
const brokenFactory = async (): Promise<SmtSolver> => {
  throw new Error('Z3 を起動できません');
};

/** SMT-LIB を拒む判定器(= 写像のバグに相当)。 */
const rejectingFactory = async (): Promise<SmtSolver> => ({
  set: () => undefined,
  fromString: () => {
    throw new Error('(error "line 1: unexpected token")');
  },
  check: async () => 'unknown',
  model: () => ({ decls: () => [], get: () => ({ toString: () => '' }) }),
});

/** 時間内に答えられなかった判定器(本物のタイムアウト)。 */
const timingOutFactory = async (): Promise<SmtSolver> => ({
  set: () => undefined,
  fromString: () => undefined,
  check: async () => 'unknown',
  model: () => ({ decls: () => [], get: () => ({ toString: () => '' }) }),
});

/** `state == draft` を 1 つだけ持つ式と環境。 */
function question(): { readonly expr: GuardExpr; readonly env: DomainEnv } {
  const parsed = createGuardServices().parse('state == draft');
  if (!parsed.ok) throw new Error('テストの前提が壊れています');
  return { expr: parsed.expr, env: new Map([['state', { kind: 'finite', values: ['draft', 'submitted'] }]]) };
}

/** guard(V9)と kind: check の不変条件(V10)を 1 つずつ持つモデル。 */
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
            events: [
              event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['member'], guard: 'state == draft' }),
            ],
          }),
        ],
        access: accessSpec('entry', { creates: [createRule('member', 'state == draft')] }),
        invariants: invariantSpec([
          invariant({
            id: 'INV-ENTRY-001',
            formal: { kind: 'check', expr: 'state == draft' },
            enforcedBy: [
              {
                kind: 'db_constraint',
                ref: 'entries_state_check',
                location: { file: 'docs/specs/domain/entry/invariants.md' },
              },
            ],
          }),
        ]),
      }),
    ],
  });
}

/** 充足性だけを固定の答えに差し替えた GuardServices。 */
function guardsAnswering(result: SatResult): GuardServices {
  return { ...createGuardServices(), satisfiability: () => result };
}

describe('satisfiabilityByZ3 — 判定器の故障', () => {
  it('起動に失敗したら failure つきの unknown(黙って畳まない)', async () => {
    const { expr, env } = question();

    const result = await satisfiabilityByZ3(expr, env, { solver: brokenFactory });

    expect(result.verdict).toBe('unknown');
    expect(result.failure).toContain('Z3 を起動できません');
  });

  it('SMT-LIB を拒まれたら failure つきの unknown(= 写像のバグ)', async () => {
    const { expr, env } = question();

    const result = await satisfiabilityByZ3(expr, env, { solver: rejectingFactory });

    expect(result.verdict).toBe('unknown');
    expect(result.failure).toContain('unexpected token');
  });

  it('本物のタイムアウトには failure を立てない(unknown のまま)', async () => {
    const { expr, env } = question();

    const result = await satisfiabilityByZ3(expr, env, { solver: timingOutFactory });

    expect(result.verdict).toBe('unknown');
    expect(result.failure).toBeUndefined();
  });

  it('差し替えた判定器の故障は答えの表を通って検証器まで届く', async () => {
    const { expr, env } = question();

    const guards = await z3Satisfiability(createGuardServices(), [{ expr, env }], { solver: brokenFactory });

    expect(guards.satisfiability(expr, env).failure).toContain('Z3 を起動できません');
  });
});

describe('V9 / V10 — 故障の報告', () => {
  it('V9 は故障を error で報告する(warning 止まりにしない = verify が exit 0 で終わらない)', () => {
    const guards = guardsAnswering({ verdict: 'unknown', failure: 'Z3 を起動できません' });

    const findings = guardSatisfiabilityVerifier.verify(model(), { roots: TEST_ROOTS, guards, ...NO_DOMAIN_INPUTS });

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.severity === 'error')).toBe(true);
    expect(findings[0]?.message).toContain('判定器が壊れています');
  });

  it('V9 はタイムアウトを warning で報告する(仕様の誤りではない)', () => {
    const guards = guardsAnswering({ verdict: 'unknown' });

    const findings = guardSatisfiabilityVerifier.verify(model(), { roots: TEST_ROOTS, guards, ...NO_DOMAIN_INPUTS });

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.severity === 'warning')).toBe(true);
    expect(findings[0]?.message).toContain('時間内に答えていません');
  });

  it('V10 も unknown を黙って通さない(V9 と同じ文面表)', () => {
    const v10 = ALL_VERIFIERS.find((verifier) => verifier.id === 'V10');
    const inline = (result: SatResult): ReturnType<NonNullable<typeof v10>['verify']> =>
      (v10?.verify(model(), { roots: TEST_ROOTS, guards: guardsAnswering(result), ...NO_DOMAIN_INPUTS }) ?? []).filter((finding) =>
        finding.message.includes('行内制約'),
      );

    const timeout = inline({ verdict: 'unknown' });
    const broken = inline({ verdict: 'unknown', failure: '(error "line 1")' });

    expect(timeout.map((finding) => finding.severity)).toEqual(['warning']);
    expect(timeout[0]?.message).toContain('時間内に答えていません');
    expect(broken.map((finding) => finding.severity)).toEqual(['error']);
    expect(broken[0]?.message).toContain('判定器が壊れています');
  });
});
