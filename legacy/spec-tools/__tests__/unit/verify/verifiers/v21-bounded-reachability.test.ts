/**
 * V21 有界到達性の単体テスト。
 *
 * 仕様: docs/rules/process/common/specification/standards/domain-spec-writing.md の V21 行
 *       docs/design/v21-bounded-reachability.md §4(受け入れ条件)
 *
 * 捕りたいのは **V5 も V9 も見ていない穴**である —— 遷移グラフは繋がっていて(V5 緑)、
 * ガード式も単体では充足可能なのに(V9 緑)、**その瞬間へ至る実行列が無い**遷移。
 * 「ボタンがいつ押しても効かない」が verify 緑で通る形がこれである。
 *
 * 判定は本物の Z3 に通す(差し替えるのは故障・時間切れを実測する 2 件だけ)。
 */

import { afterAll, describe, expect, it } from 'vitest';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { shutdownZ3, type SmtSolver } from '../../../../lib/guard/z3.js';
import { withZ3Reachability, z3Reachability } from '../../../../lib/verify/z3-reachability.js';
import { boundedReachabilityVerifier } from '../../../../lib/verify/verifiers/v21-bounded-reachability.js';
import { reachabilityVerifier } from '../../../../lib/verify/verifiers/v5-reachability.js';
import { reachProblems } from '../../../../lib/reach/problems.js';
import { buildWorld } from '../../../../lib/reach/world.js';
import type { Finding } from '../../../../lib/kernel/finding.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
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

afterAll(async () => {
  await shutdownZ3();
});

/**
 * 親は open → closed の一方通行。子は「親が閉じてから」準備し、「親が開いている間に」仕上げる。
 *
 * `finish` のガードは単体では充足可能(V9 緑)で、遷移グラフも繋がっている(V5 緑)。
 * しかし親は二度と開かないので、`ready` に居る間に `finish` が実行できる瞬間は**来ない**。
 *
 * @param reopen true にすると親に closed → open の戻り道を足す(= 実行できるようになる)
 * @param idle true にすると、**誰も状態変数を読まない**機械を親の集約に 1 つ足す
 */
function parentChild(reopen: boolean, idle = false): SpecModel {
  const parentEvents = [event({ id: 'close', from: ['open'], to: 'closed' })];
  const idleMachine = machine({
    machine: 'billing',
    states: ['unpaid', 'paid', 'refunded'],
    events: [
      event({ id: 'pay', from: ['unpaid'], to: 'paid' }),
      event({ id: 'refund', from: ['paid'], to: 'refunded' }),
    ],
  });
  const parentFields = [field('state', { kind: 'state', machine: 'parent' })];
  return specModel({
    roles: [role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'parent',
        entity: entitySpec(
          'parent',
          idle ? [...parentFields, field('billing', { kind: 'state', machine: 'billing' })] : parentFields,
        ),
        stateMachines: [
          machine({
            machine: 'parent',
            states: ['open', 'closed'],
            events: reopen
              ? [...parentEvents, event({ id: 'reopen', from: ['closed'], to: 'open' })]
              : parentEvents,
          }),
          ...(idle ? [idleMachine] : []),
        ],
        access: accessSpec('parent'),
      }),
      aggregate({
        name: 'child',
        entity: entitySpec('child', [field('state', { kind: 'state', machine: 'child' })]),
        stateMachines: [
          machine({
            machine: 'child',
            states: ['draft', 'ready', 'done'],
            events: [
              event({ id: 'prepare', from: ['draft'], to: 'ready', guard: 'parent.state == closed' }),
              event({ id: 'force', from: ['draft'], to: 'done' }),
              event({ id: 'finish', from: ['ready'], to: 'done', guard: 'parent.state == open' }),
            ],
          }),
        ],
        access: accessSpec('child'),
      }),
    ],
  });
}

/**
 * 締切の延長の形。`deadline` が実行中不変なら、時刻が締切を過ぎたあとに
 * 「まだ締切前」へは戻れない(`now` は単調非減少)。`writes` に足すと戻れる。
 */
function deadlineModel(writable: boolean): SpecModel {
  return specModel({
    roles: [role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'task',
        entity: entitySpec('task', [
          field('state', { kind: 'state', machine: 'task' }),
          field('deadline', { kind: 'datetime' }),
        ]),
        stateMachines: [
          machine({
            machine: 'task',
            states: ['open', 'late', 'extended'],
            events: [
              event({ id: 'expire', from: ['open'], to: 'late', guard: 'now >= task.deadline' }),
              event({ id: 'extend', from: ['late'], to: 'extended', guard: 'now < task.deadline' }),
            ],
          }),
        ],
        access: accessSpec('task', { writes: writable ? [writeRule('member', ['deadline'])] : [] }),
      }),
    ],
  });
}

/** 本物の Z3 に通して V21 を実行する。 */
async function runV21(model: SpecModel): Promise<readonly Finding[]> {
  const { ctx } = await withZ3Reachability(model, { roots: TEST_ROOTS, guards: createGuardServices(), ...NO_DOMAIN_INPUTS });
  return boundedReachabilityVerifier.verify(model, ctx);
}

describe('V21 — 実行列としての到達性(V5 / V9 が見ていない穴)', () => {
  it('ガードが要求する親の状態へ戻れないと、その遷移が起こせる瞬間が無いと報告する', async () => {
    const model = parentChild(false);

    const findings = await runV21(model);

    expect(reachabilityVerifier.verify(model, stubContext().ctx)).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('child.finish');
    expect(findings[0]?.message).toContain('同時に成り立つ瞬間');
    expect(findings[0]?.counterexample).toMatchObject({
      machine: 'child.child',
      event: 'finish',
      bound: '5',
      involves: 'child.child / parent.parent',
    });
  });

  it('親に戻り道があれば 1 件も出ない', async () => {
    expect(await runV21(parentChild(true))).toEqual([]);
  });
});

describe('V21 — 時刻の単調性と、書ける欄かどうか', () => {
  it('締切が実行中不変だと「締切前へ戻る」遷移に至れない', async () => {
    const findings = await runV21(deadlineModel(false));

    expect(findings.map((finding) => finding.counterexample?.['event'] ?? finding.counterexample?.['state'])).toEqual([
      'extended',
      'extend',
    ]);
  });

  it('締切を `writes` に足すと(誰かが延長できるなら)至れる', async () => {
    expect(await runV21(deadlineModel(true))).toEqual([]);
  });
});

describe('V21 — 判定できなかったときの報告', () => {
  /** 起動そのものが失敗する判定器(WASM のロード失敗に相当)。 */
  const brokenFactory = async (): Promise<SmtSolver> => {
    throw new Error('Z3 を起動できません');
  };

  /** 時間内に答えられなかった判定器。 */
  const timingOutFactory = async (): Promise<SmtSolver> => ({
    set: () => undefined,
    fromString: () => undefined,
    check: async () => 'unknown',
    model: () => ({ decls: () => [], get: () => ({ toString: () => '' }) }),
  });

  /** 差し替えた判定器で答えの表を作り、V21 に通す。 */
  async function withSolver(solver: () => Promise<SmtSolver>): Promise<readonly Finding[]> {
    const model = parentChild(true);
    const base = createGuardServices();
    const { guards } = await z3Reachability(base, model, reachProblems(model), { solver });
    return boundedReachabilityVerifier.verify(model, { roots: TEST_ROOTS, guards, ...NO_DOMAIN_INPUTS });
  }

  it('判定器の故障は error で報告する(warning 止まりにしない)', async () => {
    const findings = await withSolver(brokenFactory);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.severity === 'error')).toBe(true);
    expect(findings[0]?.message).toContain('判定器が壊れています');
    expect(findings[0]?.message).toContain('到達性');
  });

  it('時間切れは warning で報告する(仕様の誤りではない)', async () => {
    const findings = await withSolver(timingOutFactory);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.severity === 'warning')).toBe(true);
    expect(findings[0]?.message).toContain('時間内に答えていません');
  });

  it('答えの表を通していなければ、**モデルに 1 件だけ**報告する(問いごとに出さない)', () => {
    const model = parentChild(true);

    const findings = boundedReachabilityVerifier.verify(model, { roots: TEST_ROOTS, guards: createGuardServices(), ...NO_DOMAIN_INPUTS });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('答えの表が配線されていません');
    expect(findings[0]?.counterexample?.['problems']).toBe(String(reachProblems(model).length));
  });

  it('配線されていないときの文面に機械名・状態 ID・イベント ID を入れない(変異の指紋を汚さない)', () => {
    const model = parentChild(true);

    const message = boundedReachabilityVerifier.verify(model, { roots: TEST_ROOTS, guards: createGuardServices(), ...NO_DOMAIN_INPUTS })[0]?.message ?? '';

    for (const name of ['child', 'parent', 'draft', 'ready', 'done', 'finish', 'prepare', 'force', 'close']) {
      expect(message, name).not.toContain(name);
    }
  });
});

describe('V21 — 世界には参照される機械だけを入れる(答えは変えず K だけ下げる)', () => {
  it('参照されない機械は世界に入らない(K が膨らまない)', () => {
    expect(buildWorld(parentChild(false), 'child', 'child').machines.map((entry) => entry.id)).toEqual([
      'child.child',
      'parent.parent',
    ]);
    expect(buildWorld(parentChild(false, true), 'child', 'child').bound).toBe(3 * 2 - 1);
  });

  it('参照されない機械を足しても V21 の答えは 1 つも変わらない', async () => {
    const without = (await runV21(parentChild(false))).map((finding) => finding.counterexample?.['event']);
    const with_ = (await runV21(parentChild(false, true))).filter(
      (finding) => finding.counterexample?.['machine'] === 'child.child',
    );

    expect(without).toEqual(['finish']);
    expect(with_.map((finding) => finding.counterexample?.['event'])).toEqual(without);
  });
});

describe('V21 — K の打ち切り', () => {
  it('打ち切った世界では、その旨が文面と反例に出る', () => {
    const model = parentChild(true);
    const { ctx } = stubContext({
      defaultReach: {
        verdict: 'unreachable',
        bound: 128,
        truncated: true,
        machines: ['child.child', 'parent.parent'],
      },
    });

    const findings = boundedReachabilityVerifier.verify(model, ctx);

    expect(findings[0]?.message).toContain('K=128 で打ち切り');
    expect(findings[0]?.counterexample?.['truncated']).toBe('K=128 で打ち切り');
  });
});
