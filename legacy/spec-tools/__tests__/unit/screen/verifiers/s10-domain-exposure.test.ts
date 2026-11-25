/**
 * S10(UI 到達の網羅)の規約網羅テスト。
 *
 * 対象の要求: screen-spec-writing.md「人間ロールが実行できる全ドメイン操作が、いずれかの
 * screen_spec の actions に現れる(現れないものは screens/README.md の unexposed に理由を書く)」。
 * A4 が「入口(action_spec)があるか」を見るのに対し、こちらは「その入口に人間がたどり着けるか」を見る。
 */

import { describe, expect, it } from 'vitest';
import { domainExposureVerifier } from '../../../../lib/screen/verifiers/s10-domain-exposure.js';
import {
  accessSpec,
  aggregate,
  createRule,
  deleteRule,
  event,
  machine,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { SCREEN_CTX, screenInput, screenSpec } from '../../../helpers/screen-builder.js';

/** submit(performer)・close(system)を持つドメイン。 */
function domain() {
  return specModel({
    aggregates: [
      aggregate({
        name: 'entry',
        stateMachines: [
          machine({
            machine: 'entry',
            states: ['draft', 'submitted', 'closed'],
            events: [
              event({ id: 'submit', from: ['draft'], to: 'submitted', by: ['performer'] }),
              event({ id: 'close', from: ['submitted'], to: 'closed', by: ['system'] }),
            ],
          }),
        ],
      }),
    ],
  });
}

/**
 * 集約ディレクトリ名(`program`)と entity 名(`program_item`)が食い違うドメイン。
 * 予約 ID はどちらの名前でも書けるので、正規化しないと集合演算がずれる。
 */
function aliasDomain() {
  return specModel({
    aggregates: [
      aggregate({
        name: 'program',
        access: accessSpec('program_item', { creates: [createRule('organizer')] }),
      }),
    ],
  });
}

/** access_spec の予約 ID だけを持つドメイン(遷移は持たない)。 */
function accessOnlyDomain(init: Parameters<typeof accessSpec>[1]) {
  return specModel({ aggregates: [aggregate({ name: 'entry', access: accessSpec('entry', init) })] });
}

describe('S10 UI 到達の網羅', () => {
  it('操作を発火する画面があれば通る', () => {
    const input = screenInput({
      domain: domain(),
      screens: [screenSpec({ name: 'workshop_detail', actions: ['entry.submit'] })],
    });

    expect(domainExposureVerifier.verify(input, SCREEN_CTX)).toEqual([]);
  });

  it('どの画面の actions にも無く理由宣言も無ければ失敗する', () => {
    const findings = domainExposureVerifier.verify(
      screenInput({ domain: domain(), screens: [screenSpec({ name: 'home' })] }),
      SCREEN_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('S10');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('entry.submit');
    expect(findings[0]?.counterexample).toMatchObject({ event: 'entry.submit', by: 'performer' });
  });

  it('対処に「画面に足す」と「理由を書く」の 2 つを示す', () => {
    const findings = domainExposureVerifier.verify(
      screenInput({ domain: domain(), screens: [screenSpec({ name: 'home' })] }),
      SCREEN_CTX,
    );

    expect(findings[0]?.suggestion).toContain('actions: - entry.submit');
    expect(findings[0]?.suggestion).toContain('unexposed: - event: entry.submit');
  });

  it('理由を宣言すれば免除される', () => {
    const input = screenInput({
      domain: domain(),
      screens: [screenSpec({ name: 'home' })],
      unexposed: [{ event: 'entry.submit', reason: '世話役画面が未着手' }],
    });

    expect(domainExposureVerifier.verify(input, SCREEN_CTX)).toEqual([]);
  });

  it('重ね表示（overlay）の actions も到達に数える', () => {
    const screen = screenSpec({
      name: 'workshop_detail',
      overlays: [{ id: 'withdraw_dialog', actions: ['entry.submit'] }],
    });

    expect(
      domainExposureVerifier.verify(screenInput({ domain: domain(), screens: [screen] }), SCREEN_CTX),
    ).toEqual([]);
  });

  it('system ロールだけの操作は対象にしない', () => {
    const findings = domainExposureVerifier.verify(
      screenInput({ domain: domain(), screens: [screenSpec({ name: 'home' })] }),
      SCREEN_CTX,
    );

    expect(findings.some((finding) => finding.message.includes('entry.close'))).toBe(false);
  });

  it('作成・削除・編集の予約 ID も母集合に入る（編集は A4 との差）', () => {
    const model = accessOnlyDomain({
      creates: [createRule('member')],
      deletes: [deleteRule('performer')],
      writes: [writeRule('performer', ['title'])],
    });

    const findings = domainExposureVerifier.verify(
      screenInput({ domain: model, screens: [screenSpec({ name: 'home' })] }),
      SCREEN_CTX,
    );

    expect(findings.map((finding) => finding.counterexample?.['event'])).toEqual([
      'entry.create',
      'entry.delete',
      'entry.update',
    ]);
  });

  it('同じロールの規則が複数あってもロール名を重複表示しない', () => {
    const model = accessOnlyDomain({
      writes: [writeRule('performer', ['title']), writeRule('performer', ['note'])],
    });

    const findings = domainExposureVerifier.verify(
      screenInput({ domain: model, screens: [screenSpec({ name: 'home' })] }),
      SCREEN_CTX,
    );

    expect(findings[0]?.message).toContain('人間ロール(performer)が編集できます');
  });

  it('画面が発火しているのに理由宣言が残っていれば警告する（消し忘れ）', () => {
    const input = screenInput({
      domain: domain(),
      screens: [screenSpec({ name: 'workshop_detail', actions: ['entry.submit'] })],
      unexposed: [{ event: 'entry.submit', reason: '世話役画面が未着手' }],
    });

    const findings = domainExposureVerifier.verify(input, SCREEN_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('理由宣言が残っています');
  });

  it('実在しない操作の理由宣言を警告する（綴り違い）', () => {
    const input = screenInput({
      domain: domain(),
      screens: [screenSpec({ name: 'workshop_detail', actions: ['entry.submit'] })],
      unexposed: [{ event: 'entry.submitt', reason: '綴り違い' }],
    });

    const findings = domainExposureVerifier.verify(input, SCREEN_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('存在しない操作です');
    expect(findings[0]?.suggestion).toContain('entry.submit');
  });

  it('別名（集約名）で書かれた actions も到達に数える', () => {
    // program.create と program_item.create は同じ操作。S2 / S4 はどちらも接地として受け入れる。
    const screen = screenSpec({ name: 'program_edit', actions: ['program.create'] });

    expect(
      domainExposureVerifier.verify(screenInput({ domain: aliasDomain(), screens: [screen] }), SCREEN_CTX),
    ).toEqual([]);
  });

  it('別名で書かれた免除宣言も効く（存在しない操作と誤警告しない）', () => {
    const input = screenInput({
      domain: aliasDomain(),
      screens: [screenSpec({ name: 'home' })],
      unexposed: [{ event: 'program.create', reason: 'プログラム編成画面が未着手' }],
    });

    expect(domainExposureVerifier.verify(input, SCREEN_CTX)).toEqual([]);
  });

  it('別名の免除宣言が用済みになったら、書かれたままの ID で消し方を示す', () => {
    const input = screenInput({
      domain: aliasDomain(),
      screens: [screenSpec({ name: 'program_edit', actions: ['program_item.create'] })],
      unexposed: [{ event: 'program.create', reason: 'プログラム編成画面が未着手' }],
    });

    const findings = domainExposureVerifier.verify(input, SCREEN_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    // README に書かれているのは program.create のほうなので、そちらで示す。
    expect(findings[0]?.suggestion).toContain('program.create の項目を削除する');
  });

  it('画面をまだ仕様化していないリポジトリでは何も見ない', () => {
    const input = screenInput({ domain: domain(), screensUnavailable: true });

    expect(domainExposureVerifier.verify(input, SCREEN_CTX)).toEqual([]);
  });
});
