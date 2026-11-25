/**
 * Y5(予算。warning)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md「導出した 6 指標が予算(既定または宣言)を超えたら
 * warning。免除は理由つき(`accept`)」。
 */

import { describe, expect, it } from 'vitest';
import { budgetVerifier } from '../../../../lib/usecase/verifiers/y5-budget.js';
import { usecaseAccept, usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { blockedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';
import { USECASE_CTX, usecaseInput } from '../_fixtures.js';

const VALID_STEPS = [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')];

/** 保存点 3 つ(= 手数 3)。手数の予算超過を作るには保存の回数を増やす。 */
const THREE_SAVES = [
  usecaseSave('create', [usecaseStep('container.create')]),
  usecaseSave('add', [usecaseStep('item.create')]),
  usecaseSave('submit', [usecaseStep('item.submit')]),
];

describe('Y5 予算', () => {
  it('既定予算の範囲内なら warning が出ない', () => {
    const usecase = usecaseSpec({ saves: [usecaseSave('register', VALID_STEPS)] });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    expect(budgetVerifier.verify(input, USECASE_CTX)).toEqual([]);
  });

  it('宣言した予算を超えると warning になる(手数 = 保存点の数)', () => {
    const usecase = usecaseSpec({ saves: THREE_SAVES, budget: { steps: 2 } });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    const findings = budgetVerifier.verify(input, USECASE_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('Y5');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.counterexample).toMatchObject({ metric: 'steps', value: '3', budget: '2' });
  });

  it('保存点の内側の手順は手数に数えない(粒度を変えるほど警告が増える逆転を起こさない)', () => {
    const usecase = usecaseSpec({ saves: [usecaseSave('register', VALID_STEPS)], budget: { steps: 1 } });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    expect(budgetVerifier.verify(input, USECASE_CTX)).toEqual([]);
  });

  it('accept で理由つき受け入れ済みなら warning を出さない', () => {
    const usecase = usecaseSpec({
      saves: THREE_SAVES,
      budget: { steps: 2 },
      accept: [usecaseAccept('steps', '3 回の保存は最小構成のため受け入れる')],
    });
    const input = usecaseInput({ usecases: { available: true, usecases: [usecase] } });

    expect(budgetVerifier.verify(input, USECASE_CTX)).toEqual([]);
  });
});

describe('Y5 画面の到達の入力が使えないとき(関係の層の gaps)', () => {
  const gap = { input: 'screens', state: 'unselected' } as const;

  /** 画面の予算 0 + 手数の予算 2(保存点 3)= 入力が使えれば画面と手数の 2 件が出る形。 */
  const overBoth = () => {
    const usecase = usecaseSpec({ saves: THREE_SAVES, budget: { steps: 2, screens: 0 } });
    return usecaseInput({ usecases: { available: true, usecases: [usecase] } });
  };
  const metrics = (findings: readonly { counterexample?: Readonly<Record<string, string>> }[]) =>
    findings.map((finding) => finding.counterexample?.['metric']);

  it('使える入力なら、画面の予算も手数の予算も従来どおり数える', () => {
    expect(metrics(budgetVerifier.verify(overBoth(), USECASE_CTX))).toEqual(['steps', 'screens']);
  });

  it('使えなければ、通る画面の数(画面の予算)だけ数えない(ほかの指標は従来どおり)', () => {
    expect(metrics(budgetVerifier.verify(overBoth(), { ...USECASE_CTX, reachabilityGaps: [gap] }))).toEqual(['steps']);
  });
});

describe('Y5 前提(start に入る関門の数)は、関門・画面の入力が使えないとき数えない', () => {
  const gap = { input: 'auth', state: 'blocked', reason: 'invalid' } as const;
  const metrics = (findings: readonly { counterexample?: Readonly<Record<string, string>> }[]) =>
    findings.map((finding) => finding.counterexample?.['metric']);

  /** 前提の予算 -1(= 実測 0 でも超える)+ 手数の予算 2(保存点 3)。前提が数えられれば 2 件、数えなければ手数の 1 件。 */
  const overPreconditions = () => {
    const usecase = usecaseSpec({ saves: THREE_SAVES, budget: { steps: 2, preconditions: -1 } });
    return usecaseInput({ usecases: { available: true, usecases: [usecase] } });
  };

  it('使える入力なら前提も数える。関門が阻害なら前提だけ数えない(空の関門で 0 と断定しない)', () => {
    expect(metrics(budgetVerifier.verify(overPreconditions(), USECASE_CTX))).toEqual(['steps', 'preconditions']);
    expect(metrics(budgetVerifier.verify(overPreconditions(), { ...USECASE_CTX, reachabilityGaps: [gap] }))).toEqual(['steps']);
  });
});

describe('Y5 入力・確認は、action_spec が阻害のとき数えない', () => {
  const metrics = (findings: readonly { counterexample?: Readonly<Record<string, string>> }[]) =>
    findings.map((finding) => finding.counterexample?.['metric']);

  /** 入力の予算 -1・確認の予算 -1(実測 0 でも超える)+ 手数の予算 2(保存点 3)。 */
  const overActionMetrics = () => {
    const usecase = usecaseSpec({ saves: THREE_SAVES, budget: { steps: 2, inputs: -1, confirmations: -1 } });
    return usecaseInput({ usecases: { available: true, usecases: [usecase] } });
  };

  it('使える・未選択なら入力と確認も数える。阻害なら入力と確認だけ数えず、手数などは従来どおり', () => {
    expect(metrics(budgetVerifier.verify(overActionMetrics(), USECASE_CTX))).toEqual(['steps', 'inputs', 'confirmations']);
    expect(metrics(budgetVerifier.verify(overActionMetrics(), { ...USECASE_CTX, actions: UNSELECTED }))).toEqual(['steps', 'inputs', 'confirmations']);
    expect(metrics(budgetVerifier.verify(overActionMetrics(), { ...USECASE_CTX, actions: blockedInput('invalid') }))).toEqual(['steps']);
  });
});

