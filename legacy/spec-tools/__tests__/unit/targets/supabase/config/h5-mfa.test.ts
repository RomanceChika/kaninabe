/**
 * H5 の多要素認証の要素の突合(Supabase の後段)のユニットテスト。
 *
 * 規約網羅(auth-spec-writing.md §`mfa`・§検証 H5):
 *   - 要求するなら、要素(TOTP・電話・WebAuthn)が 1 つ以上、登録も確認も有効であること(既定はどれも無効)
 *   - 片方だけ有効・読めない値はエラー
 *   - 外す宣言・読めなかった宣言なら見ない
 *   - deploy 先は `auth.mfa.*` のスイッチを自分で書いたときだけ見る
 */

import { describe, expect, it } from 'vitest';
import type { AuthConfigInput } from '../../../../../lib/auth/platform-config.js';
import type { AuthMfaDecl } from '../../../../../lib/model/auth/mfa.js';
import { authConfigFindings } from '../../../../../lib/targets/supabase/config/h5-auth-config.js';
import { stackConfigPath } from '../../../../../lib/model/product/paths.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

const CONFIG_FILE = stackConfigPath(TEST_ROOTS);

const REQUIRE: AuthMfaDecl = { kind: 'require', scope: { kind: 'all' }, to: 'screen-mfa', implementation: 'a.ts::f', summary: 's', location: { file: 'auth.md', pointer: 'mfa' } };

function input(mfa: AuthMfaDecl | null = REQUIRE): AuthConfigInput {
  return { providers: [], localOnly: [], ...(mfa === null ? {} : { mfa }), repoRoot: '/repo', roots: TEST_ROOTS };
}

/** 多要素認証に関わる違反の文(サインインの口・公開スキーマの指摘は除く)。 */
function messages(lines: readonly string[], mfa: AuthMfaDecl | null = REQUIRE): string[] {
  return authConfigFindings(lines.join('\n'), CONFIG_FILE, input(mfa))
    .findings.map((finding) => finding.message)
    .filter((message) => message.includes('auth.mfa'));
}

describe('H5: 多要素認証の要素', () => {
  it('要素が 1 つ以上、登録も確認も有効なら通る', () => {
    expect(messages(['[auth.mfa.totp]', 'enroll_enabled = true', 'verify_enabled = true'])).toEqual([]);
    expect(messages(['[auth.mfa.totp]', 'enroll_enabled = false', '[auth.mfa.web_authn]', 'enroll_enabled = true', 'verify_enabled = true'])).toEqual([]);
  });

  it('何も書いていない(既定はどれも無効)・片方だけ有効ならエラー', () => {
    expect(messages([])).toEqual([expect.stringContaining('がどれも登録と確認の両方を有効にしていません')]);
    expect(messages(['[auth.mfa.totp]', 'enroll_enabled = true', 'verify_enabled = false'])).toHaveLength(1);
  });

  it('読めない値はエラー', () => {
    expect(messages(['[auth.mfa.totp]', 'enroll_enabled = "yes"', 'verify_enabled = true'])).toEqual([expect.stringContaining('[auth.mfa.totp] enroll_enabled を読めません')]);
  });

  it('外す宣言・読めなかった宣言なら見ない', () => {
    expect(messages([], { kind: 'exempt', reason: '理由', location: { file: 'auth.md', pointer: 'mfa' } })).toEqual([]);
    expect(messages([], null)).toEqual([]);
  });

  it('deploy 先は auth.mfa のスイッチを自分で書いたときだけ見る', () => {
    const base = ['[auth.mfa.totp]', 'enroll_enabled = true', 'verify_enabled = true'];
    expect(messages([...base, '[remotes.production.auth.email]', 'enable_signup = false'])).toEqual([]);
    expect(messages([...base, '[remotes.production.auth.mfa.totp]', 'verify_enabled = false'])).toEqual([expect.stringContaining('[remotes.production.auth.mfa.totp]')]);
  });
});
