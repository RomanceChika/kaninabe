/**
 * `format: url` の文法(kernel 層 — 全層が読む共通語)。
 *
 * **URL の欄の唯一の定義**。入力スキーマ(zod の `.regex()`)・表の導出 CHECK(`~`)・world の値の作り方・
 * 設定カタログの URL の検査が、すべてここから出る。実行時パッケージの `@kaninabe/runtime/url`(表示側の安全なリンクの部品と
 * 設定の読み込み)は同じ文法を **別に持つ**(検証器・生成器は実行時パッケージを import しない)ので、
 * 2 つの綴りが同じであることは `__tests__/unit/kernel/url-format.test.ts` が見る(食い違うと赤)。
 * SQL(Postgres の ARE)と JS の正規表現の両方で同じ意味になる部分集合だけを使う(後読み・名前つきグループ・
 * ブラケットの中のバックスラッシュ・`\d` / `\s` を使わない)ので、1 本の文字列を両方へそのまま置ける。
 *
 * **許すもの**: 絶対 URL の `http://` / `https://`(スキームの大小は問わない)・ASCII の英数字とハイフンのラベルをドットで繋いだホスト・
 * 任意のポート(1〜5 桁)・パス / クエリ / フラグメント(RFC 3986 の非予約文字・予約文字・`%` だけ)。
 * **許さないもの**(restrictive 側に倒した): `javascript:` `data:` `vbscript:` `file:` などの別のスキーム・スキームの無い綴り・
 * プロトコル相対(`//host`)・ユーザー名とパスワード(`user@host`)・空白と制御文字・非 ASCII(パーセントエンコードで書く)・
 * `[` `]` `\` `"` `'` `<` `>` `^` `` ` `` `{` `|` `}`・IPv6 のホスト・長さ 2048 超。
 */

/** `format: url` の欄の長さの天井(`max_length` はこれ以下でなければならない)。 */
export const URL_MAX_LENGTH = 2048;

/** 許すスキームの集合(`format: url` の欄は `http_https` 固定。設定カタログは `https` も選べる)。 */
export type UrlSchemes = 'http_https' | 'https';

/** ホスト(ASCII の英数字とハイフンのラベルをドットで繋ぐ。先頭と末尾は英数字)。 */
const HOST = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:[.][A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*';

/** パス・クエリ・フラグメントの文字(RFC 3986 の非予約・予約・`%`。`[` `]` `'` は含めない)。 */
const TAIL_CHAR = '[-A-Za-z0-9._~:/?#@!$&()*+,;=%]';

/**
 * 文字列全体に一致する正規表現の綴り(JS の `RegExp` と Postgres の `~` の両方で同じ意味)。
 *
 * @param schemes 許すスキーム
 * @returns `^…$` の綴り
 */
export function urlRegexSource(schemes: UrlSchemes): string {
  const scheme = schemes === 'https' ? '[Hh][Tt][Tt][Pp][Ss]' : '[Hh][Tt][Tt][Pp][Ss]?';
  return `^${scheme}://${HOST}(?::[0-9]{1,5})?(?:[/?#]${TAIL_CHAR}*)?$`;
}

/**
 * 値が文法に合うか(長さの天井も見る)。
 *
 * @param value 検査する文字列
 * @param schemes 許すスキーム
 * @returns 合えば true
 */
export function matchesUrl(value: string, schemes: UrlSchemes = 'http_https'): boolean {
  return value.length <= URL_MAX_LENGTH && new RegExp(urlRegexSource(schemes)).test(value);
}

/**
 * 欄の `format` の値域(増やすときは DSL の拡張なので、拡張トリアージを通す)。
 *
 * - `url` — `string` の欄。絶対 URL の http / https だけ(文法はこのファイルが持つ)。
 * - `markdown` — `text` の欄。書式つきの本文(Markdown)。描くときは実行時パッケージの許可リストの描画の口だけを通す
 *   (記録は設計記録 triage-format-markdown)。値の文法は課さない(Markdown は任意の文字列が妥当)ので、入力スキーマ・CHECK には効かない。
 */
export const FIELD_FORMATS = ['url', 'markdown'] as const;

/**
 * `format: markdown` の欄の `max_length` の天井。実行時パッケージの `MARKDOWN_RENDER_LIMIT`(これを超える本文は解釈せず素の文で出す)と同じ値で、
 * 食い違わないことは `__tests__/unit/kernel/url-format.test.ts` が見る。
 */
export const MARKDOWN_MAX_LENGTH = 8_000;

/** 欄の `format`。 */
export type FieldFormat = (typeof FIELD_FORMATS)[number];

/**
 * 欄の制約として効く正規表現(宣言した `pattern`、または `format` から導いたもの)。
 * 入力スキーマ・CHECK・world の検算は**この 1 本**を見る(片方だけが効く欄を作らない)。
 *
 * @param field 欄の宣言のうち制約の部分
 * @returns 正規表現の綴り。無ければ undefined
 */
export function effectivePattern(field: { readonly pattern?: string; readonly format?: FieldFormat }): string | undefined {
  if (field.format === 'url') return urlRegexSource('http_https');
  return field.pattern;
}

/**
 * world(機械的に置く値)に使う、文法に合う URL。長さの上限を超えるなら、スキームとホストを残して末尾を詰める。
 *
 * @param name 欄の名前
 * @param seq 連番
 * @param limit `max_length`(無ければ天井)
 * @returns 文法に合う URL
 */
export function worldUrl(name: string, seq: number, limit: number | undefined): string {
  const head = 'https://example.test/';
  const value = `${head}${name}-${seq}`;
  const max = limit ?? URL_MAX_LENGTH;
  if (value.length <= max) return value;
  return head.length >= max ? head : value.slice(0, max);
}
