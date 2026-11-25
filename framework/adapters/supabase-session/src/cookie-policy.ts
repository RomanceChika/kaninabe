/**
 * **認証の cookie の約束**(名前・属性)の唯一の置き場。
 *
 * 設計: 設計メモ「サーバーだけがセッションを持つ形」 §6-1(案 A。ASVS V3.3.1 / V3.3.3 / V3.3.4 / V10.1.1)
 *
 * アプリが書く認証の cookie(セッション・PKCE の検証子・サインインの往復で運ぶ値)は、**どれもこの約束で書く**:
 *
 * | 項目 | 値 | 理由 |
 * |---|---|---|
 * | 名前 | `__Host-` で始める | ブラウザは「`Secure` あり・`Path=/`・`Domain` なし」でなければ受け付けない。サブドメインからの上書きを防ぐ(V3.3.1 / V3.3.3) |
 * | `HttpOnly` | 付ける | ページのスクリプトから読めない(V3.3.4)。トークンを持ち出す経路を消す |
 * | `Secure` | 付ける | `__Host-` の条件でもある |
 * | `SameSite` | `Lax` | OAuth の帰り道は別のサイトからの画面の遷移で来るので `Strict` にできない |
 * | `Path` / `Domain` | `/` / 付けない | `__Host-` の条件 |
 * | 寿命 | ライブラリの値のまま(PKCE の検証子だけは 10 分に縮める) | 実際の寿命は認証基盤のセッションの設定が決める。検証子は OAuth の往復のあいだだけ要る |
 *
 * ライブラリ(`@supabase/ssr`)が渡してくる属性は**寿命(`maxAge` / `expires`)だけを拾い、残りは上の値で上書きする**
 * (`hardenedOptions`)。書き手がこのパッケージの中にしか居ないので、属性の食い違いが起きない。
 *
 * **手元の実測(S0。2026-10-20・Chromium 151 の headless shell)**: `http://127.0.0.1` でも `__Host-` + `Secure` の cookie は
 * `Set-Cookie`(200 と 303 の両方)で受け付けられ、`document.cookie` からは見えない。Playwright の `addCookies` は
 * `url` の形だと拒まれ(`Domain` が付くため)、`domain` + `path: '/'` の形なら受け付けられる。
 *
 * このファイルは `@supabase/ssr` を読まない(テストの道具が cookie の名前と属性だけを引けるように、別の口 `./cookie-policy` で配る)。
 */

/** `__Host-` の接頭辞(ブラウザが属性の条件を執行する)。 */
export const HOST_PREFIX = '__Host-';

/** セッションの cookie の名前(分割は `.0` `.1` …、検証子は `-code-verifier` などがこの後ろに続く)。 */
export const SESSION_COOKIE_NAME = `${HOST_PREFIX}auth`;

/** 寿命以外の属性(すべての認証の cookie に同じ値を付ける)。 */
export const AUTH_COOKIE_ATTRIBUTES = Object.freeze({
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
} as const);

/** 認証の cookie の属性(寿命は任意)。 */
export interface AuthCookieOptions {
  readonly path: '/';
  readonly httpOnly: true;
  readonly secure: true;
  readonly sameSite: 'lax';
  /** 寿命(秒)。0 は消去。 */
  readonly maxAge?: number;
  /** 期限の日時。 */
  readonly expires?: Date;
}

/** 書く cookie 1 本(名前・値・約束どおりの属性)。 */
export interface CookieWrite {
  readonly name: string;
  readonly value: string;
  readonly options: AuthCookieOptions;
}

/** ライブラリが渡してくる属性のうち、ここが拾う寿命の 2 つ(ほかの欄は読まない)。 */
export interface LifetimeOptions {
  readonly maxAge?: number | undefined;
  readonly expires?: Date | undefined;
}

/**
 * ライブラリが渡した属性から寿命だけを拾い、約束の属性で上書きする。
 *
 * @param options - ライブラリが渡した属性(`httpOnly: false` などが来ても上書きする)
 * @returns 約束どおりの属性
 */
export function hardenedOptions(options: LifetimeOptions): AuthCookieOptions {
  return {
    ...AUTH_COOKIE_ATTRIBUTES,
    ...(options.maxAge === undefined ? {} : { maxAge: options.maxAge }),
    ...(options.expires === undefined ? {} : { expires: options.expires }),
  };
}

/**
 * PKCE の検証子の cookie の寿命の上限(秒)。OAuth の往復(プロバイダで許可して戻ってくるまで)に足りる 10 分。
 *
 * ライブラリは検証子にもセッションと同じ寿命(既定 400 日)を付けるので、ここで縮める。帰り道は交換したあと検証子を消すが、
 * 戻ってこなかった往復の検証子が 400 日残ると、使われない秘密が端末に溜まる。
 */
export const VERIFIER_MAX_AGE_SECONDS = 10 * 60;

/** 検証子の系列の名前の終わり(`-code-verifier`。`-flows-code-verifier` / `-flow-{id}-code-verifier` も同じ終わり)。 */
const VERIFIER_SUFFIX = '-code-verifier';

/**
 * 分割の接尾辞(`.0` `.1` …)。ライブラリ(`@supabase/ssr` の `utils/chunker.js` の `CHUNK_LIKE_REGEX`)が
 * 大きな値を `{名前}.{番号}` に分けて書くときの綴りと同じ形(先頭の 0 は `.0` だけ)。
 */
const CHUNK_SUFFIX = /\.(?:0|[1-9][0-9]*)$/;

/**
 * 分割の接尾辞を外した**系列の名前**(`__Host-auth-code-verifier.0` → `__Host-auth-code-verifier`)。分割されていなければそのまま。
 *
 * @param name - cookie の名前
 * @returns 系列の名前
 */
function seriesName(name: string): string {
  return name.replace(CHUNK_SUFFIX, '');
}

/**
 * PKCE の検証子の系列の cookie か(分割された 1 本 `….code-verifier.0` も含む)。
 *
 * 0.12.7 の `@supabase/ssr` では、検証子の値(16 進 112 文字 + 印。JSON と base64url で約 170 文字)も、待っている往復の索引
 * (`-flows-code-verifier`。往復の ID 32 文字 × 上限 5 本で約 240 文字)も、分割の閾値(`MAX_CHUNK_SIZE` = 3180)に届かないので
 * 分割されない。それでも分割の接尾辞を外してから見る —— 依存の版が上がって値が伸びたときに、分割された検証子だけが
 * ライブラリの寿命(400 日)のまま残る形を、名前の判定の側で塞いでおく。
 *
 * @param name - cookie の名前
 * @returns 検証子の系列なら true
 */
function isVerifierCookieName(name: string): boolean {
  return seriesName(name).endsWith(VERIFIER_SUFFIX);
}

/**
 * 検証子の書き込みなら寿命を上限までに縮める(消去の書き込み = 値が空・寿命 0 はそのまま)。
 *
 * @param name - cookie の名前
 * @param value - 値
 * @param options - 約束どおりの属性
 * @returns 寿命を縮めた属性(検証子でなければそのまま)
 */
function boundedLifetime(name: string, value: string, options: AuthCookieOptions): AuthCookieOptions {
  if (!isVerifierCookieName(name) || value === '' || options.maxAge === 0) return options;
  // 期限の日時(`expires`)は落とし、寿命(`maxAge`)だけで縛る。
  return { ...AUTH_COOKIE_ATTRIBUTES, maxAge: Math.min(options.maxAge ?? VERIFIER_MAX_AGE_SECONDS, VERIFIER_MAX_AGE_SECONDS) };
}

/**
 * 名前が `__Host-` で始まらない書き込みはプログラムの誤りとして止める(属性の約束を名前の側からも守る)。
 * PKCE の検証子は寿命を {@link VERIFIER_MAX_AGE_SECONDS} までに縮める。
 *
 * @param name - cookie の名前
 * @param value - 値
 * @param options - ライブラリの属性(寿命だけ拾う)
 * @returns 約束どおりの書き込み
 * @throws 名前が `__Host-` で始まらないとき
 */
export function cookieWrite(name: string, value: string, options: LifetimeOptions): CookieWrite {
  if (!name.startsWith(HOST_PREFIX)) {
    throw new Error(`認証の cookie ${name} は ${HOST_PREFIX} で始まる名前で書きます(cookie-policy.ts)`);
  }
  return { name, value, options: boundedLifetime(name, value, hardenedOptions(options)) };
}

/**
 * 消す書き込み(値を空にし、寿命 0)。
 *
 * @param name - 消す cookie の名前
 * @returns 消去の書き込み
 */
export function expiredCookie(name: string): CookieWrite {
  return cookieWrite(name, '', { maxAge: 0 });
}

/**
 * セッションの系列の cookie か(本体・分割・検証子)。
 *
 * @param name - cookie の名前
 * @returns 系列に属するなら true
 */
export function isSessionCookieName(name: string): boolean {
  return name === SESSION_COOKIE_NAME || name.startsWith(`${SESSION_COOKIE_NAME}.`) || name.startsWith(`${SESSION_COOKIE_NAME}-`);
}

/**
 * 移行前の既定の名前(`sb-{ref}-auth-token` と、その分割・検証子)。スクリプトから読める属性で書かれていたので、
 * 見つけたら消す(放っておくと、更新トークンが 400 日のあいだスクリプトから読める場所に残る)。
 */
const LEGACY_SESSION_COOKIE = /^sb-[^.;=\s]+-auth-token(?:\.\d+|-code-verifier)?$/;

/**
 * 移行前の既定の名前の cookie か。
 *
 * @param name - cookie の名前
 * @returns 移行前の名前なら true
 */
export function isLegacySessionCookieName(name: string): boolean {
  return LEGACY_SESSION_COOKIE.test(name);
}

/**
 * サインインの往復で運ぶ値の cookie の宣言(例: 招待の着地から来た人の招待コード)。
 *
 * 値は**サインインの開始の口がフォームの本文から受け取り**、この約束の属性で書く。帰り道が読み終えたら消す。
 */
export interface CarryCookieSpec {
  /** cookie の名前(`__Host-` で始め、セッションの系列と重ねない)。 */
  readonly name: string;
  /** 開始の口が値を読むフォームの欄の名前。 */
  readonly field: string;
  /** 寿命(秒)。OAuth の往復に足りる長さにする。 */
  readonly maxAgeSeconds: number;
  /** 受け付ける値の長さの上限(超えたら開始の口が 400 を返す)。 */
  readonly maxLength: number;
  /**
   * 受け付ける値の形(`^…$` で全体を縛る正規表現。最上位の `|` は `(?:…)` で包み、`g` / `y` / `m` / `s` の旗は持たない)。開始の口は形の外の値を 400 で断り、帰り道は形の外の cookie を
   * 無いものとして読む(`carriedValue`)。cookie は利用者が書き換えられるので、書いたときの検査だけでは足りない(点検 19 回目 O19-3)。
   */
  readonly pattern: RegExp;
}

/**
 * 運ぶ値の cookie の宣言が約束を守っているか(名前が `__Host-` で始まり、セッションの系列と重ならず、寿命と上限が正)。
 *
 * @param spec - 宣言
 * @throws 守っていないとき(プログラムの誤り)
 */
export function assertCarrySpec(spec: CarryCookieSpec): void {
  const valid =
    spec.name.startsWith(HOST_PREFIX) &&
    !isSessionCookieName(spec.name) &&
    spec.field !== '' &&
    Number.isInteger(spec.maxAgeSeconds) &&
    spec.maxAgeSeconds > 0 &&
    Number.isInteger(spec.maxLength) &&
    spec.maxLength > 0 &&
    bindsWhole(spec.pattern);
  if (!valid) {
    throw new Error(
      `サインインの往復で運ぶ値の cookie ${spec.name} の宣言が約束を守っていません(${HOST_PREFIX} で始め、${SESSION_COOKIE_NAME} の系列と重ねず、寿命と上限は正の整数、形は ^…$ で全体を縛り(最上位の | は (?:…) で包む)g / y / m / s の旗を持たない)`,
    );
  }
}

/** 全体を縛る約束を崩す旗(`g` / `y` は照合の位置を持ち越し、`m` は `^` / `$` を行の境にも当て、`s` は `.` を改行にも当てる)。 */
const UNBINDING_FLAGS = /[gyms]/u;

/**
 * 形が値の**全体**を縛るか(点検 20 回目 B20-2)。字面の先頭の `^` と末尾の `$` だけを見ると、最上位の `|`(`^a|b$` は `^a` か `b$`)と
 * `m` の旗(行の境)を通していた。正規表現の源を左から読み、`^` が最初の文字・`$` が最後の文字(エスケープされていない)で、
 * 文字の集合(`[…]`)と括弧の外に `|` が無いことを確かめる。選言は `^(?:a|b)$` と包む。
 *
 * @param pattern - 宣言の形
 * @returns 全体を縛るなら true
 */
function bindsWhole(pattern: RegExp): boolean {
  const { source } = pattern;
  if (UNBINDING_FLAGS.test(pattern.flags) || !source.startsWith('^') || !source.endsWith('$') || source.length < 2) return false;
  let depth = 0;
  let inClass = false;
  for (let index = 1; index < source.length - 1; index += 1) {
    const char = source[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (inClass) {
      if (char === ']') inClass = false;
      continue;
    }
    if (char === '[') inClass = true;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === '|' && depth === 0) return false;
  }
  // 末尾の `$` の直前がエスケープの `\` なら、それは字の `$`(上の読みが最後の文字まで食い込む)。
  let backslashes = 0;
  for (let index = source.length - 2; index >= 0 && source[index] === '\\'; index -= 1) backslashes += 1;
  return depth === 0 && !inClass && backslashes % 2 === 0;
}

/**
 * 運ぶ値を、宣言の長さと形に合うときだけ返す(合わない値・無い値は `null`)。帰り道が cookie を読むときと、開始の口がフォームを読むときの共通の判定。
 *
 * @param value - cookie かフォームの値
 * @param spec - 運ぶ値の宣言
 * @returns 宣言に合う値、合わなければ `null`
 */
export function carriedValue(value: string | null | undefined, spec: CarryCookieSpec): string | null {
  if (value === null || value === undefined || value.length > spec.maxLength || !spec.pattern.test(value)) return null;
  return value;
}
