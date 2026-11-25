/**
 * サーバーの Supabase クライアント(cookie にセッションを持つ)の**唯一の作り方**と、リクエスト前段の更新。
 *
 * 設計: 設計メモ「サーバーだけがセッションを持つ形」 §6-1 / §6-3
 *
 * ブラウザのクライアントは使わない(案 A)。cookie を読み書きするのはサーバーだけで、ブラウザは cookie を運ぶだけになる。
 * ここで作るクライアントは、cookie の名前を約束(`__Host-auth`)にし、**ライブラリが書こうとする cookie の属性を、
 * 書き手(`CookieJar`)に渡す前に必ず約束の値で上書きする**(`cookie-policy.ts`)。製品の側は Next.js のつなぎ
 * (`NextRequest` の cookie・`cookies()`)を `CookieJar` の形で渡すだけで、属性を選ぶ場所を持たない。
 *
 * `setAll` の 2 つ目の引数(キャッシュを止めるヘッダ。`Cache-Control: private, no-cache, no-store, …`)も、
 * そのまま書き手へ渡す —— cookie を書いた応答を CDN に共有させない(ほかの人のトークンが配られる)ために、
 * 書き手は応答にこのヘッダを付ける(§1-6 の 1)。
 *
 * **読めないは未ログインではない**(点検 15 回目 O15-2。実測)。アクセストークンが切れた直後の並列の要求は、同じ更新トークンで更新の口へ同時に行き、認証基盤が `409 conflict` を返す。
 * ライブラリは 409 を「更新トークンが死んだ」と同じに扱って cookie を消すので、有効な利用者が 307 `/login` になり、ほかの応答が cookie を書き戻さなければログアウトする。
 * だから更新の口の答えは `unavailableUnlessSignedOut`(`refresh-guard.ts`)が閉じた形だけ「今は答えられない」(503)に読み替え、利用者の解決は `signedInUserOf` が閉じた表で読み分ける。
 */

import { safeFetch } from '@kaninabe/runtime/http/safe-fetch';
import { createServerClient } from '@supabase/ssr';
import { AuthApiError, isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';
import type { ReadOnlyClient } from '@kaninabe/adapter-postgrest';
import type { PostgrestQueryBuilder, SupabaseClient } from '@supabase/supabase-js';
import { AUTH_COOKIE_ATTRIBUTES, SESSION_COOKIE_NAME, cookieWrite, isLegacySessionCookieName } from './cookie-policy';
import type { CookieWrite } from './cookie-policy';
import { REFRESH_EXHAUSTED_CODE, createRefreshBudget, unavailableUnlessSignedOut } from './refresh-guard';
import type { RefreshBudget } from './refresh-guard';
import { coalescedRefresh } from './refresh-share';
import { admitWrites, createSessionScope } from './session-scope';
import type { SessionScope } from './session-scope';

/** 認証基盤の接続先(URL と公開の鍵)。`fetch` はテストが差し替える口(省略は `safeFetch` = 転送について行かない `fetch`。ASVS V15.3.2)。 */
export interface AuthEndpoint {
  readonly url: string;
  readonly anonKey: string;
  readonly fetch?: typeof fetch;
}

/** 要求に載っていた cookie 1 本。 */
export interface RequestCookie {
  readonly name: string;
  readonly value: string;
}

/**
 * cookie の読み書きの口(製品の側が Next.js のつなぎとして渡す)。
 *
 * `setAll` が受け取る書き込みは**すでに約束の属性になっている**。書き手はそのまま応答に載せ、`headers` も応答に付ける。
 */
export interface CookieJar {
  /** 要求の cookie を全部返す。 */
  getAll(): readonly RequestCookie[];
  /** 書き込み(約束どおり)と、応答に付けるヘッダをまとめて受け取る。 */
  setAll(writes: readonly CookieWrite[], headers: Readonly<Record<string, string>>): void;
}

/** 製品の DB の型が持つスキーマ名。 */
type SchemaNameOf<Database> = string & keyof Omit<Database, '__InternalSupabase'>;

/** 接続層が見るスキーマの型(Supabase の型引数の 4 つ目)。 */
type SchemaOf<Database, SchemaName extends SchemaNameOf<Database>> =
  SupabaseClient<Database, SchemaName> extends SupabaseClient<Database, SchemaName, SchemaName, infer Schema> ? Schema : never;

/** 接続層の型の付け方(Supabase の型引数の 5 つ目)。 */
type OptionsOf<Database, SchemaName extends SchemaNameOf<Database>> =
  SupabaseClient<Database, SchemaName> extends SupabaseClient<Database, SchemaName, SchemaName, SchemaOf<Database, SchemaName>, infer Options> ? Options : never;

/** 表名 → その表の `from(表)` が返す問い合わせの組み立ての型(読み取りだけの接続層 `ReadOnlyClient` に渡す)。 */
type BuildersOf<Database, SchemaName extends SchemaNameOf<Database>> = {
  readonly [N in string & keyof SchemaOf<Database, SchemaName>['Tables']]: PostgrestQueryBuilder<
    OptionsOf<Database, SchemaName>,
    SchemaOf<Database, SchemaName>,
    SchemaOf<Database, SchemaName>['Tables'][N],
    N
  >;
};

/**
 * **セッションの接続層の型**(読み取りだけ。差分点検 fix26 13 回目 D26m-1)。絞りの規則の持ち主は `@kaninabe/adapter-postgrest` の `ReadOnlyClient`
 * (`rpc`・`schema` を出さず、`from` は `select` だけ)で、ここは Supabase の具体の型をそれに渡すだけである。製品の接続層の型もこれを呼ぶ。
 */
export type SessionClient<Database, SchemaName extends SchemaNameOf<Database>> = ReadOnlyClient<SupabaseClient<Database, SchemaName>, BuildersOf<Database, SchemaName>>;

/** クライアントの追加の設定(製品のスキーマ名)。 */
export interface SessionClientOptions<SchemaName extends string> {
  readonly db?: { readonly schema: SchemaName };
  /** この要求の更新の予算(同じ要求のクライアントで分ける。省略はこのクライアントだけの予算)。`scope` を渡すときは使わない(台帳が予算を持つ)。 */
  readonly refreshBudget?: RefreshBudget;
  /**
   * この要求の段の台帳(同じ要求の段のクライアントで分ける。`session-scope.ts`)。省略は**後段**の台帳をこのクライアントだけに作る ——
   * 後段は、要求の cookie のアクセストークンが本当に生きている間は更新しない。期限の手前の更新は前段(`refreshSession`)だけがする。
   */
  readonly scope?: SessionScope;
}

/**
 * 「ログインしていない」と言い切ってよい認証基盤の答えの閉じた表(`error_code`)。**ここに無い答えは全部「読めない」**である(`SessionUnreadableError`)。
 *
 * 行を足すのは、その答えが「このセッションは今後も通らない」と言えるときだけ。5xx・429・通信の失敗・更新の競合(409)は載せない(有効な利用者を未ログインと言うことになる)。
 * 行は本物の認証基盤(GoTrue v2.196.0)の答えで確かめた(壊れた cookie の `validation_failed`・`bad_jwt`・`session_not_found`・`user_banned`・`user_not_found` など。点検 15 回目 O15-2)。
 */
const SIGNED_OUT_ERROR_CODES: readonly string[] = ['bad_jwt', 'no_authorization', 'refresh_token_already_used', 'refresh_token_not_found', 'session_expired', 'session_not_found', 'user_banned', 'user_not_found', 'validation_failed'];

/** セッションを読めなかった(認証基盤が答えなかった)。**未ログインでも、ログイン済みでもない。** 関門はこれを握らず、要求を失敗で終える。 */
export class SessionUnreadableError extends Error {
  /** 認証基盤の答えの種類(エラーの名前)。利用者の値を含まない。 */
  readonly reason: string;

  constructor(reason: string) {
    super(`セッションを読めません(${reason})`);
    this.name = 'SessionUnreadableError';
    this.reason = reason;
  }
}

/** `getUser` の結果のうち、ここが読む部分。 */
export interface UserReadResult<User> {
  readonly data: { readonly user: User | null };
  readonly error?: unknown;
}

/**
 * `auth.getUser()` の結果を、ログイン済み / 未ログイン / 読めない に読み分ける。**読めない形を未ログインにも、ログイン済みにもしない**(閉じる側)。
 *
 * @param result - `auth.getUser()` の結果
 * @returns ログイン済みなら利用者、未ログインと言い切れるなら `null`
 * @throws {SessionUnreadableError} 認証基盤が答えなかった(5xx・通信の失敗・表の外の答え)
 */
export function signedInUserOf<User>(result: UserReadResult<User>): User | null {
  const { data, error } = result;
  if (data.user !== null) return data.user;
  if (error === null || error === undefined || isAuthSessionMissingError(error)) return null;
  if (isAuthApiError(error) && error.code !== undefined && SIGNED_OUT_ERROR_CODES.includes(error.code)) return null;
  throw new SessionUnreadableError(error instanceof Error ? error.name : 'unknown');
}

/**
 * cookie にセッションを持つサーバーのクライアントを作る。
 *
 * @param server - 接続先
 * @param jar - cookie の読み書きの口
 * **返す型は読み取りだけの接続層**({@link SessionClient}。絞りの規則は `@kaninabe/adapter-postgrest` の `ReadOnlyClient`。差分点検 fix26 13 回目 D26m-1): `rpc`・`schema`・`from` の書き込みを出さない。
 * RPC と表の書き込みの道はやり直しの口(`retryRollbacks` / `retryTableWrites`)だけで、セッションのクライアントからそれを素通りする道を型の上に作らない。
 *
 * @param options - スキーマ名など
 * @returns クライアント(業務データの読み取りに使う。RLS は要求のセッションで効く)
 */
export function createSessionClient<Database, SchemaName extends string & keyof Omit<Database, '__InternalSupabase'>>(
  server: AuthEndpoint,
  jar: CookieJar,
  options: SessionClientOptions<SchemaName> = {},
): SessionClient<Database, SchemaName> {
  const scope = options.scope ?? createSessionScope({ stage: 'downstream', budget: options.refreshBudget ?? createRefreshBudget() });
  const { budget } = scope;
  const client = createServerClient<Database, SchemaName>(server.url, server.anonKey, {
    ...(options.db === undefined ? {} : { db: options.db }),
    // 下から: 認証基盤 ← 段と表で 1 本に寄せる(`refresh-share.ts`) ← 答えの読み替えと予算(`refresh-guard.ts`)。
    global: { fetch: unavailableUnlessSignedOut(coalescedRefresh(server.fetch ?? safeFetch, scope, () => jar.getAll()), budget) },
    cookieOptions: { name: SESSION_COOKIE_NAME, ...AUTH_COOKIE_ATTRIBUTES },
    cookies: {
      getAll: () => jar.getAll().map(({ name, value }) => ({ name, value })),
      setAll: (cookiesToSet, headers) => {
        // 予算が尽きた答えでライブラリはセッションを手放すが、死を言い切っていないので cookie は消さない(閉じる側 = 読めないで終える)。
        if (budget.exhausted) return;
        // 世代で比べる: 段の中で最後に書いたものより新しいセッションだけが勝つ(古い世代・要求の cookie の書き戻しは捨てる)。
        const admitted = admitWrites(
          scope,
          cookiesToSet.map(({ name, value, options: written }) => cookieWrite(name, value, written)),
        );
        if (admitted.length > 0) jar.setAll(admitted, headers);
      },
    },
  });
  // ライブラリが手放したあとの `getUser` は「セッションが無い」と答える。尽きた要求で未ログインに化けさせない。
  const getUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = async (jwt) => {
    const result = await getUser(jwt);
    return budget.exhausted && result.data.user === null ? { data: { user: null }, error: new AuthApiError(REFRESH_EXHAUSTED_CODE, 400, REFRESH_EXHAUSTED_CODE) } : result;
  };
  // 型の絞り(rpc・schema・from の書き込みを外す)。実行時の値は同じクライアントで、外した道はやり直しの口が実クライアントから作る。
  const narrowed: unknown = client;
  return narrowed as SessionClient<Database, SchemaName>;
}

/**
 * 移行前の既定の名前の cookie を消す書き込み(属性は約束どおり。消すだけなので名前の接頭辞は問わない)。
 *
 * @param cookies - 要求の cookie
 * @returns 消去の書き込み(移行前の名前が無ければ空)
 */
export function legacyCookieRemovals(cookies: readonly RequestCookie[]): CookieWrite[] {
  return cookies
    .filter((cookie) => isLegacySessionCookieName(cookie.name))
    .map((cookie) => ({ name: cookie.name, value: '', options: { ...AUTH_COOKIE_ATTRIBUTES, maxAge: 0 } }));
}

/**
 * リクエスト前段の更新: アクセストークンを検証し、期限切れなら更新して、新しい cookie とキャッシュ止めのヘッダを書き手へ渡す。
 * 移行前の名前の cookie が残っていれば、同じ書き手で消す。
 *
 * **関門ではない**(ログインの有無を判定しない。未ログインを弾くのは画面の側、読めるかを決めるのは DB)。読めなかった(認証基盤が答えなかった)ときも何もせず通す: 判定は画面の側が同じ読み分け(`signedInUserOf`)でする。
 *
 * @param server - 接続先
 * @param jar - cookie の読み書きの口
 * @param budget - この要求の更新の予算(尽きたかを呼び手が見て、後続の読みに伝える)
 * @returns 完了
 */
export async function refreshSession(server: AuthEndpoint, jar: CookieJar, budget: RefreshBudget = createRefreshBudget()): Promise<void> {
  // 前段の台帳: 期限の手前の更新(ライブラリの余裕による前倒し)をしてよいのはここだけ。
  const client = createSessionClient<AuthOnlyDatabase, 'public'>(server, jar, { scope: createSessionScope({ stage: 'front', budget }) });
  // getUser が唯一の目的(トークンの検証と、期限切れなら更新)。戻り値は使わない。
  await client.auth.getUser();
  const removals = legacyCookieRemovals(jar.getAll());
  if (removals.length > 0) jar.setAll(removals, {});
}

/** 認証の操作だけに使うクライアントの、空のスキーマの型(業務データを読まない)。 */
export interface AuthOnlyDatabase {
  readonly public: {
    readonly Tables: Record<never, never>;
    readonly Views: Record<never, never>;
    readonly Functions: Record<never, never>;
  };
}
