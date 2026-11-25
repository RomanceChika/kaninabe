/**
 * S9(テストの網羅)の規約網羅テスト。
 *
 * 対象の要求: screen-spec-writing.md「全 screen_spec が test_cases を 1 件以上持ち、
 * requires_auth: true の画面は入場の関門を確かめるケース(covers に forbidden)を持つ」。
 * S8 が「書いた宣言が実在するか」を見るのに対し、こちらは「書かなかったこと」を見る。
 */

import { describe, expect, it } from 'vitest';
import { testPresenceVerifier } from '../../../../lib/screen/verifiers/s9-test-presence.js';
import { testCase } from '../../../helpers/trace-builder.js';
import { FOREIGN_LAYOUT } from '../../../helpers/platform.js';
import { SCREEN_CTX, screenInput, screenSpec } from '../../../helpers/screen-builder.js';

const SPEC_FILE = 'docs/specs/frontend/screens/workshop/workshop_list.md';

/** 指定した意味クラスを覆うテストケース 1 件。 */
function tc(id: string, covers: readonly ('success' | 'forbidden' | 'other')[]) {
  return testCase({
    id,
    implementation: 'app/src/app/__screens__/workshop-list.test.tsx::宣言したスロット部品がすべて描画される',
    covers,
    specIds: ['screen-workshop-list'],
    file: SPEC_FILE,
  });
}

describe('S9 テストの網羅', () => {
  it('test_cases を持つ画面は通る', () => {
    const input = screenInput({
      screens: [screenSpec({ name: 'home', testCases: [tc('TC-SCREEN-HOME-001', ['success'])] })],
    });

    expect(testPresenceVerifier.verify(input, SCREEN_CTX)).toEqual([]);
  });

  it('test_cases が 1 件も無ければ失敗する', () => {
    const findings = testPresenceVerifier.verify(
      screenInput({ screens: [screenSpec({ name: 'home' })] }),
      SCREEN_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('S9');
    expect(findings[0]?.message).toContain('home に test_cases がありません');
  });

  it('対処にテストの置き場（画面名から導いたファイル）を示す', () => {
    const findings = testPresenceVerifier.verify(
      screenInput({ screens: [screenSpec({ name: 'workshop_list' })] }),
      SCREEN_CTX,
    );

    expect(findings[0]?.suggestion).toContain('app/src/app/__screens__/workshop-list.test.tsx');
  });

  it('requires_auth の画面は入場の関門のケース（covers: forbidden）が要る', () => {
    const screen = screenSpec({
      name: 'workshop_list',
      requiresAuth: true,
      testCases: [tc('TC-SCREEN-WORKSHOP_LIST-001', ['success'])],
    });

    const findings = testPresenceVerifier.verify(screenInput({ screens: [screen] }), SCREEN_CTX);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('入場の関門を確かめるテストがありません');
  });

  it('requires_auth の画面が関門のケースを持てば通る', () => {
    const screen = screenSpec({
      name: 'workshop_list',
      requiresAuth: true,
      testCases: [
        tc('TC-SCREEN-WORKSHOP_LIST-001', ['success']),
        tc('TC-SCREEN-WORKSHOP_LIST-002', ['forbidden']),
      ],
    });

    expect(testPresenceVerifier.verify(screenInput({ screens: [screen] }), SCREEN_CTX)).toEqual([]);
  });

  it('requires_auth でない画面に関門のケースは求めない', () => {
    const screen = screenSpec({
      name: 'home',
      requiresAuth: false,
      testCases: [tc('TC-SCREEN-HOME-001', ['other'])],
    });

    expect(testPresenceVerifier.verify(screenInput({ screens: [screen] }), SCREEN_CTX)).toEqual([]);
  });

  it('test_cases が空の要ログイン画面には指摘を 1 本だけ出す', () => {
    const screen = screenSpec({ name: 'workshop_list', requiresAuth: true });

    const findings = testPresenceVerifier.verify(screenInput({ screens: [screen] }), SCREEN_CTX);

    // 1 つの書き忘れに 2 つのエラーを出さない（関門のケースが無いのは自明なので重ねない）。
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('test_cases がありません');
  });
});

describe('S9 テストの置き場は置き場の配置から読む(Next.js と綴りの重ならない架空の配置)', () => {
  it('道案内に示す screenTest の置き場は配置の画面テストの役割で、Next.js の綴りが出ない', () => {
    const foreign = { ...SCREEN_CTX, layout: FOREIGN_LAYOUT, roots: { ...SCREEN_CTX.roots, app: 'app' } };

    const findings = testPresenceVerifier.verify(screenInput({ screens: [screenSpec({ name: 'workshop_list' })] }), foreign);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestion).toContain('app/server_code/ui/checks/workshop-list.test.tsx に screenTest を書き');
    expect(findings[0]?.suggestion).not.toMatch(/__screens__|src\/app/);
  });

  it('実装の木を宣言していない製品では置き場を示さず、決まっていないと言う', () => {
    const noApp = { ...SCREEN_CTX, roots: { ...SCREEN_CTX.roots, app: null } };

    const findings = testPresenceVerifier.verify(screenInput({ screens: [screenSpec({ name: 'workshop_list' })] }), noApp);

    expect(findings[0]?.suggestion).toContain('画面テストの置き場(実装の木の宣言が無いので示せない)');
  });

  it('実装の木はあるのに配置が置き場を決められない(screen-test の宣言が無い)ときは、「実装の木の宣言が無い」とは別の理由で示せないと言う', () => {
    const undecided = { ...SCREEN_CTX, layout: {}, roots: { ...SCREEN_CTX.roots, app: 'app' } };

    const findings = testPresenceVerifier.verify(screenInput({ screens: [screenSpec({ name: 'workshop_list' })] }), undecided);

    expect(findings[0]?.suggestion).toContain('画面テストの置き場(置き場の配置に screen-test の置き場が無い・ファイル名がキーの形に合わない・基準の役割が辿れないので示せない)');
    expect(findings[0]?.suggestion).not.toContain('実装の木の宣言が無い');
  });
});
