/**
 * H5 のセッションの寿命の突合(Supabase の後段)のユニットテスト。
 *
 * 規約網羅(auth-spec-writing.md §`sessions`・§検証 H5):
 *   - `[auth.sessions] timebox` / `inactivity_timeout` が宣言と同じ長さなら通る(綴りが違っても長さで比べる)
 *   - 書かれていなければエラー(既定ではセッションが時間で終わらない)
 *   - 食い違えばエラー・期間として読めなければエラー
 *   - アクセストークンの寿命(`[auth] jwt_expiry`。既定 3600 秒)が無操作の時間切れより短くなければエラー
 *   - アクセストークンの寿命がライブラリの更新の余裕(90 秒)以下ならエラー(境界: 90 は赤・91 は通る)
 *   - 更新トークンの回転を無効にすればエラー(更新トークンが期限を持たない)
 *   - deploy 先(remotes)は自分で書いたキーだけを見る
 *   - 宣言を読めなかったら寿命の突合は出さない(H0 が言っている)・認証を動かさない設定は理由つきで飛ばす
 */

import { describe, expect, it } from 'vitest';
import type { AuthConfigInput } from '../../../../../lib/auth/platform-config.js';
import { authConfigFindings } from '../../../../../lib/targets/supabase/config/h5-auth-config.js';
import { goDurationSeconds } from '../../../../../lib/targets/supabase/config/h5-sessions.js';
import { declaredDurationSeconds, formatSeconds } from '../../../../../lib/model/auth/sessions.js';
import { stackConfigPath } from '../../../../../lib/model/product/paths.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';
import type { ConcurrentSessionsDecl } from '../../../../../lib/model/auth/sessions.js';
import { authSessions } from '../../../../helpers/auth-builder.js';

const CONFIG_FILE = stackConfigPath(TEST_ROOTS);

/** 宣言(無操作 8 時間・絶対 24 時間)。 */
const SESSIONS = authSessions();

function input(overrides: Partial<AuthConfigInput> = {}): AuthConfigInput {
  return { providers: ['github'], localOnly: [], sessions: SESSIONS, repoRoot: '/repo', roots: TEST_ROOTS, ...overrides };
}

/** サインインの口と公開スキーマは宣言に収まる設定(寿命の行だけを差し替える)。 */
function config(...lines: string[]): string {
  return ['[api]', 'schemas = ["api"]', '[auth]', 'enable_anonymous_sign_ins = false', '[auth.email]', 'enable_signup = false', '[auth.external.github]', 'enabled = true', ...lines].join('\n');
}

const SESSIONS_ALIGNED = ['[auth.sessions]', 'timebox = "24h"', 'inactivity_timeout = "8h"'];

/** 違反の文。 */
function messages(text: string, overrides: Partial<AuthConfigInput> = {}): string[] {
  return authConfigFindings(text, CONFIG_FILE, input(overrides)).findings.map((finding) => finding.message);
}

describe('H5: セッションの寿命の突合', () => {
  it('宣言と同じ長さなら通る(綴りが違っても長さで比べる)', () => {
    expect(messages(config(...SESSIONS_ALIGNED))).toEqual([]);
    expect(messages(config('[auth.sessions]', 'timebox = "23h60m"', 'inactivity_timeout = "480m"'))).toEqual([]);
  });

  it('[auth.sessions] が書かれていなければ、2 つとも名指す(既定ではセッションが時間で終わらない)', () => {
    const found = messages(config());

    expect(found).toHaveLength(2);
    expect(found[0]).toContain('[auth.sessions] timebox が書かれていません');
    expect(found[0]).toContain('絶対の寿命で終わらない');
    expect(found[1]).toContain('[auth.sessions] inactivity_timeout が書かれていません');
  });

  it('宣言と食い違えばエラー(位置・設定の値・宣言の値を名指す)', () => {
    const findings = authConfigFindings(config('[auth.sessions]', 'timebox = "7d"', 'timebox2 = "x"', 'inactivity_timeout = "12h"'), CONFIG_FILE, input()).findings;
    const texts = findings.map((finding) => finding.message);

    expect(texts.some((text) => text.includes('timebox を期間として読めません'))).toBe(true);
    expect(texts.some((text) => text.includes('inactivity_timeout は 12h ですが、認証フロー仕様の sessions は 8h です'))).toBe(true);
    expect(findings.map((finding) => finding.location.pointer)).toContain('[auth.sessions].inactivity_timeout');
    expect(findings.every((finding) => finding.verifier === 'H5' && finding.severity === 'error')).toBe(true);
  });

  it('文字列でない値は期間として読めない', () => {
    expect(messages(config('[auth.sessions]', 'timebox = 86400', 'inactivity_timeout = "8h"'))).toEqual([expect.stringContaining('timebox を期間として読めません')]);
  });

  it.each([
    [3, true],
    [60, true],
    [90, true],
    [91, false],
    [3600, false],
  ])('アクセストークンの寿命 %d 秒: ライブラリの更新の余裕(90 秒)以下なら %s(締め出しの連鎖の前提)', (seconds, red) => {
    const findings = authConfigFindings(['[auth]', `jwt_expiry = ${String(seconds)}`, ...SESSIONS_ALIGNED].join('\n'), CONFIG_FILE, input({ providers: [] })).findings;
    const floor = findings.filter((finding) => finding.message.includes('ライブラリの更新の余裕'));
    expect(floor.length).toBe(red ? 1 : 0);
    if (red) expect(floor[0]).toMatchObject({ verifier: 'H5', severity: 'error', location: { pointer: '[auth].jwt_expiry' } });
  });

  it('アクセストークンの寿命が無操作の時間切れより短くなければエラー(既定 3600 秒で見る)', () => {
    const shorter = messages(['[auth]', 'jwt_expiry = 1800', ...SESSIONS_ALIGNED].join('\n'), { providers: [] });
    expect(shorter.filter((text) => text.includes('jwt_expiry') || text.includes('sessions'))).toEqual([]);
    const sameAsInactivity = messages(config(...SESSIONS_ALIGNED), { sessions: authSessions('1h', 3600, '24h', 86_400) });
    expect(sameAsInactivity.some((text) => text.includes('(書かれておらず既定) で、認証フロー仕様の無操作の時間切れ 1h より短くありません'))).toBe(true);
    const longer = messages(['[auth]', 'jwt_expiry = 36000', ...SESSIONS_ALIGNED].join('\n'), { providers: [] });
    expect(longer.some((text) => text.includes('[auth] jwt_expiry は 10h で'))).toBe(true);
    expect(messages(['[auth]', 'jwt_expiry = "1h"', ...SESSIONS_ALIGNED].join('\n'), { providers: [] }).some((text) => text.includes('jwt_expiry を読めません'))).toBe(true);
  });

  it('更新トークンの回転を無効にするとエラー(更新トークンが期限を持たない)・読めない値もエラー', () => {
    const off = messages(['[auth]', 'enable_refresh_token_rotation = false', ...SESSIONS_ALIGNED].join('\n'), { providers: [] });
    expect(off.some((text) => text.includes('enable_refresh_token_rotation が false です'))).toBe(true);
    const unreadable = messages(['[auth]', 'enable_refresh_token_rotation = "no"', ...SESSIONS_ALIGNED].join('\n'), { providers: [] });
    expect(unreadable.some((text) => text.includes('enable_refresh_token_rotation を読めません'))).toBe(true);
    const on = messages(['[auth]', 'enable_refresh_token_rotation = true', ...SESSIONS_ALIGNED].join('\n'), { providers: [] });
    expect(on.filter((text) => text.includes('enable_refresh_token_rotation') || text.includes('sessions'))).toEqual([]);
  });

  it('deploy 先は自分で書いたキーだけを見る(引き継いだ値は基の設定の指摘と重ねない)', () => {
    const inherited = messages(config(...SESSIONS_ALIGNED, '[remotes.production.auth.email]', 'enable_signup = false'));
    expect(inherited).toEqual([]);
    const overridden = messages(config(...SESSIONS_ALIGNED, '[remotes.production.auth.sessions]', 'timebox = "720h"'));
    expect(overridden).toEqual([expect.stringContaining('[remotes.production.auth.sessions] timebox は 30d ですが')]);
    const missingBase = messages(config('[remotes.production.auth.email]', 'enable_signup = false'));
    expect(missingBase).toHaveLength(2);
  });

  it('宣言を読めなかったら寿命の突合は出さない(H0 が言っている)', () => {
    const { sessions: _omitted, ...withoutSessions } = input();
    expect(authConfigFindings(config(), CONFIG_FILE, withoutSessions).findings).toEqual([]);
  });

  it('認証を動かさない設定では見ず、見なかった理由を返す', () => {
    const result = authConfigFindings(['[auth]', 'enabled = false'].join('\n'), CONFIG_FILE, input());

    expect(result.findings.filter((finding) => finding.message.includes('sessions'))).toEqual([]);
    expect(result.skipped).toContain('[auth] enabled = false のため、セッションの寿命の突合は見ていません');
  });
});

describe('H5: 同時セッションの数(設定ファイルでは見えないので、未実施の行で名指す)', () => {
  const CASES: readonly (readonly [string, ConcurrentSessionsDecl, string])[] = [
    ['上限なし', { kind: 'unbounded', reason: '理由' }, '上限なし'],
    ['1 人 1 件(古いのを終える)', { kind: 'limited', max: 1, onLimit: 'ends_oldest', reason: '理由' }, '1 人 1 件まで(上限に達したらいちばん古いセッションを終える)'],
    ['1 人 3 件(新しいのを断る)', { kind: 'limited', max: 3, onLimit: 'refuses_new', reason: '理由' }, '1 人 3 件まで(上限に達したら新しいサインインを断る)'],
  ];

  /** 同時セッションの行だけを取り出す(戻り先の許可リストなど、ほかの未実施の行は関係しない)。 */
  const concurrentLines = (skipped: readonly string[]): string[] => skipped.filter((line) => line.includes('sessions.concurrent'));

  it.each(CASES)('%s: 違反にはせず、設定ファイルに書く場所が無いことを未実施として名指す(キーを作って突き合わせない)', (_label, concurrent, words) => {
    const sessions = authSessions('8h', 8 * 3600, '24h', 24 * 3600, concurrent);
    const result = authConfigFindings(config(...SESSIONS_ALIGNED), CONFIG_FILE, input({ sessions }));

    expect(result.findings).toEqual([]);
    const lines = concurrentLines(result.skipped);
    expect(lines).toEqual([expect.stringContaining(`sessions.concurrent: ${words}`)]);
    expect(lines[0]).toContain('設定ファイルに書く場所が無い');
    expect(lines[0]).toContain('見ていません');
  });

  it('設定ファイルに何を書いても(単一セッションらしいキーでも)結果は変わらない —— 知らないキーを読んで突き合わせない', () => {
    const sessions = authSessions('8h', 8 * 3600, '24h', 24 * 3600, { kind: 'limited', max: 1, onLimit: 'ends_oldest', reason: '理由' });
    const plain = authConfigFindings(config(...SESSIONS_ALIGNED), CONFIG_FILE, input({ sessions }));
    const withKey = authConfigFindings(config(...SESSIONS_ALIGNED, 'single_per_user = false'), CONFIG_FILE, input({ sessions }));

    expect(withKey).toEqual(plain);
  });

  it('deploy 先(remotes)では重ねて名指さない(基の設定と同じ事情。ローカルの 1 行だけ)', () => {
    const result = authConfigFindings(config(...SESSIONS_ALIGNED, '[remotes.production.auth.sessions]', 'timebox = "24h"'), CONFIG_FILE, input());

    expect(concurrentLines(result.skipped)).toHaveLength(1);
  });

  it('認証を動かさない設定では、同時セッションの行も出さない(見なかった理由 1 行だけ)', () => {
    const result = authConfigFindings(['[auth]', 'enabled = false'].join('\n'), CONFIG_FILE, input());

    expect(concurrentLines(result.skipped)).toEqual([]);
  });

  it('宣言を読めなかったら出さない(H0 が言っている)', () => {
    const { sessions: _omitted, ...withoutSessions } = input();

    expect(concurrentLines(authConfigFindings(config(), CONFIG_FILE, withoutSessions).skipped)).toEqual([]);
  });
});

describe('期間の読み方', () => {
  it('宣言の綴り(日・時間・分を大きい順に)を秒に直す。読めない・0 は null', () => {
    expect(declaredDurationSeconds('30m')).toBe(1800);
    expect(declaredDurationSeconds('1d12h30m')).toBe(131_400);
    for (const bad of ['', '0h', '1h1d', '8H', '1.5h', '30s']) expect(declaredDurationSeconds(bad), bad).toBeNull();
  });

  it('Go の期間の綴りを秒に直す(小数・ミリ秒以下の単位も)。読めなければ null', () => {
    expect(goDurationSeconds('24h')).toBe(86_400);
    expect(goDurationSeconds('1h30m')).toBe(5400);
    expect(goDurationSeconds('1.5h')).toBe(5400);
    expect(goDurationSeconds('1500ms')).toBe(1.5);
    for (const bad of ['', '7d', '24', 'h', '1 h']) expect(goDurationSeconds(bad), bad).toBeNull();
  });

  it('秒数を人が読む綴りにする', () => {
    expect(formatSeconds(86_400 * 30)).toBe('30d');
    expect(formatSeconds(5400)).toBe('1h30m');
    expect(formatSeconds(1.5)).toBe('1.5s');
    expect(formatSeconds(0)).toBe('0s');
  });
});
