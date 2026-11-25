/**
 * URL の部品(`format: url` の文法・画面の `href` の関門・設定の URL の関門)のテスト。
 *
 * 網羅の基準は「受理の型 1 つずつ」と「拒否の型 1 つずつ」を表で持つこと(行カバレッジではない)。
 * 文法の正は検証器・生成器の `lib/kernel/url-format.ts` で、2 つの綴りと Postgres の `~` が同じ判定をすることは
 * 検証器側の `url-format.test.ts` と実 DB の `url-format-parity.integration.test.ts` が見る。
 */

import { describe, expect, it } from 'vitest';
import { URL_MAX_LENGTH, isConfigUrl, matchesUrl, readConfigUrl, safeHttpUrl, safeReturnPath, safeReturnPathOr, urlRegexSource } from '../url';

const LONG_PATH = `https://example.com/${'a'.repeat(URL_MAX_LENGTH)}`;

describe('matchesUrl(http_https)', () => {
  const accepted: readonly (readonly [string, string])[] = [
    ['https の URL', 'https://tickets.example.com/e/1?x=1#a'],
    ['http の URL', 'http://example.com'],
    ['スキームの大文字', 'HTTPS://Example.com/Path'],
    ['混在した大文字', 'Http://example.com'],
    ['ポート付き', 'https://example.com:8443/x'],
    ['IPv4 のホスト', 'http://127.0.0.1:3000/'],
    ['パスが無くクエリだけ', 'https://example.com?x=1'],
    ['パーセントエンコードされた非 ASCII', 'https://example.com/%E3%81%82'],
    ['パスの中の @(ホストではない)', 'https://example.com/@user'],
    ['ハイフンを含むラベル', 'https://a-b.example-site.co.jp/'],
  ];

  const rejected: readonly (readonly [string, string])[] = [
    ['javascript:', 'javascript:alert(1)'],
    ['大文字の JavaScript:', 'JavaScript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
    ['blob:', 'blob:https://example.com/uuid'],
    ['ftp:', 'ftp://example.com/x'],
    ['mailto:', 'mailto:a@example.com'],
    ['スキームの無い綴り', 'example.com/tickets'],
    ['相対パス', '/relative/path'],
    ['プロトコル相対', '//evil.example/x'],
    ['スラッシュが 1 本', 'http:/missing-slash'],
    ['ホストが空', 'https://'],
    ['ユーザー名つき', 'https://tickets.example.com@evil.example/'],
    ['ユーザー名とパスワード', 'https://user:pass@example.com/'],
    ['空文字', ''],
    ['空白だけ', '   '],
    ['前の空白', ' https://example.com/'],
    ['後ろの空白', 'https://example.com/ '],
    ['ホストの中の空白', 'https:// space.example'],
    ['パスの中の空白', 'https://example.com/a b'],
    ['タブ', 'https://example.com/\t'],
    ['改行', 'https://example.com/\n'],
    ['末尾の改行(JS の $ の取りこぼしを見る)', 'https://example.com\n'],
    ['NUL', 'https://example.com/\u0000'],
    ['DEL', 'https://example.com/\u007f'],
    ['非 ASCII のホスト', 'https://例え.jp/'],
    ['非 ASCII のパス', 'https://example.com/あ'],
    ['IPv6 のホスト', 'http://[::1]/'],
    ['バックスラッシュ', 'https://example.com\\evil'],
    ['ダブルクォート', 'https://example.com/"onmouseover="x'],
    ['シングルクォート', "https://example.com/'x"],
    ['山括弧', 'https://example.com/<script>'],
    ['ホストの先頭がハイフン', 'https://-a.example.com/'],
    ['ホストの末尾がハイフン', 'https://a-.example.com/'],
    ['ドットが連続', 'https://a..example.com/'],
    ['ポートが 6 桁', 'https://example.com:123456/'],
    ['ポートが文字', 'https://example.com:80a/'],
    ['天井を超える長さ', LONG_PATH],
  ];

  // @spec framework-guarantee-catalog @tc TC-FW-URL-001
  it('format: url の文法は受理の型と拒否の型を表で網羅し、危ないスキーム・ユーザー名・空白・制御文字・非 ASCII・長すぎる値を通さない', () => {
    expect(accepted.length).toBeGreaterThan(5);
    expect(rejected.length).toBeGreaterThan(20);
    for (const [name, value] of accepted) expect(matchesUrl(value), `通す: ${name}`).toBe(true);
    for (const [name, value] of rejected) expect(matchesUrl(value), `通さない: ${name}`).toBe(false);
  });

  it('天井ちょうどの長さは通る', () => {
    const head = 'https://example.com/';
    expect(matchesUrl(head + 'a'.repeat(URL_MAX_LENGTH - head.length))).toBe(true);
    expect(matchesUrl(head + 'a'.repeat(URL_MAX_LENGTH - head.length + 1))).toBe(false);
  });
});

describe('matchesUrl(https)', () => {
  it('https だけを通し、http は通さない', () => {
    expect(matchesUrl('https://example.com/', 'https')).toBe(true);
    expect(matchesUrl('HTTPS://example.com/', 'https')).toBe(true);
    expect(matchesUrl('http://example.com/', 'https')).toBe(false);
    expect(matchesUrl('javascript:alert(1)', 'https')).toBe(false);
  });
});

describe('urlRegexSource', () => {
  it('両端を固定した綴りで、スキームの選びだけが違う', () => {
    const both = urlRegexSource('http_https');
    const only = urlRegexSource('https');
    expect(both.startsWith('^')).toBe(true);
    expect(both.endsWith('$')).toBe(true);
    expect(both).not.toBe(only);
    expect(only).toContain('[Hh][Tt][Tt][Pp][Ss]://');
    expect(both).toContain('[Hh][Tt][Tt][Pp][Ss]?://');
  });
});

describe('safeHttpUrl(画面の href の関門)', () => {
  it('http / https の絶対 URL は通す(スキームは小文字に・前後の空白は落ちる)', () => {
    expect(safeHttpUrl('https://tickets.example.com/e/1?x=1#a')).toBe('https://tickets.example.com/e/1?x=1#a');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/');
    expect(safeHttpUrl('HTTPS://Example.com/Path')).toBe('https://example.com/Path');
    expect(safeHttpUrl('  https://example.com/  ')).toBe('https://example.com/');
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.com/uuid',
    'ftp://example.com/x',
    'mailto:a@example.com',
    '',
    '   ',
    'example.com/tickets',
    '/relative/path',
    '//evil.example/x',
    'ticket_url-1',
    'https://',
    'https://tickets.example.com@evil.example/',
    'https://user:pass@example.com/',
  ])('通さない(null): %j', (value) => {
    expect(safeHttpUrl(value)).toBeNull();
  });

  it('値が無ければ null', () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});

describe('isConfigUrl / readConfigUrl', () => {
  it('scheme: https は https の絶対 URL だけを通す', () => {
    expect(isConfigUrl('https://discord.com/api/webhooks/1/x', 'https')).toBe(true);
    expect(isConfigUrl('http://discord.com/api/webhooks/1/x', 'https')).toBe(false);
    expect(isConfigUrl('http://localhost:3000', 'https')).toBe(false);
    expect(isConfigUrl('javascript:alert(1)', 'https')).toBe(false);
    expect(isConfigUrl('https://', 'https')).toBe(false);
  });

  it('scheme: https_or_loopback は https に加えて自分の機械への http だけを通す', () => {
    expect(isConfigUrl('https://api.example.com', 'https_or_loopback')).toBe(true);
    expect(isConfigUrl('http://localhost:3000', 'https_or_loopback')).toBe(true);
    expect(isConfigUrl('http://127.0.0.1:54321', 'https_or_loopback')).toBe(true);
    expect(isConfigUrl('http://api.example.com', 'https_or_loopback')).toBe(false);
    expect(isConfigUrl('http://localhost.evil.example', 'https_or_loopback')).toBe(false);
    expect(isConfigUrl('http://127.0.0.1.evil.example', 'https_or_loopback')).toBe(false);
    expect(isConfigUrl('ftp://localhost', 'https_or_loopback')).toBe(false);
  });

  it('未設定・空は undefined のまま返し、合う値はそのまま返す', () => {
    expect(readConfigUrl('X', undefined, 'https')).toBeUndefined();
    expect(readConfigUrl('X', '', 'https')).toBeUndefined();
    expect(readConfigUrl('X', 'https://example.com/hook', 'https')).toBe('https://example.com/hook');
  });

  // @spec framework-guarantee-catalog @tc TC-FW-URL-003
  it('設定の URL は宣言した scheme に合わない値を例外にし、文面に値を入れない(Webhook の URL は URL 自体が秘密)', () => {
    expect(() => readConfigUrl('HOOK', 'http://example.com/secret-token', 'https')).toThrow(/HOOK.*https の絶対 URL/);
    expect(() => readConfigUrl('HOOK', 'http://example.com/secret-token', 'https')).not.toThrow(/secret-token/);
    expect(() => readConfigUrl('API', 'http://example.com', 'https_or_loopback')).toThrow(/API.*自分の機械/);
    expect(() => readConfigUrl('API', 'javascript:1', 'https')).toThrow(/API/);
  });
});

describe('safeReturnPath(転送先に使ってよい同じオリジンの相対パス。B8-2)', () => {
  it.each([
    ['根', '/', '/'],
    ['パス', '/items', '/items'],
    ['クエリとフラグメントを保つ', '/owner/items/abc?tab=detail#top', '/owner/items/abc?tab=detail#top'],
    ['クエリの値の中の絶対 URL(パスではない)', '/search?q=https://example.com', '/search?q=https://example.com'],
    ['ドットの区画を畳む', '/a/./b/../c', '/a/c'],
    ['根より上へは出ない', '/../../etc', '/etc'],
    ['パーセントエンコードした斜線はパスのまま', '/%2F%2Fevil.example', '/%2F%2Fevil.example'],
    ['長さの天井ちょうど', `/${'a'.repeat(URL_MAX_LENGTH - 1)}`, `/${'a'.repeat(URL_MAX_LENGTH - 1)}`],
  ])('通す: %s', (_name, value, expected) => {
    expect(safeReturnPath(value)).toBe(expected);
  });

  it.each([
    ['絶対 URL', 'https://evil.example/login'],
    ['大文字のスキーム', 'HTTPS://evil.example'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,x'],
    ['プロトコル相対', '//evil.example/x'],
    ['斜線と逆斜線', '/\\evil.example'],
    ['パスの中の逆斜線', '/a\\b'],
    ['先頭のタブ(ブラウザが落として // になる)', '/\t/evil.example'],
    ['改行', '/\n/evil.example'],
    ['NUL', '/a\u0000b'],
    ['DEL', '/a\u007fb'],
    ['C1 の制御文字', '/a\u0085b'],
    ['正規化で // に畳まれる', '/.//evil.example'],
    ['斜線で始まらない相対', 'evil.example/x'],
    ['ドットで始まる相対', './x'],
    ['空文字', ''],
    ['前の空白', ' /items'],
    ['長さの天井を 1 超える', `/${'a'.repeat(URL_MAX_LENGTH)}`],
  ])('通さない(null): %s', (_name, value) => {
    expect(safeReturnPath(value)).toBeNull();
  });

  it('値が無ければ null', () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
  });
});

describe('safeReturnPathOr(安全な転送の部品の共通の核。B9-1〜B9-6)', () => {
  it.each([
    ['通る値はそのまま(正規化して)', '/a/./b', undefined, '/a/b'],
    ['外の URL は既定の / に倒す', 'https://evil.example', undefined, '/'],
    ['プロトコル相対は既定の行き先に倒す', '//evil.example', '/login', '/login'],
    ['先頭の動的セグメントが作る //(screenPath の探り台本)は既定に倒す', '//evil.example', '/home', '/home'],
    ['逆斜線は既定に倒す', '/\\evil.example', '/home', '/home'],
    ['制御文字は既定に倒す', '/\t/evil.example', '/home', '/home'],
    ['値が無ければ既定', null, '/login?error=x', '/login?error=x'],
    ['既定の行き先も正規化する', undefined, '/a/../b', '/b'],
  ])('%s', (_name, value, fallback, expected) => {
    expect(safeReturnPathOr(value, fallback)).toBe(expected);
  });

  it.each([
    ['外の URL', 'https://evil.example'],
    ['プロトコル相対', '//evil.example'],
    ['空文字', ''],
  ])('既定の行き先が通らなければ例外(書き間違いを外へ倒さない): %s', (_name, fallback) => {
    expect(() => safeReturnPathOr('https://evil.example', fallback)).toThrow(/同じオリジンの相対パス/u);
    expect(safeReturnPathOr('/ok', fallback)).toBe('/ok');
  });
});
