/**
 * S16(保存点の宣言)の規約網羅テスト。
 *
 * 対象の要求: screen-spec-writing.md「`usecases` に書いた保存点が usecase_spec に実在し、
 * その各手順の操作がこの画面の `actions` にも並んでいて、そのユースケースの `start` から
 * この画面へ辿れる」。**保存点を宣言した画面は、その手順を個別の操作としても持ち続けてよい**。
 */

import { describe, expect, it } from 'vitest';
import { usecaseExposureVerifier } from '../../../../lib/screen/verifiers/s16-usecase-exposure.js';
import { aggregate, entitySpec, event, field, machine, role, specModel } from '../../../helpers/model-builder-v8plus.js';
import { screenInput, screenSpec, SCREEN_CTX } from '../../../helpers/screen-builder.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import type { UsecaseSpecModel } from '../../../../lib/model/usecase/types.js';

/** entry(draft → submitted、by: member)を持つ最小ドメイン。 */
function domain() {
  return specModel({
    roles: [role('anonymous'), role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'entry',
        entity: entitySpec('entry', [field('state', { kind: 'state', machine: 'entry' })]),
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted'],
            events: [event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['member'] })],
          }),
        ],
      }),
    ],
  });
}

/** entry.create → entry.submit の 1 保存点(起点はこの画面自身)。 */
function usecases(start = 'screen-workshop-detail'): UsecaseSpecModel {
  return {
    available: true,
    usecases: [
      usecaseSpec({
        name: 'entry_self',
        start,
        saves: [
          usecaseSave('register', [usecaseStep('entry.create'), usecaseStep('entry.submit')], {
            migration: '20260909000050_usecase_entry_self_register.sql',
            name: 'entry_self',
          }),
        ],
      }),
    ],
  };
}

/** 保存点を宣言した画面(手順を個別の操作としても持つ)。 */
function detail(actions: readonly string[] = ['entry.create', 'entry.submit']) {
  return screenSpec({
    name: 'workshop_detail',
    for: ['member'],
    entryPoint: true,
    actions: [...actions],
    usecases: ['entry_self.register'],
  });
}

describe('S16 保存点の宣言', () => {
  it('手順が全部 actions にあり、起点から辿れる画面なら通る', () => {
    const findings = usecaseExposureVerifier.verify(
      screenInput({ domain: domain(), screens: [detail()], usecases: usecases() }),
      SCREEN_CTX,
    );

    expect(findings).toEqual([]);
  });

  it('usecase_spec がまだ無い環境では何も見ない', () => {
    const findings = usecaseExposureVerifier.verify(
      screenInput({ domain: domain(), screens: [detail()] }),
      SCREEN_CTX,
    );

    expect(findings).toEqual([]);
  });

  it('実在しない保存点を宣言すると違反になる', () => {
    const screen = screenSpec({
      name: 'workshop_detail',
      for: ['member'],
      entryPoint: true,
      actions: ['entry.create', 'entry.submit'],
      usecases: ['entry_self.unknown'],
    });

    const findings = usecaseExposureVerifier.verify(
      screenInput({ domain: domain(), screens: [screen], usecases: usecases() }),
      SCREEN_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('S16');
    expect(findings[0]?.counterexample).toMatchObject({ usecase: 'entry_self.unknown' });
  });

  it('手順の操作を actions に持たない画面は、その手順ごとに違反になる', () => {
    const findings = usecaseExposureVerifier.verify(
      screenInput({ domain: domain(), screens: [detail(['entry.create'])], usecases: usecases() }),
      SCREEN_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ step: 'entry.submit' });
  });

  it('起点から辿れない画面が宣言すると違反になる', () => {
    const other = screenSpec({ name: 'elsewhere', for: ['member'], entryPoint: true });

    const findings = usecaseExposureVerifier.verify(
      screenInput({
        domain: domain(),
        screens: [detail(), other],
        usecases: usecases('screen-elsewhere'),
      }),
      SCREEN_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ start: 'screen-elsewhere' });
  });
});

describe('S16 画面の到達の入力が使えないとき(関係の層の gaps)', () => {
  /** 起点から辿れない画面が宣言する = 入力が使えれば違反が 1 件出る形。 */
  const orphan = () =>
    screenInput({
      domain: domain(),
      screens: [detail(), screenSpec({ name: 'elsewhere', for: ['member'], entryPoint: true })],
      usecases: usecases('screen-elsewhere'),
    });

  it('使える入力(gaps が空・省略)なら従来どおり判定する', () => {
    expect(usecaseExposureVerifier.verify(orphan(), SCREEN_CTX)).toHaveLength(1);
    expect(usecaseExposureVerifier.verify(orphan(), { ...SCREEN_CTX, reachabilityGaps: [] })).toHaveLength(1);
  });

  it.each([
    ['未選択', { input: 'screens', state: 'unselected' }],
    ['阻害', { input: 'screens', state: 'blocked', reason: 'missing' }],
  ] as const)('%s なら判定を出さない', (_name, gap) => {
    expect(usecaseExposureVerifier.verify(orphan(), { ...SCREEN_CTX, reachabilityGaps: [gap] })).toEqual([]);
  });
});

describe('S16 ユースケース仕様が阻害のとき(入力の状態の保留)', () => {
  const unknownSave = () =>
    screenInput({
      domain: domain(),
      screens: [screenSpec({ name: 'workshop_detail', for: ['member'], entryPoint: true, actions: ['entry.create', 'entry.submit'], usecases: ['entry_self.unknown'] })],
      usecases: usecases(),
    });

  it('読めていれば実在しない保存点を言い、阻害なら言わない(落とした保存点を「ありません」と言わない)', () => {
    expect(usecaseExposureVerifier.verify(unknownSave(), SCREEN_CTX)).toHaveLength(1);
    expect(usecaseExposureVerifier.verify(unknownSave(), { ...SCREEN_CTX, blockedInputs: ['usecases'] })).toEqual([]);
  });

  it('読み取りクエリの阻害は S16 に関わらない(ユースケース仕様の阻害だけに依る)', () => {
    expect(usecaseExposureVerifier.verify(unknownSave(), { ...SCREEN_CTX, blockedInputs: ['queries'] })).toHaveLength(1);
  });
});

describe('S16 ユースケース仕様が阻害でも、読めた保存点の判定は出す(止めるのは「保存点は usecase_spec にありません」だけ)', () => {
  it('読めた保存点の手順を画面が操作として持たないこと・起点から辿れないことは、阻害でも言う', () => {
    const blocked = { ...SCREEN_CTX, blockedInputs: ['usecases'] } as const;
    const missingStep = screenInput({ domain: domain(), screens: [detail(['entry.create'])], usecases: usecases() });
    const orphan = screenInput({
      domain: domain(),
      screens: [detail(), screenSpec({ name: 'elsewhere', for: ['member'], entryPoint: true })],
      usecases: usecases('screen-elsewhere'),
    });

    expect(usecaseExposureVerifier.verify(missingStep, blocked).map((finding) => finding.counterexample)).toEqual([expect.objectContaining({ step: 'entry.submit' })]);
    expect(usecaseExposureVerifier.verify(orphan, blocked).map((finding) => finding.counterexample)).toEqual([expect.objectContaining({ start: 'screen-elsewhere' })]);
  });
});
