/**
 * **Route Handler の出口の関所**(ASVS V3.7.2。点検 10 回目 B10-1)。製品の全部の `route.ts` の口はこれで包む。
 *
 * 規約: docs/rules/process/backend/system/standards/conventions/route-handlers.md §転送は安全な部品だけ
 *
 * 9 回目までの直しは「生の転送の書き方」を ESLint の規則で 1 つずつ拒んだ。綴りを追う規則は兄弟の書き方(小文字の鍵を変数に組む・
 * `headers` を別名に取って `.set` する・表への代入)を毎回取りこぼす。そこで**主の守りを実行時の 1 か所**に移す ——
 * 口が返した応答(と投げた転送の合図)を外へ出す直前に、ここで行き先の見出しを見る。綴りがどうであれ、外へ出る応答は全部ここを通る。
 *
 *   - `Location`(大文字小文字を問わない): 核の {@link safeReturnPath} を通る**同じオリジンの相対パス**だけを通す。例外は口ごとに
 *     宣言した外の行き先(`externalOrigins`。完全なオリジンの閉じた表)だけで、その表は J2 が**認証の `start` の口だけ**に許す
 *     (IdP の認可の URL への 303。値は認証基盤の接続先のオリジン)
 *   - `Refresh`: 仕組みの部品は 1 つも出さないので、**値に関係なく**通さない(閉じた世界)
 *   - 口が投げた転送の合図(Next.js の `redirect()` の `NEXT_REDIRECT`): 合図の行き先を同じ判定に通す
 *   - `Content-Type`(点検 11 回目 B11-3): 閉じた表 {@link ROUTE_RESPONSE_TYPES}(`application/json`・`text/plain`)の型だけを通す。Route Handler の応答には
 *     文書の口の CSP が付かないので、`text/html` などブラウザが文書として開く型は反射 XSS と、`Refresh` の閉世界の外の `<meta refresh>` になる。
 *     本文のある応答に `Content-Type` が無い形も通さない。表の外の型を出せるのは、口が理由つきで宣言した**ダウンロード**だけで、宣言できる型は
 *     {@link ATTACHMENT_RESPONSE_TYPES}(スクリプトを実行しない型)に閉じ、応答は `Content-Disposition: attachment` を要る。HTML を宣言する口は無い
 *
 *   - `Cache-Control`(点検 12 回目 B12-4): 値は閉じた表 {@link ROUTE_CACHE_CONTROLS}(`no-store`)だけを通す。`api/` は前段の no-store の外で、`public, s-maxage=…` は
 *     cookie の口の応答を CDN が別の利用者へ返す形になる。見出しの無い応答はそのまま通す
 *   - 応答の見出しの名前(点検 13 回目 B13-6): 閉じた表 {@link ROUTE_RESPONSE_HEADERS} だけを通す。キャッシュを指示する見出しは CDN ごとに増える(`Expires`・`Edge-Control`・
 *     `X-Accel-Expires`・`CDN-Cache-Control` …)ので、禁止の表をやめて、部品が出す見出しの名前の許可に寄せた
 *
 * 通らなければ、口の応答を捨てて**行き先の無い 500**(`Cache-Control: no-store`・本文なし・応答に載った `Set-Cookie` なし)を返し、セキュリティログに
 * 1 行(行き先は `redirect_refused`・型は `response_type_refused`・キャッシュは `response_cache_refused`。値は載せない)を書く。外へ倒さない・相対パスに直して通すこともしない
 * (書いた人の誤りを隠さない)。
 *
 * **捨てられない cookie**(点検 11 回目 B11-4): `next/headers` の `cookies().set()` の書き込みは、Next.js が口の返した応答に**後から**足す
 * (`app-route/module.js` の `finalizeResponse`)ので、拒否の 500 にも残る。この関所は `Response` を返す部品で、その先に手が届かない。害が出るのは
 * すでに誤った転送を書いた口だけである(本物の Next.js 16.4.2 で実測。BACKLOG に残す)。
 *
 * 配線の検査: 実装の木の全ての `route.ts` の HTTP メソッドの export は `export const GET = guardRoute(…)` の形だけ(J2 が構文木で見る)。
 * 生成の見張りテストは、宣言した全部の口のメソッドが包まれていること({@link isGuardedRoute})と、包みが `Location: https://evil.example`
 * と `text/html` の応答を止めることを実物で叩く。
 *
 * **見ない場所**: Server Component / Server Action の `redirect()` は Route Handler の応答ではない(Next.js が描画の中で転送に直す)ので
 * この関所を通らない。そこは唯一の部品 `safeRedirect`(`@kaninabe/runtime/navigation`)が実行時に同じ核を通し、生の `redirect` は
 * ESLint の `layer/require-safe-redirect` が止める。リクエスト前段(`proxy.ts`)は Route Handler の応答を見られない(前段は口より先に走り、
 * 口の応答を受け取らない。製品の前段の matcher は `api/` を外してもいる)ので、関所にはしない。
 */

import { matchesUrl, safeReturnPath } from '../domain/url.js';
import type { Logger, LogRecord } from '../operation/ports.js';
import { requestIdOf, stdoutLogger } from '../operation/security-log.js';

/** 関所が止めたときのステータス(行き先の無いサーバーの誤り。書いた人の誤りであり、利用者の要求の誤りではない)。 */
export const ROUTE_GUARD_REFUSAL_STATUS = 500;

/** 口ごとの関所の設定。 */
export interface RouteGuardOptions {
  /**
   * 外の行き先として通してよい**完全なオリジン**(`https://auth.example` の形。パス・末尾の `/` は書けない)を返す関数。
   * 要求ごとに読む(接続先は設定から決まる)。J2 が認証の `start` の口にだけ許す。
   */
  readonly externalOrigins?: () => readonly string[];
  /** この口が出すダウンロードの型と、それが要る理由(書いた人の宣言。J2 が字面の形を見る)。 */
  readonly attachmentTypes?: readonly AttachmentTypeDeclaration[];
  /** 止めたことを書く出力口(省略は標準出力)。 */
  readonly logger?: Logger;
}

/** 口ごとのダウンロードの宣言(1 行)。 */
export interface AttachmentTypeDeclaration {
  /** 型({@link ATTACHMENT_RESPONSE_TYPES} のどれか。charset などの付加情報は書かない)。 */
  readonly type: string;
  /** その口がこの型を出す理由(空にしない)。 */
  readonly reason: string;
}

/** 関所が止めた理由(ログの `refusal_code`)。 */
export type RouteGuardRefusal = 'unsafe_location' | 'refresh_header' | 'unsafe_redirect_signal' | 'unsafe_content_type' | 'unsafe_cache_control';

/** 口の応答に通す `Content-Type` の閉じた表(型の部分。`jsonResponse` / `textResponse` が出す 2 つ)。 */
export const ROUTE_RESPONSE_TYPES: readonly string[] = ['application/json', 'text/plain'];

/**
 * 口が宣言すれば出せるダウンロードの型の閉じた表。ブラウザがスクリプトを実行する型(`text/html`・`application/xhtml+xml`・`image/svg+xml`・XML 全般)は
 * 載せない。足すときも実行しない型だけを足す。
 */
export const ATTACHMENT_RESPONSE_TYPES: readonly string[] = ['text/csv', 'application/pdf', 'application/zip', 'application/octet-stream'];

/** 口の応答の `Cache-Control` の閉じた表(部品が出す値は `no-store` だけ)。 */
export const ROUTE_CACHE_CONTROLS: readonly string[] = ['no-store'];

/**
 * 口の応答に載せてよい見出しの名前の閉じた表(小文字。部品と製品の口が出すものの調査から作った)。ここに無い見出しは値に関係なく通さない
 * (どの CDN がキャッシュの指示として読むかを判断していない)。足すときは、キャッシュの指示にならない理由を確かめて足す。
 */
export const ROUTE_RESPONSE_HEADERS: readonly string[] = ['cache-control', 'clear-site-data', 'content-disposition', 'content-type', 'location', 'set-cookie'];

/**
 * 値まで閉じて通す、キャッシュを**止める**見出し(小文字の名前 → 許す値)。認証基盤のクライアントがセッションの cookie の書き込みに添えて渡す 2 本
 * (`@supabase/ssr` の `Expires: 0`・`Pragma: no-cache`)で、ほかの値(`Expires` の先の日付)は表の外と同じに止める。
 */
export const ROUTE_NO_CACHE_HEADERS: Readonly<Record<string, string>> = { expires: '0', pragma: 'no-cache' };

/** `Content-Type` の許す綴り: `型/副型` と、あれば `charset` 1 つ(`,` を含まない = 2 本が畳まれた値は通らない。ブラウザは畳んだ値の後ろの型を読む)。 */
const CONTENT_TYPE_SHAPE = /^\s*([a-z0-9.+-]+\/[a-z0-9.+-]+)\s*(?:;\s*charset=[a-z0-9-]+\s*)?$/iu;

/** ダウンロードの見出しの綴り(`attachment` か、`attachment; filename=…`)。 */
const ATTACHMENT_DISPOSITION = /^\s*attachment\s*(?:;|$)/iu;

/**
 * 包んだ口に付ける印(見張りテストが「包まれているか」を問う)。`Symbol.for` の登録簿の鍵にするので、テストがモジュールを読み込み直して
 * この部品の写しが 2 つになっても同じ印を読める(モジュールごとの `WeakSet` だと、写しの間で答えが食い違う)。
 */
const GUARDED_MARK: unique symbol = Symbol.for('@kaninabe/runtime/http/route-guard#guarded') as never;

/** Next.js の転送の合図の印(`digest` の先頭)。 */
const REDIRECT_SIGNAL = 'NEXT_REDIRECT;';

/**
 * 外の行き先の表の 1 行が完全なオリジンか(`new URL(値).origin` と綴りが一致する http / https)。
 *
 * @param origin - 表の 1 行
 * @returns 完全なオリジンなら true
 */
export function isExactOrigin(origin: string): boolean {
  if (!matchesUrl(origin, 'http_https')) return false;
  return new URL(origin).origin === origin;
}

/** 宣言した外の行き先の表(完全なオリジン)か、それを要るときにだけ読む関数。 */
export type ExternalOrigins = readonly string[] | (() => readonly string[]);

/**
 * `Location` の値が出してよい行き先か。外の行き先の表は、値が相対パスでないときにだけ読む(表は設定から作るので、
 * 相対パスの転送や転送の無い応答・拒否の応答で設定に触れない)。
 *
 * @param value - 見出しの値
 * @param externalOrigins - 宣言した外の行き先(完全なオリジン)
 * @returns 同じオリジンの相対パスか、宣言した外のオリジンの絶対 URL なら true
 */
export function locationAllowed(value: string, externalOrigins: ExternalOrigins): boolean {
  if (safeReturnPath(value) !== null) return true;
  if (!matchesUrl(value, 'http_https')) return false;
  const origins = typeof externalOrigins === 'function' ? externalOrigins() : externalOrigins;
  return origins.includes(new URL(value).origin);
}

/**
 * 応答の見出しを判定する(`Location` / `Refresh` を大文字小文字を問わず全部見る)。
 *
 * @param headers - 応答の見出し
 * @param externalOrigins - 宣言した外の行き先
 * @returns 止める理由(通すなら null)
 */
export function redirectHeadersVerdict(headers: Headers, externalOrigins: ExternalOrigins): RouteGuardRefusal | null {
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    if (lower === 'refresh') return 'refresh_header';
    if (lower === 'location' && !locationAllowed(value, externalOrigins)) return 'unsafe_location';
  }
  return null;
}

/**
 * 応答の `Content-Type` が閉じた表の中か。
 *
 * 通すのは ①見出しが無く本文も無い応答(転送・204) ②{@link ROUTE_RESPONSE_TYPES} の型 ③口が宣言した {@link ATTACHMENT_RESPONSE_TYPES} の型で、
 * `Content-Disposition: attachment` を持つ応答。ほか(本文があるのに見出しが無い・表の外の型・2 本の畳み込み・`charset` 以外の付加情報)は全部止める。
 *
 * @param response - 応答
 * @param attachmentTypes - 口が宣言したダウンロードの型
 * @returns 通すなら true
 */
export function contentTypeAllowed(response: Response, attachmentTypes: readonly AttachmentTypeDeclaration[] = []): boolean {
  const value = response.headers.get('content-type');
  if (value === null) return response.body === null;
  const type = CONTENT_TYPE_SHAPE.exec(value)?.[1]?.toLowerCase();
  if (type === undefined) return false;
  if (ROUTE_RESPONSE_TYPES.includes(type)) return true;
  if (!ATTACHMENT_RESPONSE_TYPES.includes(type)) return false;
  if (!attachmentTypes.some((declared) => declared.type === type && declared.reason.trim() !== '')) return false;
  return ATTACHMENT_DISPOSITION.test(response.headers.get('content-disposition') ?? '');
}

/**
 * 応答の見出しの名前が閉じた表の中で、`Cache-Control` の値も閉じた表の中か。`Cache-Control` の無い応答は通す(2 本の畳み込みは `,` を含むので表に当たらない)。
 *
 * @param headers - 応答の見出し
 * @returns 通すなら true
 */
export function cacheHeadersAllowed(headers: Headers): boolean {
  for (const [name, text] of headers) {
    const lower = name.toLowerCase();
    if (!ROUTE_RESPONSE_HEADERS.includes(lower) && (!Object.hasOwn(ROUTE_NO_CACHE_HEADERS, lower) || ROUTE_NO_CACHE_HEADERS[lower] !== text.trim().toLowerCase())) return false;
  }
  const value = headers.get('cache-control');
  return value === null || ROUTE_CACHE_CONTROLS.includes(value.trim().toLowerCase());
}

/**
 * 投げられた値が Next.js の転送の合図なら、その行き先を返す(合図でなければ null)。
 *
 * 合図の綴りは `NEXT_REDIRECT;{種類};{行き先};{ステータス};`(行き先は `;` を含みうるので、頭の 2 つと末尾の 2 つを除いた残り)。
 * 綴りが崩れていれば空文字を返す(判定で止まる。fail-closed)。
 *
 * @param error - 投げられた値
 * @returns 行き先(合図でなければ null)
 */
export function redirectSignalTarget(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return null;
  const digest = (error as { readonly digest: unknown }).digest;
  if (typeof digest !== 'string' || !digest.startsWith(REDIRECT_SIGNAL)) return null;
  return digest.split(';').slice(2, -2).join(';');
}

/**
 * 止めたことの 1 行(行き先の値も型の値も載せない。利用者の値・秘密の URL でありうる)。
 *
 * @param refusal - 止めた理由
 * @param requestId - 要求の識別子
 * @returns ログの 1 行
 */
export function routeGuardRecord(refusal: RouteGuardRefusal, requestId: string | null): LogRecord {
  const event = refusal === 'unsafe_content_type' ? 'response_type_refused' : refusal === 'unsafe_cache_control' ? 'response_cache_refused' : 'redirect_refused';
  return { level: 'warn', security_event: event, refusal_code: refusal, request_id: requestId };
}

/**
 * 止めた応答(行き先なし・本文なし・`Set-Cookie` なし・キャッシュの禁止)。`cookies()` の書き込みは Next.js が後から足す(冒頭の注釈)。
 *
 * @returns 応答
 */
function refusal(): Response {
  return new Response(null, { status: ROUTE_GUARD_REFUSAL_STATUS, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * 外の行き先の表を読む関数を作る(読むのは要るときだけ。判定は 1 回の応答で高々 1 回読む。1 行でも完全なオリジンでなければ書いた人の誤りとして例外)。
 *
 * @param options - 口の設定
 * @returns 表を返す関数
 */
function externalOriginsOf(options: RouteGuardOptions): () => readonly string[] {
  return () => {
    const origins = options.externalOrigins?.() ?? [];
    if (!origins.every(isExactOrigin)) throw new Error('externalOrigins は完全なオリジン(https://host[:port] の形。パスも末尾の / も無い)だけを並べてください');
    return origins;
  };
}

/**
 * Route Handler の口を包む(出口の関所)。
 *
 * 外の行き先の表は、口の応答が相対パスでない `Location` を持つときにだけ読む(拒否の応答・相対パスの転送では設定に触れない —
 * 出どころの関門で閉じる要求が設定を読まないことを、生成の見張りテストが観測する)。表の行が完全なオリジンでなければ例外(書いた人の誤り)。
 *
 * @param handler - 口の本体(`(request, context) => Response`)
 * @param options - 外の行き先の表(認証の `start` の口だけ)・ダウンロードの宣言・出力口
 * @returns 同じ形の口(返す応答と投げる転送の合図は全部関所を通る)
 * @throws {Error} 外の行き先の表に完全なオリジンでない行があり、それを読む必要が生じたとき
 */
export function guardRoute<R extends Request, A extends readonly unknown[]>(
  handler: (request: R, ...rest: A) => Response | Promise<Response>,
  options: RouteGuardOptions = {},
): (request: R, ...rest: A) => Promise<Response> {
  const guarded = async (request: R, ...rest: A): Promise<Response> => {
    const origins = externalOriginsOf(options);
    const refuse = (reason: RouteGuardRefusal): Response => {
      (options.logger ?? stdoutLogger).write(routeGuardRecord(reason, requestIdOf(request.headers)));
      return refusal();
    };
    let response: Response;
    try {
      response = await handler(request, ...rest);
    } catch (error) {
      const target = redirectSignalTarget(error);
      if (target !== null && !locationAllowed(target, origins)) return refuse('unsafe_redirect_signal');
      throw error;
    }
    const verdict = redirectHeadersVerdict(response.headers, origins);
    if (verdict !== null) return refuse(verdict);
    if (!contentTypeAllowed(response, options.attachmentTypes)) return refuse('unsafe_content_type');
    return cacheHeadersAllowed(response.headers) ? response : refuse('unsafe_cache_control');
  };
  Object.defineProperty(guarded, GUARDED_MARK, { value: true });
  return guarded;
}

/**
 * 値が {@link guardRoute} で包んだ口か(生成の見張りテストが、宣言した口の全メソッドに問う)。
 *
 * @param value - 口の export
 * @returns 包んだ口なら true
 */
export function isGuardedRoute(value: unknown): boolean {
  return typeof value === 'function' && (value as unknown as Record<symbol, unknown>)[GUARDED_MARK] === true;
}
