/**
 * H8(ログアウトの操作 — 認証の要る全画面から、ログアウトが見える。ASVS V7.4.4)のユニットテスト。
 *
 * 規約網羅(auth-spec-writing.md §検証):
 *   - logout を宣言したなら control(ログアウトの操作の名前)も宣言する・無ければエラー
 *   - requires_auth の全画面が、control の遷移を持つ共有クロームを被っていれば違反なし
 *   - クロームを被っていない画面・被ったクロームの navigations に control が無い画面はエラー(画面ごと)
 *   - 画面が自分で書いた同名の遷移はクロームの部品として数えない(viaChrome の無い遷移)
 *   - requires_auth でない画面(公開面・ログイン画面)は求めない
 *   - logout を宣言しない構成・auth_spec が壊れている・画面仕様が未選択 / 阻害なら何も見ない(阻害は呼び手が行で言う)
 */

import { describe, expect, it } from 'vitest';
import { verifyLogoutControl } from '../../../../lib/auth/verifiers/h8-logout-control.js';
import type { ScreenSpecModel } from '../../../../lib/model/screen/types.js';
import { authLogout, authModel } from '../../../helpers/auth-builder.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

/** クロームから継承されたログアウトの遷移。 */
const VIA_CHROME = { on: 'signed_out', to: 'screen-login', viaChrome: 'chrome-member' } as const;

function screens(...list: ReturnType<typeof screenSpec>[]): ScreenSpecModel {
  return { available: true, screens: list, chromes: [], unexposed: [], unreachableStates: [], unseenStates: [] };
}

/** ログアウトの口を宣言した認証フロー(control に null を渡すと操作の名前を宣言しない)。 */
const flow = (control: string | null = 'signed_out') => authModel({ logout: authLogout('/api/auth/logout', control ?? undefined) }).flow;

describe('H8: ログアウトの操作', () => {
  it('認証の要る全画面が、ログアウトの遷移を持つクロームを被っていれば違反なし(要ログインでない画面は求めない)', () => {
    const model = screens(
      screenSpec({ name: 'list', requiresAuth: true, chrome: 'chrome-member', navigations: [VIA_CHROME] }),
      screenSpec({ name: 'detail', requiresAuth: true, chrome: 'chrome-member', navigations: [VIA_CHROME] }),
      screenSpec({ name: 'login', requiresAuth: false }),
      screenSpec({ name: 'public_page', requiresAuth: false, chrome: 'chrome-public' }),
    );

    expect(verifyLogoutControl(flow(), loadedInput(model))).toEqual([]);
  });

  it('logout を宣言したのに control が無ければエラー(検査が空振りしないよう、操作の名前を宣言させる)', () => {
    const findings = verifyLogoutControl(flow(null), loadedInput(screens()));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'H8', severity: 'error' });
    expect(findings[0]?.message).toContain('control(ログアウトの操作の名前)がありません');
    expect(findings[0]?.suggestion).toContain('V7.4.4');
  });

  it('クロームを被っていない画面はエラー(画面ごと。クロームの有無を名指す)', () => {
    const model = screens(
      screenSpec({ name: 'orphan', requiresAuth: true }),
      screenSpec({ name: 'fine', requiresAuth: true, chrome: 'chrome-member', navigations: [VIA_CHROME] }),
    );

    const findings = verifyLogoutControl(flow(), loadedInput(model));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('画面 orphan は requires_auth ですが、ログアウトの操作(signed_out)を持つ共有クロームを被っていません(chrome がありません)');
    expect(findings[0]?.counterexample).toEqual({ screen: 'orphan', control: 'signed_out', chrome: '' });
    expect(findings[0]?.location.file).toContain('orphan');
  });

  it('被ったクロームの navigations に control が無ければエラー(被っているクロームを名指す)', () => {
    const model = screens(
      screenSpec({ name: 'list', requiresAuth: true, chrome: 'chrome-bare', navigations: [{ on: 'home_link', to: 'screen-home', viaChrome: 'chrome-bare' }] }),
    );

    const findings = verifyLogoutControl(flow(), loadedInput(model));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('被っているクローム chrome-bare の navigations に signed_out がありません');
    expect(findings[0]?.counterexample).toMatchObject({ chrome: 'chrome-bare' });
  });

  it('画面が自分で書いた同名の遷移は数えない(クロームの部品としてログアウトがあることを求める)', () => {
    const model = screens(screenSpec({ name: 'selfmade', requiresAuth: true, chrome: 'chrome-bare', navigations: [{ on: 'signed_out', to: 'screen-login' }] }));

    expect(verifyLogoutControl(flow(), loadedInput(model))).toHaveLength(1);
  });

  it('control の名前が違う遷移はログアウトではない(別の名前の遷移は数えない)', () => {
    const model = screens(screenSpec({ name: 'list', requiresAuth: true, chrome: 'chrome-member', navigations: [{ ...VIA_CHROME, on: 'logout_link' }] }));

    expect(verifyLogoutControl(flow('signed_out'), loadedInput(model))).toHaveLength(1);
    expect(verifyLogoutControl(flow('logout_link'), loadedInput(model))).toEqual([]);
  });

  it('logout を宣言しない構成・auth_spec が壊れている(null)なら何も見ない', () => {
    const model = screens(screenSpec({ name: 'orphan', requiresAuth: true }));

    expect(verifyLogoutControl(authModel({}).flow, loadedInput(model))).toEqual([]);
    expect(verifyLogoutControl(null, loadedInput(model))).toEqual([]);
  });

  it('画面仕様が未選択・読めない阻害なら画面は見ない(control の宣言漏れは画面に依らず言う)', () => {
    expect(verifyLogoutControl(flow(), UNSELECTED)).toEqual([]);
    expect(verifyLogoutControl(flow(), blockedInput('missing'))).toEqual([]);
    expect(verifyLogoutControl(flow(null), UNSELECTED)).toHaveLength(1);
  });

  it('画面仕様が阻害でも読めた部分があれば画面を見ない(落とした画面が被るクロームを疑わない)', () => {
    const blocked = { state: 'blocked' as const, reason: 'invalid' as const, findings: [], partial: screens(screenSpec({ name: 'orphan', requiresAuth: true })) };

    expect(verifyLogoutControl(flow(), blocked)).toEqual([]);
  });
});
