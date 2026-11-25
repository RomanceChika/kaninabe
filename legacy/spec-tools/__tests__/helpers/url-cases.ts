/**
 * `format: url` の文法の**正解表**(受理 / 拒否の型 1 つずつ)。
 *
 * 3 つの判定が**同じ表に同じ答え**を返すことを固定する: 検証器・生成器の正規表現(入力スキーマと表の CHECK の元)・
 * 実行時パッケージの `matchesUrl`・Postgres の `~`(実 DB。`url-format-parity.integration.test.ts`)。
 * 表を足すときは「許す / 許さない」の理由を `name` に書く。
 */

/** 正解表の 1 行。 */
export interface UrlCase {
  readonly name: string;
  readonly value: string;
  /** http と https を許す文法での答え。 */
  readonly httpHttps: boolean;
  /** https だけを許す文法での答え。 */
  readonly httpsOnly: boolean;
}

const row = (name: string, value: string, httpHttps: boolean, httpsOnly = httpHttps && /^[Hh][Tt][Tt][Pp][Ss]:/.test(value)): UrlCase => ({
  name,
  value,
  httpHttps,
  httpsOnly,
});

const HEAD = 'https://example.com/';

/** 正解表。 */
export const URL_CASES: readonly UrlCase[] = [
  row('https の URL', 'https://tickets.example.com/e/1?x=1#a', true),
  row('http の URL', 'http://example.com', true),
  row('スキームの大文字', 'HTTPS://Example.com/Path', true),
  row('スキームの混在', 'Http://example.com', true),
  row('ポート付き', 'https://example.com:8443/x', true),
  row('IPv4 のホスト', 'http://127.0.0.1:3000/', true),
  row('パスが無くクエリだけ', 'https://example.com?x=1', true),
  row('フラグメントだけ', 'https://example.com#top', true),
  row('パーセントエンコードされた非 ASCII', 'https://example.com/%E3%81%82', true),
  row('パスの中の @(ホストではない)', 'https://example.com/@user', true),
  row('ハイフンを含むラベル', 'https://a-b.example-site.co.jp/', true),
  row('予約文字を含むクエリ', 'https://example.com/p?a=1&b=(2);c=*,d=$e+f', true),
  row('一文字のホスト', 'https://a/', true),
  row('天井ちょうどの長さ', HEAD + 'a'.repeat(2048 - HEAD.length), true),
  row('天井を超える長さ', HEAD + 'a'.repeat(2048 - HEAD.length + 1), false),
  row('javascript:', 'javascript:alert(1)', false),
  row('大文字の JavaScript:', 'JavaScript:alert(1)', false),
  row('スキームに紛れ込む改行', 'java\nscript:alert(1)', false),
  row('data:', 'data:text/html,<script>alert(1)</script>', false),
  row('vbscript:', 'vbscript:msgbox(1)', false),
  row('file:', 'file:///etc/passwd', false),
  row('blob:', 'blob:https://example.com/uuid', false),
  row('ftp:', 'ftp://example.com/x', false),
  row('mailto:', 'mailto:a@example.com', false),
  row('スキームの無い綴り', 'example.com/tickets', false),
  row('相対パス', '/relative/path', false),
  row('プロトコル相対', '//evil.example/x', false),
  row('スラッシュが 1 本', 'http:/missing-slash', false),
  row('ホストが空', 'https://', false),
  row('ユーザー名つき', 'https://tickets.example.com@evil.example/', false),
  row('ユーザー名とパスワード', 'https://user:pass@example.com/', false),
  row('空文字', '', false),
  row('空白だけ', '   ', false),
  row('前の空白', ' https://example.com/', false),
  row('後ろの空白', 'https://example.com/ ', false),
  row('ホストの中の空白', 'https:// space.example', false),
  row('パスの中の空白', 'https://example.com/a b', false),
  row('タブ', 'https://example.com/\t', false),
  row('末尾の改行', 'https://example.com\n', false),
  row('改行を挟んだ 2 行目', 'https://example.com/\nx', false),
  row('DEL', 'https://example.com/\u007f', false),
  row('非 ASCII のホスト', 'https://例え.jp/', false),
  row('非 ASCII のパス', 'https://example.com/あ', false),
  row('IPv6 のホスト', 'http://[::1]/', false),
  row('バックスラッシュ', 'https://example.com\\evil', false),
  row('ダブルクォート', 'https://example.com/"onmouseover="x', false),
  row('シングルクォート', "https://example.com/'x", false),
  row('山括弧', 'https://example.com/<script>', false),
  row('波括弧', 'https://example.com/{x}', false),
  row('ホストの先頭がハイフン', 'https://-a.example.com/', false),
  row('ホストの末尾がハイフン', 'https://a-.example.com/', false),
  row('ドットが連続', 'https://a..example.com/', false),
  row('ポートが 6 桁', 'https://example.com:123456/', false),
  row('ポートが文字', 'https://example.com:80a/', false),
];
