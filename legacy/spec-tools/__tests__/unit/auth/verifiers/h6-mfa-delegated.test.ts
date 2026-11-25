/**
 * H6(多要素認証の要求)のうち、`mfa: { delegated }`(IdP に任せる)の表。
 *
 * mfa の 4 つの形(アプリ側の要求 / exempt / delegated・根拠なし / delegated・根拠あり)のうち、根拠ありは parse が止める(未対応)ので
 * H6 には来ない。ここでは:
 *   - 根拠なしで任せる → 毎回 warning(受け入れた危険。文言は「IdP に任せた」)・W5 へ渡す宣言と同じ
 *   - provider が providers に無い・local_only だけ・IdP でない方式(メール・電話) → error(warning も添える)
 *   - 本番の providers に任せる先以外の方式(メールのパスワード・別の IdP)がある → error(点検 4 回目 B4-1。ほかの方式で入る人には要素が無い)。
 *     ほかの方式が local_only(開発・テストだけ)なら通る
 *   - 要求・exempt の文言は変わらない(対照)
 */

import { describe, expect, it } from 'vitest';
import { mfaAcceptances, verifyMfaRequirement } from '../../../../lib/auth/verifiers/h6-mfa-requirement.js';
import type { AuthMfaDecl } from '../../../../lib/model/auth/mfa.js';
import { authModel } from '../../../helpers/auth-builder.js';
import { loc } from '../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { specModel } from '../../../helpers/model-builder-v8plus.js';
import { UNSELECTED } from '../../../helpers/verify-inputs.js';

function delegated(provider: string, reason = 'IdP に任せる'): AuthMfaDecl {
  return { kind: 'delegated', provider, evidence: 'none', reason, location: loc('docs/specs/backend/auth.md', 'mfa') };
}

function run(mfa: AuthMfaDecl, init: Parameters<typeof authModel>[0] = {}): ReturnType<typeof verifyMfaRequirement> {
  const auth = authModel({ mfa, ...init });
  return verifyMfaRequirement({ auth, domain: specModel({}), screens: UNSELECTED, repoRoot: '/nonexistent', roots: TEST_ROOTS, layout: TEST_LAYOUT, actions: UNSELECTED });
}

describe('H6: IdP に任せる宣言', () => {
  it('実在する外部の IdP に根拠なしで任せる → warning 1 件(受け入れた危険)。違反は無い', () => {
    const mfa = delegated('discord');
    const findings = run(mfa, { providers: ['discord'] });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'H6', severity: 'warning', acceptance: { reason: 'IdP に任せる', location: { pointer: 'mfa' } } });
    expect(findings[0]?.message).toContain('多要素認証を IdP(discord)に任せています(根拠: なし。理由: IdP に任せる)');
    expect(findings[0]?.message).not.toContain('外しています');
    expect(mfaAcceptances(authModel({ mfa, providers: ['discord'] }).flow)).toEqual([findings[0]?.acceptance]);
  });

  it('provider が providers に無い → error(警告も名指す)', () => {
    const findings = run(delegated('google'), { providers: ['discord'] });

    expect(findings.map((finding) => finding.severity)).toEqual(['error', 'warning']);
    expect(findings[0]?.message).toContain('mfa.delegated.provider google は providers に書かれていません');
  });

  it('provider が local_only の方式だけ → error', () => {
    const findings = run(delegated('discord'), { providers: ['google'], localOnly: [{ method: 'discord', reason: '開発だけ' }] });

    expect(findings.map((finding) => finding.severity)).toEqual(['error', 'warning']);
    expect(findings[0]?.message).toContain('local_only の方式で、本番では開けません');
  });

  it('provider がメール・電話の外部の IdP でない方式 → error', () => {
    for (const method of ['email', 'phone']) {
      const findings = run(delegated(method), { providers: [method] });
      expect(findings.map((finding) => finding.severity), method).toEqual(['error', 'warning']);
      expect(findings[0]?.message, method).toContain('外部の IdP ではありません');
    }
  });

  it('警告の文は、任せる先以外の方式で入る人には要素が無いことを言う', () => {
    const findings = run(delegated('discord'), { providers: ['discord'] });

    expect(findings[0]?.message).toContain('任せる先(discord)以外の方式で入る人には要素が 1 つも掛かりません');
  });

  /** [題, providers, local_only, 期待する重さの並び, error の文に出る方式]。 */
  const OTHERS: readonly (readonly [string, readonly string[], readonly string[], readonly string[], string | null])[] = [
    ['任せる IdP 1 つだけ(境界: 本番の方式がちょうど 1 つ)', ['discord'], [], ['warning'], null],
    ['ほかの方式が local_only(開発・テストだけ)', ['discord'], ['email'], ['warning'], null],
    ['本番の方式にメール(パスワード)が並ぶ', ['discord', 'email'], [], ['error', 'warning'], 'email'],
    ['本番の方式に電話が並ぶ', ['discord', 'phone'], [], ['error', 'warning'], 'phone'],
    ['本番の方式に別の IdP が並ぶ', ['discord', 'google'], [], ['error', 'warning'], 'google'],
    ['任せる先が後ろでも、前の別の方式を名指す', ['email', 'discord'], [], ['error', 'warning'], 'email'],
    ['ほかの方式が 2 つ', ['discord', 'google', 'email'], [], ['error', 'warning'], 'google / email'],
  ];

  it.each(OTHERS)('%s', (_title, providers, localOnly, severities, named) => {
    const findings = run(delegated('discord'), { providers, localOnly: localOnly.map((method) => ({ method, reason: '開発だけ' })) });

    expect(findings.map((finding) => finding.severity)).toEqual(severities);
    if (named === null) {
      expect(findings.filter((finding) => finding.message.includes('本番の providers に任せる先以外の方式'))).toEqual([]);
      return;
    }
    expect(findings[0]?.message).toContain(`本番の providers に任せる先以外の方式(${named})があります`);
    expect(findings[0]?.message).toContain('IdP の要素もアプリの要素も掛からず');
    expect(findings[0]?.suggestion).toContain('require');
  });
});
