/**
 * H5 の続き —— **戻り先の許可リスト**(`[auth] site_url` / `additional_redirect_urls`)が、宣言した帰り道だけを指すことのユニットテスト。
 *
 * 規約網羅(auth-spec-writing.md §検証 H5・server-only-session.md §3-3):
 *   - 帰り道の絶対 URL だけなら違反なし(オリジンは問わない)
 *   - トップの画面・ワイルドカード・クエリ・フラグメント・利用者の情報・http(s) でない・読めない URL はエラー
 *   - `site_url` が書かれていなければ既定(トップの画面)で読んでエラー。`additional_redirect_urls` が無いのは空
 *   - 読めない値(文字列でない・配列でない)はエラー
 *   - deploy 先は自分で書いたキーだけを見る(基の設定の指摘と重ねない)
 *   - 帰り道の宣言が無ければ見ない(未実施として名指す)。見たときも本番は未検証と名指す
 */

import { describe, expect, it } from 'vitest';
import type { AuthConfigInput } from '../../../../../lib/auth/platform-config.js';
import { authConfigFindings } from '../../../../../lib/targets/supabase/config/h5-auth-config.js';
import { redirectProblem } from '../../../../../lib/targets/supabase/config/h5-redirects.js';
import { stackConfigPath } from '../../../../../lib/model/product/paths.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

const CONFIG_FILE = stackConfigPath(TEST_ROOTS);
const CALLBACK = '/api/auth/callback';

function input(overrides: Partial<AuthConfigInput> = {}): AuthConfigInput {
  return { providers: ['github'], localOnly: [], callback: CALLBACK, repoRoot: '/nonexistent', roots: TEST_ROOTS, ...overrides };
}

/** 方式と公開スキーマは宣言の範囲に収まり、戻り先だけを差し替えられる本文。 */
function config(authLines: readonly string[], extra: readonly string[] = []): string {
  return [
    '[api]',
    'schemas = ["api"]',
    '[auth]',
    'enable_anonymous_sign_ins = false',
    ...authLines,
    '[auth.email]',
    'enable_signup = false',
    '[auth.sms]',
    'enable_signup = false',
    '[auth.external.github]',
    'enabled = true',
    ...extra,
  ].join('\n');
}

const ALIGNED = ['site_url = "http://127.0.0.1:3000/api/auth/callback"', 'additional_redirect_urls = ["https://127.0.0.1:3000/api/auth/callback", "http://127.0.0.1:3100/api/auth/callback/"]'];

function run(text: string, overrides: Partial<AuthConfigInput> = {}): ReturnType<typeof authConfigFindings> {
  return authConfigFindings(text, CONFIG_FILE, input(overrides));
}

describe('H5: 戻り先の許可リスト', () => {
  it('帰り道の絶対 URL だけなら違反なし(オリジン・末尾の / は問わない)。本番は未検証と名指す', () => {
    const result = run(config(ALIGNED));

    expect(result.findings).toEqual([]);
    expect(result.skipped).toEqual(['本番の戻り先の許可リスト(管理画面の Site URL と Redirect URLs)は見ていません(この検査が読むのはローカルの設定ファイルだけ)']);
  });

  it('site_url がトップの画面ならエラーで、攻撃の筋と直し方を言う', () => {
    const findings = run(config(['site_url = "http://127.0.0.1:3000"', ALIGNED[1] ?? ''])).findings;

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      verifier: 'H5',
      severity: 'error',
      location: { file: CONFIG_FILE, pointer: '[auth].site_url' },
      counterexample: { setting: '[auth] site_url', url: 'http://127.0.0.1:3000', callback: CALLBACK },
    });
    expect(findings[0]?.message).toContain('パスが帰り道 /api/auth/callback ではありません(/)');
    expect(findings[0]?.message).toContain('自分の検証子で交換できます');
    expect(findings[0]?.suggestion).toContain('本番の管理画面');
  });

  it('site_url が書かれていなければ既定(トップの画面)で読んでエラー。additional_redirect_urls が無いのは空', () => {
    const findings = run(config([])).findings;

    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('書かれておらず、既定の http://127.0.0.1:3000 で読みます')]);
  });

  it('許可リストの各値も帰り道だけ: ワイルドカード・クエリ・フラグメント・別のパスはそれぞれエラー', () => {
    const findings = run(
      config([ALIGNED[0] ?? '', 'additional_redirect_urls = ["http://127.0.0.1:3000/**", "http://127.0.0.1:3000/api/auth/callback?next=/x", "http://127.0.0.1:3000/api/auth/callback#x", "http://127.0.0.1:3000/"]']),
    ).findings;

    expect(findings.map((finding) => finding.counterexample?.['url'])).toEqual([
      'http://127.0.0.1:3000/**',
      'http://127.0.0.1:3000/api/auth/callback?next=/x',
      'http://127.0.0.1:3000/api/auth/callback#x',
      'http://127.0.0.1:3000/',
    ]);
    expect(findings.every((finding) => finding.location.pointer === '[auth].additional_redirect_urls')).toBe(true);
  });

  it('読めない値はエラー(閉じているとも開いているとも言わない)', () => {
    const findings = run(config(['site_url = true', 'additional_redirect_urls = "http://127.0.0.1:3000/api/auth/callback"'])).findings;

    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('[auth] site_url を読めません(文字列ではありません)'),
      expect.stringContaining('[auth] additional_redirect_urls を読めません(文字列の配列ではありません)'),
    ]);
  });

  it('deploy 先は自分で書いたキーだけを見る(基の設定の指摘と重ねない)', () => {
    const remote = ['[remotes.production.auth]', 'site_url = "https://app.example/"'];
    const findings = run(config(ALIGNED, remote)).findings;

    expect(findings).toHaveLength(1);
    expect(findings[0]?.location.pointer).toBe('[remotes.production.auth].site_url');
    expect(run(config(ALIGNED, ['[remotes.production.auth]', 'site_url = "https://app.example/api/auth/callback"'])).findings).toEqual([]);
  });

  it('帰り道の宣言が無ければ見ない(未実施として名指す)。認証を動かさない設定は方式の突合が名指すので重ねない', () => {
    const withoutCallback: AuthConfigInput = { providers: ['github'], localOnly: [], repoRoot: '/nonexistent', roots: TEST_ROOTS };
    const absent = authConfigFindings(config([]), CONFIG_FILE, withoutCallback);
    expect(absent.findings).toEqual([]);
    expect(absent.skipped).toEqual(['認証フロー仕様に帰り道(callback)の宣言が無いため、戻り先の許可リスト(site_url / additional_redirect_urls)の突合は見ていません']);

    const disabled = run(['[api]', 'schemas = ["api"]', '[auth]', 'enabled = false'].join('\n'));
    expect(disabled.findings).toEqual([]);
    expect(disabled.skipped.some((reason) => reason.includes('戻り先'))).toBe(false);
  });
});

describe('redirectProblem: 戻り先 1 本の判定', () => {
  it('帰り道の http(s) の絶対 URL だけが通る', () => {
    expect(redirectProblem('https://app.example/api/auth/callback', CALLBACK)).toBeNull();
    expect(redirectProblem('http://localhost:3000/api/auth/callback/', CALLBACK)).toBeNull();
  });

  it('それ以外は理由を返す', () => {
    expect(redirectProblem('https://app.example/*', CALLBACK)).toContain('ワイルドカード');
    expect(redirectProblem('/api/auth/callback', CALLBACK)).toBe('絶対 URL として読めません');
    expect(redirectProblem('ftp://app.example/api/auth/callback', CALLBACK)).toContain('http(s) ではありません');
    expect(redirectProblem('https://user:pass@app.example/api/auth/callback', CALLBACK)).toContain('利用者の情報');
    expect(redirectProblem('https://app.example/api/auth/callback#', CALLBACK)).toContain('フラグメント');
    expect(redirectProblem('https://app.example/', CALLBACK)).toContain('パスが帰り道');
  });
});
