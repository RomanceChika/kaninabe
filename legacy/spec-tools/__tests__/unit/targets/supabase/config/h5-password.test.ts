/**
 * H5 のパスワードの守りの突合(Supabase の後段。点検 4 回目 B4-5・5 回目 B5-3)のユニットテスト。
 *
 * 規約網羅(auth-spec-writing.md §検証 H5・ASVS L2 V6.2.1 / V6.2.3 / V6.8.1 / V7.5.1):
 *   - 本番の方式にメール(`providers` に `email`)があるなら、最短の長さ 8 以上・メールアドレスの確認あり・パスワードの変更に再認証あり
 *   - 書かれていないキーは Supabase の既定(6 / false / false)で読むので赤
 *   - 境界: 長さ 7 は赤・8 は通る
 *   - 読めない値(型違い)は赤
 *   - `email` が local_only だけ・本番の方式に無い・`[auth] enabled = false` なら見ない
 *   - deploy 先は自分で書いたキーだけを見る
 *   - (5 回目 B5-3)パスワードを持てる方式は許可表 email / phone の両方: phone は最短の長さ・変更の再認証・SMS の確認を求める。
 *     email はアドレスの変更の二重の確認(`double_confirm_changes`。既定 true なので書いて外したときだけ赤)も求める
 */

import { describe, expect, it } from 'vitest';
import type { AuthConfigInput } from '../../../../../lib/auth/platform-config.js';
import { stackConfigPath } from '../../../../../lib/model/product/paths.js';
import { authConfigFindings } from '../../../../../lib/targets/supabase/config/h5-auth-config.js';
import { MIN_PASSWORD_LENGTH } from '../../../../../lib/targets/supabase/config/h5-password.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

const CONFIG_FILE = stackConfigPath(TEST_ROOTS);

/** パスワードの守りの設定のキー(ほかの突合の指摘を除くため)。 */
const PASSWORD_SETTINGS: readonly string[] = ['auth.minimum_password_length', 'auth.email.enable_confirmations', 'auth.email.secure_password_change', 'auth.email.double_confirm_changes', 'auth.sms.enable_confirmations'];

/** 3 つとも届いている設定。 */
const GOOD = ['[auth]', `minimum_password_length = ${MIN_PASSWORD_LENGTH}`, '[auth.email]', 'enable_confirmations = true', 'secure_password_change = true'];

function input(providers: readonly string[], localOnly: readonly string[] = []): AuthConfigInput {
  return { providers, localOnly: localOnly.map((method) => ({ method, reason: 'テストだけ' })), repoRoot: '/repo', roots: TEST_ROOTS };
}

/** パスワードの守りの指摘の、設定のキー(ほかの突合の指摘は除く)。 */
function settings(lines: readonly string[], providers: readonly string[] = ['email'], localOnly: readonly string[] = []): string[] {
  return authConfigFindings(lines.join('\n'), CONFIG_FILE, input(providers, localOnly))
    .findings.filter((finding) => PASSWORD_SETTINGS.includes(String(finding.counterexample?.['setting'])))
    .map((finding) => `${finding.location.pointer ?? ''} ${String(finding.counterexample?.['value'] ?? 'unreadable')}`);
}

/** GOOD の 1 行を差し替える。 */
function swap(part: string, replacement: string): string[] {
  return GOOD.map((line) => (line.startsWith(part) ? replacement : line));
}

describe('H5: パスワードの守り(本番の方式にメール)', () => {
  it('3 つとも届いていれば通る', () => {
    expect(settings(GOOD)).toEqual([]);
  });

  it('何も書いていない → 既定(6 / false / false)で読んで 3 件とも赤', () => {
    expect(settings([])).toEqual(['[auth].minimum_password_length 6', '[auth.email].enable_confirmations false', '[auth.email].secure_password_change false']);
    const [first] = authConfigFindings('', CONFIG_FILE, input(['email'])).findings.filter((finding) => finding.counterexample?.['setting'] === 'auth.minimum_password_length');
    expect(first?.message).toContain('書かれていないので Supabase の既定');
    expect(first?.message).toContain('providers: email');
  });

  /** [題, 差し替える行の先頭, 差し替え, 期待する指摘]。 */
  const CASES: readonly (readonly [string, string, string, readonly string[]])[] = [
    ['境界: 長さ 7 は赤', 'minimum_password_length', 'minimum_password_length = 7', ['[auth].minimum_password_length 7']],
    ['境界: 長さ 8 は通る', 'minimum_password_length', 'minimum_password_length = 8', []],
    ['長さ 15(推奨)は通る', 'minimum_password_length', 'minimum_password_length = 15', []],
    ['雛形の長さ 6 は赤', 'minimum_password_length', 'minimum_password_length = 6', ['[auth].minimum_password_length 6']],
    ['長さが文字列 → 読めない', 'minimum_password_length', 'minimum_password_length = "8"', ['[auth].minimum_password_length unreadable']],
    ['長さが小数 → 読めない', 'minimum_password_length', 'minimum_password_length = 8.5', ['[auth].minimum_password_length unreadable']],
    ['長さが安全な整数の外 → 読めない(大きいから通す、にしない)', 'minimum_password_length', 'minimum_password_length = 99999999999999999999', ['[auth].minimum_password_length unreadable']],
    ['メールの確認なし(雛形)は赤', 'enable_confirmations', 'enable_confirmations = false', ['[auth.email].enable_confirmations false']],
    ['メールの確認が文字列 → 読めない', 'enable_confirmations', 'enable_confirmations = "true"', ['[auth.email].enable_confirmations unreadable']],
    ['変更の再認証なし(雛形)は赤', 'secure_password_change', 'secure_password_change = false', ['[auth.email].secure_password_change false']],
  ];

  it.each(CASES)('%s', (_title, part, replacement, expected) => {
    expect(settings(swap(part, replacement))).toEqual(expected);
  });

  it('email が local_only だけ・本番の方式に無い → 見ない(本番にパスワードのサインインが無い)', () => {
    expect(settings([], ['discord'], ['email'])).toEqual([]);
    expect(settings([], ['google'])).toEqual([]);
  });

  it('email がほかの方式と並んでいても見る', () => {
    expect(settings([], ['google', 'email'])).toHaveLength(3);
  });

  it('[auth] enabled = false なら見ない', () => {
    expect(settings(['[auth]', 'enabled = false'])).toEqual([]);
  });

  it('deploy 先は自分で書いたキーだけを見る(引き継いだ値は基の設定の指摘と重なる)', () => {
    expect(settings([...GOOD, '[remotes.production.auth.sms]', 'enable_signup = false'])).toEqual([]);
    // 基の設定が赤でも、deploy 先が書いていないキーは deploy 先の指摘にしない(重ねて出さない)。
    expect(settings(['[remotes.production.auth.sms]', 'enable_signup = false'])).toHaveLength(3);
    expect(settings([...GOOD, '[remotes.production.auth.email]', 'enable_confirmations = false'])).toEqual(['[remotes.production.auth.email].enable_confirmations false']);
    expect(settings([...GOOD, '[remotes.production.auth]', 'minimum_password_length = 6'])).toEqual(['[remotes.production.auth].minimum_password_length 6']);
  });
});

describe('H5: パスワードの守り(点検 5 回目 B5-3。パスワードを持てる方式は email / phone の許可表)', () => {
  /** phone の製品で届いている設定。 */
  const PHONE_GOOD = ['[auth]', `minimum_password_length = ${MIN_PASSWORD_LENGTH}`, '[auth.email]', 'secure_password_change = true', '[auth.sms]', 'enable_signup = true', 'enable_confirmations = true'];

  it('phone の製品で、最短の長さ・変更の再認証・SMS の確認が届いていれば通る', () => {
    expect(settings(PHONE_GOOD, ['phone'])).toEqual([]);
  });

  it('phone の製品で、雛形の値(最短 6・SMS の確認なし。探り台本 B/probe3)は赤 —— メールの確認は求めない', () => {
    expect(settings(['[auth.sms]', 'enable_signup = true', 'enable_confirmations = false'], ['phone'])).toEqual([
      '[auth].minimum_password_length 6',
      '[auth.email].secure_password_change false',
      '[auth.sms].enable_confirmations false',
    ]);
    const [finding] = authConfigFindings('', CONFIG_FILE, input(['phone'])).findings.filter((candidate) => candidate.counterexample?.['setting'] === 'auth.sms.enable_confirmations');
    expect(finding?.message).toContain('providers: phone');
    expect(finding?.message).toContain('書かれていないので Supabase の既定');
  });

  it.each([
    ['SMS の確認なし', 'enable_confirmations = true', 'enable_confirmations = false', ['[auth.sms].enable_confirmations false']],
    ['SMS の確認が文字列 → 読めない', 'enable_confirmations = true', 'enable_confirmations = "true"', ['[auth.sms].enable_confirmations unreadable']],
    ['境界: 長さ 7 は赤', 'minimum_password_length', 'minimum_password_length = 7', ['[auth].minimum_password_length 7']],
    ['変更の再認証なし', 'secure_password_change', 'secure_password_change = false', ['[auth.email].secure_password_change false']],
  ] as const)('phone: %s', (_title, part, replacement, expected) => {
    expect(settings(PHONE_GOOD.map((line) => (line.startsWith(part) ? replacement : line)), ['phone'])).toEqual(expected);
  });

  it('email の製品は SMS の確認を求めない・phone の製品はメールの確認を求めない(方式ごとの守り)', () => {
    expect(settings(GOOD, ['email'])).toEqual([]);
    expect(settings(PHONE_GOOD.filter((line) => !line.startsWith('enable_confirmations')).concat('[auth.email]', 'enable_confirmations = false'), ['phone'])).toEqual(['[auth.sms].enable_confirmations false']);
  });

  it('email と phone の両方なら、両方の守りを求める(共通のキーは 1 件だけ)', () => {
    expect(settings([], ['email', 'phone'])).toEqual([
      '[auth].minimum_password_length 6',
      '[auth.email].enable_confirmations false',
      '[auth.email].secure_password_change false',
      '[auth.sms].enable_confirmations false',
    ]);
    const [shared] = authConfigFindings('', CONFIG_FILE, input(['email', 'phone'])).findings.filter((finding) => finding.counterexample?.['setting'] === 'auth.minimum_password_length');
    expect(shared?.message).toContain('providers: email, phone');
  });

  it('email: アドレスの変更の二重の確認は既定 true なので書かなければ通り、書いて外せば赤(探り台本 B/probe3 の 3 つめ)', () => {
    expect(settings([...GOOD, 'double_confirm_changes = true'])).toEqual([]);
    expect(settings([...GOOD, 'double_confirm_changes = false'])).toEqual(['[auth.email].double_confirm_changes false']);
    expect(settings([...GOOD, 'double_confirm_changes = "no"'])).toEqual(['[auth.email].double_confirm_changes unreadable']);
    expect(settings([...GOOD, '[remotes.production.auth.email]', 'double_confirm_changes = false'])).toEqual(['[remotes.production.auth.email].double_confirm_changes false']);
  });

  it('phone が local_only だけなら見ない', () => {
    expect(settings([], ['discord'], ['phone'])).toEqual([]);
  });

  it('phone の deploy 先は自分で書いた SMS の確認だけを見る', () => {
    expect(settings([...PHONE_GOOD, '[remotes.production.auth.sms]', 'enable_confirmations = false'], ['phone'])).toEqual(['[remotes.production.auth.sms].enable_confirmations false']);
    expect(settings([...PHONE_GOOD, '[remotes.production.auth.sms]', 'enable_signup = true'], ['phone'])).toEqual([]);
  });

  it('secure_password_change の指摘は、今のパスワードの入力ではないことと V6.2.3 の満たし方を名指す', () => {
    const [finding] = authConfigFindings('', CONFIG_FILE, input(['email'])).findings.filter((candidate) => candidate.counterexample?.['setting'] === 'auth.email.secure_password_change');
    expect(finding?.suggestion).toContain('今のパスワードの入力ではない');
    expect(finding?.message).toContain('ASVS V7.5.1');
  });
});

describe('H5: 認証の要求の流量の上限(点検 6 回目 B6-4。ASVS V6.3.1)', () => {
  /** 流量の上限のキー。 */
  const RATE_SETTINGS: readonly string[] = ['auth.rate_limit.sign_in_sign_ups', 'auth.rate_limit.token_verifications'];

  /** 流量の上限の指摘(ほかの指摘は除く)。 */
  function rates(lines: readonly string[], providers: readonly string[] = ['email'], localOnly: readonly string[] = []): string[] {
    return authConfigFindings(lines.join('\n'), CONFIG_FILE, input(providers, localOnly))
      .findings.filter((finding) => RATE_SETTINGS.includes(String(finding.counterexample?.['setting'])))
      .map((finding) => `${finding.location.pointer ?? ''} ${String(finding.counterexample?.['value'] ?? 'unreadable')}`);
  }

  const rate = (signIn: string, verify: string): string[] => [...GOOD, '[auth.rate_limit]', `sign_in_sign_ups = ${signIn}`, `token_verifications = ${verify}`];

  it.each([
    ['書いていない → 既定(30)で読んで通る', GOOD, []],
    ['境界: 30 は通る', rate('30', '30'), []],
    ['境界: 1 は通る', rate('1', '1'), []],
    ['境界: 31 は赤', rate('31', '30'), ['[auth.rate_limit].sign_in_sign_ups 31']],
    ['境界: 0 は赤(上限として意味を持たない)', rate('30', '0'), ['[auth.rate_limit].token_verifications 0']],
    ['探り台本 probe4: 100 万は両方赤', rate('1000000', '1000000'), ['[auth.rate_limit].sign_in_sign_ups 1000000', '[auth.rate_limit].token_verifications 1000000']],
    ['負の数は赤', rate('-1', '30'), ['[auth.rate_limit].sign_in_sign_ups -1']],
    ['文字列 → 読めない', rate('"30"', '30'), ['[auth.rate_limit].sign_in_sign_ups unreadable']],
    ['小数 → 読めない', rate('30', '29.5'), ['[auth.rate_limit].token_verifications unreadable']],
  ] as const)('%s', (_title, lines, expected) => {
    expect(rates(lines)).toEqual(expected);
  });

  it('phone の製品にも求める・email と phone の両方なら 1 件ずつ', () => {
    expect(rates(rate('500', '30'), ['phone'])).toEqual(['[auth.rate_limit].sign_in_sign_ups 500']);
    expect(rates(rate('500', '30'), ['email', 'phone'])).toEqual(['[auth.rate_limit].sign_in_sign_ups 500']);
  });

  it('パスワードの方式が本番に無い(local_only だけ・外部の IdP だけ)・認証が無効なら見ない', () => {
    expect(rates(rate('1000000', '1000000'), ['discord'], ['email'])).toEqual([]);
    expect(rates(rate('1000000', '1000000'), ['google'])).toEqual([]);
    expect(rates(['[auth]', 'enabled = false', '[auth.rate_limit]', 'sign_in_sign_ups = 1000000'])).toEqual([]);
  });

  it('deploy 先は自分で書いたキーだけを見る', () => {
    expect(rates([...GOOD, '[remotes.production.auth.rate_limit]', 'sign_in_sign_ups = 1000'])).toEqual(['[remotes.production.auth.rate_limit].sign_in_sign_ups 1000']);
    expect(rates([...rate('1000', '30'), '[remotes.production.auth]', 'minimum_password_length = 8'])).toEqual(['[auth.rate_limit].sign_in_sign_ups 1000']);
  });

  it('指摘は ASVS V6.3.1 と、既定に戻す直し方を名指す', () => {
    const [finding] = authConfigFindings(rate('1000000', '30').join('\n'), CONFIG_FILE, input(['email'])).findings.filter((candidate) => candidate.counterexample?.['setting'] === 'auth.rate_limit.sign_in_sign_ups');
    expect(finding?.message).toContain('ASVS V6.3.1');
    expect(finding?.message).toContain('providers: email');
    expect(finding?.suggestion).toContain('sign_in_sign_ups = 30 以下');
  });
});

describe('H5: 送信の流量の上限(点検 7 回目 B7-7。B6-4 と同じ方式)', () => {
  /** 方式ごとに守りの揃った設定に、送信の流量の行を足す。 */
  const EMAIL_BASE = [...GOOD];
  const PHONE_BASE = ['[auth]', `minimum_password_length = ${MIN_PASSWORD_LENGTH}`, '[auth.email]', 'secure_password_change = true', '[auth.sms]', 'enable_signup = true', 'enable_confirmations = true'];
  const sent = (base: readonly string[], lines: readonly string[]): string => [...base, '[auth.rate_limit]', ...lines].join('\n');
  /** 送信の流量の指摘だけを `設定 値` で並べる。 */
  const sentFindings = (text: string, providers: readonly string[], localOnly: readonly string[] = []): string[] =>
    authConfigFindings(text, CONFIG_FILE, input(providers, localOnly))
      .findings.filter((finding) => ['auth.rate_limit.email_sent', 'auth.rate_limit.sms_sent'].includes(String(finding.counterexample?.['setting'])))
      .map((finding) => `${String(finding.counterexample?.['setting'])} ${String(finding.counterexample?.['value'] ?? 'unreadable')}`);

  const CASES: readonly (readonly [string, readonly string[], readonly string[], readonly string[]])[] = [
    ['email: 書かない → 既定 2 で通る', ['email'], [], []],
    ['email: 境界 2 は通る', ['email'], ['email_sent = 2'], []],
    ['email: 境界 1 は通る', ['email'], ['email_sent = 1'], []],
    ['email: 3 は赤(既定より緩い)', ['email'], ['email_sent = 3'], ['auth.rate_limit.email_sent 3']],
    ['email: 探り台本 probe5 の 100 万は赤', ['email'], ['email_sent = 1000000', 'sms_sent = 1000000'], ['auth.rate_limit.email_sent 1000000']],
    ['email: 0 は赤', ['email'], ['email_sent = 0'], ['auth.rate_limit.email_sent 0']],
    ['phone: 書かない → 既定 30 で通る', ['phone'], [], []],
    ['phone: 境界 30 は通る', ['phone'], ['sms_sent = 30'], []],
    ['phone: 31 は赤', ['phone'], ['sms_sent = 31'], ['auth.rate_limit.sms_sent 31']],
    ['phone: 探り台本 probe5 の 100 万は赤(email_sent は求めない)', ['phone'], ['email_sent = 1000000', 'sms_sent = 1000000'], ['auth.rate_limit.sms_sent 1000000']],
    ['phone: 小数は読めない', ['phone'], ['sms_sent = 2.5'], ['auth.rate_limit.sms_sent unreadable']],
  ];

  it.each(CASES)('%s', (_name, providers, lines, expected) => {
    const base = providers.includes('phone') ? PHONE_BASE : EMAIL_BASE;
    expect(sentFindings(sent(base, lines), providers)).toEqual(expected);
  });

  it('email と phone の両方なら両方を求める', () => {
    const text = sent([...GOOD, '[auth.sms]', 'enable_confirmations = true'], ['email_sent = 9', 'sms_sent = 99']);
    expect(sentFindings(text, ['email', 'phone'])).toEqual(['auth.rate_limit.email_sent 9', 'auth.rate_limit.sms_sent 99']);
  });

  it('パスワードの方式が本番に無ければ見ない(local_only だけ)', () => {
    expect(sentFindings(sent(EMAIL_BASE, ['email_sent = 1000000']), [], ['email'])).toEqual([]);
  });

  it('指摘は ASVS V2.4.1 と既定に戻す直し方を名指す', () => {
    const [finding] = authConfigFindings(sent(PHONE_BASE, ['sms_sent = 1000000']), CONFIG_FILE, input(['phone'])).findings.filter((candidate) => candidate.counterexample?.['setting'] === 'auth.rate_limit.sms_sent');
    expect(finding?.message).toContain('ASVS V2.4.1');
    expect(finding?.suggestion).toContain('既定 30 に戻す');
  });
});
