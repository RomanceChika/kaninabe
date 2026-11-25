/**
 * S21(プラットフォーム操作の UI 到達の網羅 — S10 の兄弟)の規約網羅テスト。
 *
 *   - 人間が起こす全操作が、どれかの画面の platform_ops(重ね表示を含む)に現れる
 *   - 出さない操作は README の unexposed_platform_ops に理由つきで宣言する(免除)
 *   - system ロールの操作は対象外
 *   - 用済みの免除(画面ができた・実在しない操作)は warning
 *   - 画面が未仕様・auth_spec が阻害・宣言の無い製品は何も言わない
 */

import { describe, expect, it } from 'vitest';
import { platformOpExposureVerifier } from '../../../../lib/screen/verifiers/s21-platform-op-exposure.js';
import type { ScreenInput } from '../../../../lib/model/screen/types.js';
import { authModel, platformOp, platformOpsSection } from '../../../helpers/auth-builder.js';
import { role, specModel } from '../../../helpers/model-builder-v8plus.js';
import { SCREEN_CTX, screenInput, screenSpec } from '../../../helpers/screen-builder.js';

const DOMAIN = specModel({ aggregates: [], roles: [role('anonymous'), role('member'), role('staff', undefined, ['member']), role('system')] });
const STAFF = { kind: 'role', role: 'staff', activeMember: true } as const;

const AUTH = authModel({
  platformOps: platformOpsSection([
    platformOp('session.list_mine', { kind: 'read' }),
    platformOp('session.end_every', { actor: STAFF, confirm: true }),
    platformOp('session.reap', { actor: { kind: 'role', role: 'system', activeMember: false } }),
  ]),
});

/** 免除の宣言(README の unexposed_platform_ops 相当)をモデルへ足す。 */
function withExcuses(input: ScreenInput, excuses: readonly { op: string; reason: string }[]): ScreenInput {
  return {
    ...input,
    screens: { ...input.screens, unexposedPlatformOps: excuses.map((excuse) => ({ ...excuse, location: { file: 'README.md', pointer: `unexposed_platform_ops.${excuse.op}` } })) },
  };
}

function run(screens: readonly ReturnType<typeof screenSpec>[], excuses: readonly { op: string; reason: string }[] = [], init: Parameters<typeof screenInput>[0] = {}) {
  return platformOpExposureVerifier.verify(withExcuses(screenInput({ domain: DOMAIN, screens, auth: AUTH, ...init }), excuses), SCREEN_CTX);
}

describe('S21 プラットフォーム操作の UI 到達', () => {
  it('人間の操作がすべてどこかの画面に居れば通る(重ね表示の platform_ops も数える・system の操作は対象外)', () => {
    const screens = [
      screenSpec({ name: 'sessions', platformOps: ['session.list_mine'] }),
      screenSpec({ name: 'admin', overlays: [{ id: 'confirm', openedBy: 'bar', platformOps: ['session.end_every'] }] }),
    ];

    expect(run(screens)).toEqual([]);
  });

  it('どの画面にも居ない人間の操作はエラー(免除の書き方まで案内する)', () => {
    const findings = run([screenSpec({ name: 'sessions', platformOps: ['session.list_mine'] })]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'S21', severity: 'error', counterexample: { op: 'session.end_every' } });
    expect(findings[0]?.message).toContain('プラットフォーム操作 session.end_every は人間が起こせますが、どの画面の platform_ops にも現れません');
    expect(findings[0]?.suggestion).toContain('unexposed_platform_ops');
    expect(findings[0]?.location.file).toBe('docs/specs/backend/auth.md');
  });

  it('理由つきの免除があれば通る', () => {
    const findings = run([screenSpec({ name: 'sessions', platformOps: ['session.list_mine'] })], [{ op: 'session.end_every', reason: '管理画面が未着手のため' }]);

    expect(findings).toEqual([]);
  });

  it('画面ができたのに残った免除・実在しない操作の免除は warning', () => {
    const screens = [screenSpec({ name: 'sessions', platformOps: ['session.list_mine', 'session.end_every'] })];
    const findings = run(screens, [
      { op: 'session.end_every', reason: '古い' },
      { op: 'session.ghost', reason: '綴り違い' },
    ]);

    expect(findings.map((finding) => finding.severity)).toEqual(['warning', 'warning']);
    expect(findings[0]?.message).toContain('session.end_every は画面の platform_ops にあるのに unexposed_platform_ops の理由宣言が残っています');
    expect(findings[1]?.message).toContain('session.ghost は auth_spec の platform_ops に存在しない操作です');
  });

  it('画面を仕様化していない・auth_spec が無い / 阻害・宣言の無い製品は何も言わない', () => {
    expect(run([], [], { screensUnavailable: true })).toEqual([]);
    expect(run([screenSpec({ name: 'x' })], [], { auth: { available: false, flow: null } })).toEqual([]);
    expect(run([screenSpec({ name: 'x' })], [], { auth: authModel({}) })).toEqual([]);
    const blocked = { ...SCREEN_CTX, reachabilityGaps: [{ input: 'auth', reason: 'invalid' }] } as unknown as typeof SCREEN_CTX;
    expect(platformOpExposureVerifier.verify(screenInput({ domain: DOMAIN, screens: [], auth: AUTH }), blocked)).toEqual([]);
  });
});
