/**
 * URL の部品(`format: url` の欄の表示側と、設定カタログの URL の読み込み側)。
 *
 * **仕様**: 欄の `format: url`(entity_spec)と設定の `format: url` + `scheme`(config カタログ)。
 * 文法の正は検証器・生成器の `legacy/spec-tools/lib/kernel/url-format.ts` で、入力スキーマ(zod)と
 * 表の CHECK はそこから生成される。**ここは同じ文法を別に持つ**(検証器・生成器は実行時パッケージを
 * import しない)ので、2 つの綴りが一致することは検証器側の `url-format.test.ts` が見る。
 *
 * 3 つの口がある。
 *   - `matchesUrl` — 文法に合うか(CHECK / zod と同じ判定。両者が食い違わないことの検査が参照する)
 *   - `safeHttpUrl` — **画面の `href` に出してよい URL だけを通す**(`format: url` の欄の値をリンクにするときは必ずこれを通す)
 *   - `readConfigUrl` — 設定カタログの URL の値を読む(宣言した `scheme` に合わなければ起動時に例外)
 *   - `safeReturnPath` — **転送先(戻り先)に使ってよい、同じオリジンの相対パスだけを通す**(転送の安全な部品の核)
 *   - `safeReturnPathOr` — 同じ判定で、通らなければ既定の行き先(これも同じ判定を通す)に倒す
 *
 * 転送(サーバーの `redirect`・Route Handler の `Location`・クライアントの遷移)を作れるのは、これを核にした
 * 安全な部品(`@kaninabe/runtime/navigation` の `safeRedirect`・`@kaninabe/runtime/navigation/client` の `useSafeNavigate`・
 * `@kaninabe/runtime/http/redirect` の `safeRedirectResponse`)だけである(ESLint の `layer/require-safe-redirect` が生の転送の口を
 * 製品のコードから全部止める。点検 9 回目 B9-1〜B9-6)。
 */

/** URL の長さの天井(`format: url` の欄の `max_length` もこれ以下)。 */
export const URL_MAX_LENGTH = 2048;

/** 許すスキームの集合。 */
export type UrlSchemes = 'http_https' | 'https';

/** 設定の URL の `scheme` の宣言。`https_or_loopback` は https に加えて、自分の機械(localhost / 127.0.0.1)への http だけを許す(開発機の接続先用)。 */
export type ConfigUrlScheme = 'https' | 'https_or_loopback';

/** ホスト(ASCII の英数字とハイフンのラベルをドットで繋ぐ)。 */
const HOST = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:[.][A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*';

/** パス・クエリ・フラグメントの文字(RFC 3986 の非予約・予約・`%`)。 */
const TAIL_CHAR = '[-A-Za-z0-9._~:/?#@!$&()*+,;=%]';

/** スキームの綴り(`https` だけ / `http` と `https`)。 */
const HTTPS_SCHEME = '[Hh][Tt][Tt][Pp][Ss]';
const HTTP_HTTPS_SCHEME = '[Hh][Tt][Tt][Pp][Ss]?';

/**
 * 文字列全体に一致する正規表現の綴り(Postgres の `~` と JS の両方で同じ意味)。
 * 綴りは**固定の定数だけで組む**(`new RegExp` のパターンが静的であることを lint の `layer/no-dynamic-regexp` が見るため)。
 */
const SOURCE_HTTPS = `^${HTTPS_SCHEME}://${HOST}(?::[0-9]{1,5})?(?:[/?#]${TAIL_CHAR}*)?$`;
const SOURCE_HTTP_HTTPS = `^${HTTP_HTTPS_SCHEME}://${HOST}(?::[0-9]{1,5})?(?:[/?#]${TAIL_CHAR}*)?$`;

/** コンパイル済みの正規表現(スキームの集合ごと)。 */
const URL_PATTERN_HTTPS = new RegExp(SOURCE_HTTPS);
const URL_PATTERN_HTTP_HTTPS = new RegExp(SOURCE_HTTP_HTTPS);

/**
 * 文字列全体に一致する正規表現の綴り(Postgres の `~` と JS の両方で同じ意味)。
 *
 * @param schemes 許すスキーム
 * @returns `^…$` の綴り
 */
export function urlRegexSource(schemes: UrlSchemes): string {
  return schemes === 'https' ? SOURCE_HTTPS : SOURCE_HTTP_HTTPS;
}

/**
 * 値が文法に合うか(長さの天井も見る)。表の CHECK と入力スキーマの `.regex()` と同じ判定。
 *
 * @param value 検査する文字列
 * @param schemes 許すスキーム(既定は http と https)
 * @returns 合えば true
 */
export function matchesUrl(value: string, schemes: UrlSchemes = 'http_https'): boolean {
  return value.length <= URL_MAX_LENGTH && (schemes === 'https' ? URL_PATTERN_HTTPS : URL_PATTERN_HTTP_HTTPS).test(value);
}

/**
 * 画面の `href` に出してよい URL だけを通す。
 *
 * **書き込みの側(`format: url` の CHECK と入力スキーマ)が守っていても、表示の側でも落とす**(二重の守り)。
 * 既に入っている値・仕様より前の値・別の経路で入った値が、未ログインの公開ページの `<a href>` に
 * `javascript:` や `data:` のまま出ることを、描く直前に塞ぐ。許すのは**絶対 URL の http / https だけ**
 * (スキームの無い綴りも、相対 URL として自サイトの別のページへ飛ばしかねないので出さない)。
 * 前後の空白は落とし、`URL` として読んで正規化した綴り(スキームは小文字)を返す。ユーザー名やパスワードを含む
 * (`https://信頼できそうな名前@悪意のあるホスト/` の偽装)ものも `null`。
 *
 * @param value - 保存されている URL の文字列(無ければ `null`)
 * @returns 描いてよい URL。描かないなら `null`
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.href;
}

/** 戻り先の相対パスを正規化するための仮のオリジン(結果からはパス・クエリ・フラグメントだけを取る)。 */
const RETURN_PATH_BASE = 'https://return-path.invalid';

/** 制御文字(C0・DEL・C1)。ブラウザは URL の中のタブと改行を黙って落とすので、`/\t/evil.example` が `//evil.example` に化ける。 */
const CONTROL_CHAR = /[\u0000-\u001f\u007f-\u009f]/u;

/**
 * 転送先(戻り先)に使ってよい、**同じオリジンの相対パス**だけを通す(ASVS V3.7.2。点検 8 回目 B8-2)。
 *
 * 「ログイン後に元の画面へ戻す `?next=`」の値をそのまま `redirect()` に渡すと、`?next=https://evil.example` が
 * 開いた転送になる。通すのは `/` で始まるパスだけで、次を拒む(`null`):
 *   - `/` で始まらない綴り(絶対 URL・スキーム `javascript:`・相対の `evil.example`・空)
 *   - `//` と `/\`(プロトコル相対。ブラウザは `\` を `/` と読む)と、パスのどこかの `\`
 *   - 制御文字(タブ・改行はブラウザが落として `//` を作れる)
 *   - 長すぎる値(`URL_MAX_LENGTH` を超える)
 *   - 正規化したパスが `//` で始まる(`/.//evil.example` は `//evil.example` に畳まれる)
 * 返すのは正規化したパス・クエリ・フラグメント(`pathname + search + hash`)である。
 *
 * @param value - 戻り先の候補(利用者の値。無ければ `null`)
 * @returns 転送してよい相対パス。通さないなら `null`
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.length > URL_MAX_LENGTH) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || CONTROL_CHAR.test(value)) return null;
  // ここまでで `/` 始まり・`//` でない・`\\` と制御文字が無いので、仮のオリジンでの解決は例外を投げず、オリジンも変わらない
  // (スキームもホストも書けない形だけが残る)。残る化け方は正規化で `//` に畳まれる形だけで、下の 1 行が拒む。
  const url = new URL(value, RETURN_PATH_BASE);
  const path = `${url.pathname}${url.search}${url.hash}`;
  return path.startsWith('/') && !path.startsWith('//') ? path : null;
}

/**
 * 転送先を決める(安全な転送の部品の共通の核)。`value` が {@link safeReturnPath} を通ればそれを、通らなければ `fallback` を
 * 同じ判定に通して返す。
 *
 * `fallback` は書いた人が決める既定の行き先(`'/'` やログイン画面)であり、それも通らないのは呼び手の書き間違いなので例外にする
 * (外の URL に倒さない。黙って `'/'` にもしない)。
 *
 * @param value - 転送先の候補(利用者の値でも、生成した経路でもよい)
 * @param fallback - 候補が通らないときの行き先(既定は `'/'`)
 * @returns 転送してよい相対パス
 * @throws {Error} `fallback` も同じオリジンの相対パスでないとき
 */
export function safeReturnPathOr(value: string | null | undefined, fallback = '/'): string {
  const path = safeReturnPath(value) ?? safeReturnPath(fallback);
  if (path === null) throw new Error('転送の既定の行き先は同じオリジンの相対パス(`/` で始まり `//` でも `/\\` でもない)で書いてください');
  return path;
}

/** 開発機の接続先として許す自分の機械のホスト名。 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

/**
 * 設定の URL の値が、宣言した `scheme` に合うか。
 *
 * @param value 設定の値
 * @param scheme 宣言したスキームの縛り
 * @returns 合えば true
 */
export function isConfigUrl(value: string, scheme: ConfigUrlScheme): boolean {
  if (matchesUrl(value, 'https')) return true;
  if (scheme === 'https') return false;
  if (!matchesUrl(value, 'http_https')) return false;
  return LOOPBACK_HOSTS.has(new URL(value).hostname);
}

/**
 * 設定カタログの URL の値を読む(起動時 / 読む時点の関門)。
 *
 * 未設定(`undefined` / 空)はそのまま `undefined` を返す(未設定の挙動はカタログの `absence` が持つ)。
 * 値があって宣言した `scheme` に合わなければ例外にする —— **平文の http の送り先を黙って使わない**
 * (ASVS V12.3.1)。**例外の文面に値を入れない**(Webhook の URL は URL 自体が秘密)。
 *
 * @param name 環境変数の名前(例外の文面に使う)
 * @param raw `process.env[name]` の値
 * @param scheme カタログが宣言した `scheme`
 * @returns 合う値。未設定なら `undefined`
 * @throws 値が宣言した `scheme` に合わないとき
 */
export function readConfigUrl(name: string, raw: string | undefined, scheme: ConfigUrlScheme): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (isConfigUrl(raw, scheme)) return raw;
  const allowed = scheme === 'https' ? 'https の絶対 URL' : 'https の絶対 URL(自分の機械への http だけ例外)';
  throw new Error(`環境変数 ${name} は ${allowed}で設定してください(値は表示しません)。`);
}
