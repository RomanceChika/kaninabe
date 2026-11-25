/**
 * S13(状態×ロールの到達)の規約網羅テスト。
 *
 * 対象の要求: screen-spec-writing.md「人が起こせる遷移 T(状態機械 M、from の各状態 s、
 * by の各人間ロール r)について、r が入れて・precondition が s を弾かず・entry_point から
 * 届く画面 P が存在する」。S10(存在の向き)を状態×ロールへ全域化したもの。
 */

import { describe, expect, it } from 'vitest';
import { roleStateReachVerifier } from '../../../../lib/screen/verifiers/s13-role-state-reach.js';
import { aggregate, entitySpec, event, field, machine, role, specModel } from '../../../helpers/model-builder-v8plus.js';
import { SCREEN_CTX, screenInput, screenSpec } from '../../../helpers/screen-builder.js';

/** entry(draft → submitted, by: performer)を持つ最小ドメイン。performer implies member。 */
function domain() {
  return specModel({
    roles: [role('anonymous'), role('member'), role('performer', undefined, ['member']), role('system')],
    aggregates: [
      aggregate({
        name: 'entry',
        entity: entitySpec('entry', [field('state', { kind: 'state', machine: 'entry' })]),
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted'],
            events: [event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['performer'] })],
          }),
        ],
      }),
    ],
  });
}

describe('S13 状態×ロールの到達', () => {
  it('入れて・弾かず・届く画面があれば通る', () => {
    const screen = screenSpec({
      name: 'workshop_detail',
      for: ['member'],
      entryPoint: true,
      actions: ['entry.submit'],
      subject: 'entry',
    });

    const findings = roleStateReachVerifier.verify(
      screenInput({ domain: domain(), screens: [screen] }),
      SCREEN_CTX,
    );
    expect(findings).toEqual([]);
  });

  it('precondition が遷移元の状態を弾く画面しか無ければ失敗する', () => {
    const screen = screenSpec({
      name: 'workshop_detail',
      for: ['member'],
      entryPoint: true,
      actions: ['entry.submit'],
      subject: 'entry',
      precondition: 'state == submitted', // draft を弾く(排他)
      onFail: 'workshop_detail',
    });

    const findings = roleStateReachVerifier.verify(
      screenInput({ domain: domain(), screens: [screen] }),
      SCREEN_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('S13');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('entry.submit');
    expect(findings[0]?.counterexample).toMatchObject({
      transition: 'entry.submit',
      state: 'draft',
      role: 'performer',
    });
  });

  it('理由を宣言すれば免除される', () => {
    const screen = screenSpec({
      name: 'workshop_detail',
      for: ['member'],
      entryPoint: true,
      actions: ['entry.submit'],
      subject: 'entry',
      precondition: 'state == submitted',
      onFail: 'workshop_detail',
    });

    const findings = roleStateReachVerifier.verify(
      screenInput({
        domain: domain(),
        screens: [screen],
        unreachableStates: [{ transition: 'entry.submit', state: 'draft', role: 'performer', reason: '未着手' }],
      }),
      SCREEN_CTX,
    );
    expect(findings).toEqual([]);
  });

  it('画面ができて満たされたのに免除宣言が残っていれば警告する(消し忘れ)', () => {
    const screen = screenSpec({
      name: 'workshop_detail',
      for: ['member'],
      entryPoint: true,
      actions: ['entry.submit'],
      subject: 'entry',
    });

    const findings = roleStateReachVerifier.verify(
      screenInput({
        domain: domain(),
        screens: [screen],
        unreachableStates: [{ transition: 'entry.submit', state: 'draft', role: 'performer', reason: '未着手' }],
      }),
      SCREEN_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('理由宣言が残っています');
  });

  it('実在しない組の免除宣言を警告する(綴り違い)', () => {
    const screen = screenSpec({
      name: 'workshop_detail',
      for: ['member'],
      entryPoint: true,
      actions: ['entry.submit'],
      subject: 'entry',
    });

    const findings = roleStateReachVerifier.verify(
      screenInput({
        domain: domain(),
        screens: [screen],
        unreachableStates: [{ transition: 'entry.submitt', state: 'draft', role: 'performer', reason: '綴り違い' }],
      }),
      SCREEN_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('存在しません');
  });

  it('画面をまだ仕様化していないリポジトリでは何も見ない', () => {
    const findings = roleStateReachVerifier.verify(
      screenInput({ domain: domain(), screensUnavailable: true }),
      SCREEN_CTX,
    );
    expect(findings).toEqual([]);
  });
});

describe('S13 画面の到達の入力が使えないとき(関係の層の gaps)', () => {
  /** precondition が遷移元の状態を弾く画面だけ = 入力が使えれば違反が 1 件出る形。 */
  const unreachable = () =>
    screenSpec({
      name: 'workshop_detail',
      for: ['member'],
      entryPoint: true,
      actions: ['entry.submit'],
      subject: 'entry',
      precondition: 'state == submitted',
      onFail: 'workshop_detail',
    });

  it('使える入力(gaps が空・省略)なら従来どおり判定する', () => {
    const input = screenInput({ domain: domain(), screens: [unreachable()] });

    expect(roleStateReachVerifier.verify(input, SCREEN_CTX)).toHaveLength(1);
    expect(roleStateReachVerifier.verify(input, { ...SCREEN_CTX, reachabilityGaps: [] })).toHaveLength(1);
  });

  it.each([
    ['未選択', { input: 'screens', state: 'unselected' }],
    ['阻害', { input: 'screens', state: 'blocked', reason: 'invalid' }],
  ] as const)('%s なら判定を出さない(使えない入力から「届かない」を導かない)', (_name, gap) => {
    const input = screenInput({ domain: domain(), screens: [unreachable()] });

    expect(roleStateReachVerifier.verify(input, { ...SCREEN_CTX, reachabilityGaps: [gap] })).toEqual([]);
  });
});
