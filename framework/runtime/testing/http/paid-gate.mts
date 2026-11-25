/**
 * **有料の口の関門が、実物のまま、未ログインと役を持たない人を閉じるか**を観測するテストの道具(生成した見張りテストが使う。製品の実行時には読まない)。
 *
 * ## 何を確かめたいのか
 *
 * 有料の口(`runPaidEntry` で包んだ Route Handler)は「未ログインは 401・役を持たない人は 403。本文を読まず、枠の RPC も有料の処理も呼ばない」と約束する。
 * 口の**形**は X8 が構文木で見るが、形の許可表だけでは、手書きの route を差し替えたとき(認可の部品の中身を変えた・表に無い書き方で通した)に
 * 黙って開く余地が残る(点検 5 回目 B5-2)。そこで**実際の route のモジュールを実物のまま叩き**、閉じ方を外側から観測する。
 *
 * ## どう観測するか(モジュールの差し替えはしない)
 *
 * この仕組みはテストでのモジュールの差し替え(`vi.mock` の類)を禁じている。口の外側の境界で観測する ——
 *
 *   1. **偽の後段**(`installFakeBackend`)… グローバルの `fetch` を差し替え、認証基盤と DB の口を**道の形で**答える。
 *      利用者の取得(`/auth/v1/user`)はログインしている人を返し、表の読み取り(`/rest/v1/{表}` の GET)は**行が 0 本**と答える
 *      (行の無い人はどの役の条件も満たさない = 役を持たない人)。RPC(`/rest/v1/rpc/{名前}`)・書き込み・ほかの宛先(有料の連携)は記録して拒む
 *   2. **要求の文脈**(`runInNextRequestContext`)… 認証は `next/headers` の `cookies()` を読むので、Next.js が要求ごとに作る文脈を最小の形で作る
 *      (非公開の内部モジュールに依る。依存はこのファイルに閉じる)
 *   3. **ログインのセッション**(`sessionCookieHeader`)… cookie の値はセッションの adapter が読む形(`base64-` + base64url(JSON))。
 *      アクセストークンは偽物で、利用者の取得は偽の後段が答える
 *   4. **判定**(`gateLeaks`)… 状態・応答の本文(固定の語)・本文を読んだか・RPC / 書き込み / ほかの宛先に触れたかを並べる純関数
 *
 * 前提: `globalThis.AsyncLocalStorage` を、Next.js の内部モジュールが読み込まれる前に注入しておく(`./next-async-context.mts` を setupFiles に置く)。
 * 限界: `fetch` を通らない外への呼び出しは観測しない。役の判定が「行が無くても立つ」役(既定のログインロールで行の条件が無い)には 403 の観測は使えない
 * (生成器がその役を名指しで外す)。
 */

/** 偽の後段の環境変数(接続先と公開の鍵。どこにもつながらない。`local-supabase.mts` の `applyEnv` と同じ名前)。 */
export const FAKE_BACKEND_ENV: Readonly<Record<string, string>> = {
  SUPABASE_URL: 'http://127.0.0.1:54399',
  SUPABASE_ANON_KEY: 'fake-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
};

/** 偽の後段が答える、ログインしている人の ID(行は無い)。 */
export const FAKE_SIGNED_IN_USER_ID = '00000000-0000-4000-8000-00000000fa11';

/** 偽の後段が受けた呼び出し 1 件の種類。 */
export type BackendCallKind =
  /** 利用者の取得(セッションの確かめ)。 */
  | 'auth-user'
  /** ほかの認証基盤の口(更新・ログアウトなど)。 */
  | 'auth-other'
  /** 表の読み取り(行は 0 本と答える)。 */
  | 'read'
  /** RPC(枠の消費など。拒む)。 */
  | 'rpc'
  /** 表への書き込み(拒む)。 */
  | 'write'
  /** 後段でない宛先(有料の連携など。拒む)。 */
  | 'outside';

/** 偽の後段が受けた呼び出し 1 件(行き先は道の名前だけ。値は残さない)。 */
export interface BackendCall {
  readonly kind: BackendCallKind;
  /** `rpc` は RPC の名前、`read` / `write` は表の名前、`outside` はホスト、認証は道。 */
  readonly target: string;
}

/** 偽の後段。 */
export interface FakeBackend {
  /** 受けた呼び出しの写し(受けた順)。 */
  calls(): readonly BackendCall[];
  /** 記録を空にする。 */
  clear(): void;
  /** グローバルの `fetch` を元に戻す(2 度目以降は何もしない)。 */
  dispose(): void;
}

/** 呼び出しの URL とメソッド。 */
function requestOf(input: unknown, init: RequestInit | undefined): { readonly url: URL | null; readonly method: string } {
  const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  return { url: URL.canParse(raw) ? new URL(raw) : null, method };
}

/**
 * 呼び出しの分類(純関数)。道の形だけで決める(後段のホストは問わない。製品の接続先の名前に依らない)。
 *
 * @param url - 呼び出しの URL(読めない URL は null)
 * @param method - HTTP メソッド(大文字)
 * @returns 分類
 */
export function classifyBackendCall(url: URL | null, method: string): BackendCall {
  if (url === null) return { kind: 'outside', target: 'relative' };
  const path = url.pathname;
  if (path === '/auth/v1/user' && method === 'GET') return { kind: 'auth-user', target: path };
  if (path.startsWith('/auth/v1/')) return { kind: 'auth-other', target: path };
  if (path.startsWith('/rest/v1/rpc/')) return { kind: 'rpc', target: decodeURIComponent(path.slice('/rest/v1/rpc/'.length)) };
  if (path.startsWith('/rest/v1/')) {
    const table = decodeURIComponent(path.slice('/rest/v1/'.length));
    return { kind: method === 'GET' || method === 'HEAD' ? 'read' : 'write', target: table };
  }
  return { kind: 'outside', target: url.host };
}

/** 偽の後段が答えるログインしている人。 */
function signedInUser(userId: string): Record<string, unknown> {
  return { id: userId, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
}

/** 拒む答え(JSON の本文つき。例外にはしない —— 拒まれた後に口が何をするかも観測に入れる)。 */
function refused(status: number, message: string): Response {
  return Response.json({ code: String(status), message }, { status });
}

/**
 * グローバルの `fetch` を偽の後段に差し替える。利用者の取得はログインしている人を返し(ログインしていない cookie では呼ばれない)、
 * 表の読み取りは行 0 本、RPC・書き込み・ほかの宛先は記録して拒む。
 *
 * @param userId - 利用者の取得が返す人の ID
 * @returns 偽の後段(使い終えたら `dispose`)
 */
export function installFakeBackend(userId: string = FAKE_SIGNED_IN_USER_ID): FakeBackend {
  const original = globalThis.fetch;
  const records: BackendCall[] = [];
  let disposed = false;
  globalThis.fetch = (input, init) => {
    const { url, method } = requestOf(input, init);
    const call = classifyBackendCall(url, method);
    records.push(call);
    switch (call.kind) {
      case 'auth-user':
        return Promise.resolve(Response.json(signedInUser(userId)));
      case 'read':
        return Promise.resolve(Response.json([], { headers: { 'content-range': '*/0' } }));
      case 'auth-other':
        return Promise.resolve(refused(400, 'paid-gate: auth endpoint is not served'));
      case 'rpc':
      case 'write':
        return Promise.resolve(refused(403, 'paid-gate: writes are refused while observing a gate'));
      case 'outside':
        return Promise.reject(new Error('paid-gate: outbound fetch is blocked while observing a gate'));
    }
  };
  return {
    calls: () => [...records],
    clear: () => {
      records.length = 0;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      globalThis.fetch = original;
    },
  };
}

/** `@supabase/ssr` のチャンクの上限(この長さを超える値は `.0` `.1` … に割る)。 */
const MAX_CHUNK_SIZE = 3180;

/**
 * ログインしている人のセッションの Cookie ヘッダ(偽のトークン。利用者の取得は偽の後段が答える)。
 *
 * @param cookieName - セッションの cookie の名前(セッションの adapter の約束。生成器が写す)
 * @param userId - 人の ID
 * @returns `name=value` の並び(`runInNextRequestContext` にそのまま渡す)
 */
export function sessionCookieHeader(cookieName: string, userId: string = FAKE_SIGNED_IN_USER_ID): string {
  const now = Math.floor(Date.now() / 1000);
  const session = { access_token: 'paid-gate-access-token', refresh_token: 'paid-gate-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: signedInUser(userId) };
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
  if (value.length <= MAX_CHUNK_SIZE) return `${cookieName}=${value}`;
  const chunks: string[] = [];
  for (let index = 0; index * MAX_CHUNK_SIZE < value.length; index += 1) chunks.push(`${cookieName}.${String(index)}=${value.slice(index * MAX_CHUNK_SIZE, (index + 1) * MAX_CHUNK_SIZE)}`);
  return chunks.join('; ');
}

/** Next.js の要求単位の文脈を作る部品(非公開の内部モジュール。型を持たないので、使う形だけを書く)。 */
interface RequestStores {
  readonly workAsyncStorage: { run<T>(store: unknown, callback: () => T): T };
  readonly workUnitAsyncStorage: { run<T>(store: unknown, callback: () => T): T };
  readonly RequestCookies: new (headers: Headers) => unknown;
  readonly RequestCookiesAdapter: { seal(cookies: unknown): unknown };
  readonly HeadersAdapter: { seal(headers: Headers): unknown };
}

/** 内部モジュールの指定子(変数に置くのは、型検査が内部の型に依らないため)。 */
const NEXT_INTERNALS = {
  work: 'next/dist/server/app-render/work-async-storage.external.js',
  workUnit: 'next/dist/server/app-render/work-unit-async-storage.external.js',
  cookies: 'next/dist/server/web/spec-extension/cookies.js',
  requestCookies: 'next/dist/server/web/spec-extension/adapters/request-cookies.js',
  headers: 'next/dist/server/web/spec-extension/adapters/headers.js',
} as const;

/** 内部モジュールを読む(動的 import。`globalThis.AsyncLocalStorage` の注入より前に評価させない)。 */
async function loadRequestStores(): Promise<RequestStores> {
  const load = (specifier: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ specifier) as Promise<Record<string, unknown>>;
  const [work, workUnit, cookies, requestCookies, headers] = await Promise.all([NEXT_INTERNALS.work, NEXT_INTERNALS.workUnit, NEXT_INTERNALS.cookies, NEXT_INTERNALS.requestCookies, NEXT_INTERNALS.headers].map(load));
  const pick = <T,>(module: Record<string, unknown> | undefined, name: string): T => module?.[name] as T;
  return {
    workAsyncStorage: pick(work, 'workAsyncStorage'),
    workUnitAsyncStorage: pick(workUnit, 'workUnitAsyncStorage'),
    RequestCookies: pick(cookies, 'RequestCookies'),
    RequestCookiesAdapter: pick(requestCookies, 'RequestCookiesAdapter'),
    HeadersAdapter: pick(headers, 'HeadersAdapter'),
  };
}

/**
 * 与えた cookie が読める Next.js の要求の文脈の中で、非同期関数を 1 つ実行する(`cookies()` / `headers()` が実リクエストと同じように動く)。
 *
 * @param cookieHeader - `name=value; …` の Cookie ヘッダ(空文字 = cookie なし = 未ログイン)
 * @param fn - 文脈の中で実行する処理
 * @returns `fn` の戻り値
 */
export async function runInNextRequestContext<T>(cookieHeader: string, fn: () => Promise<T>): Promise<T> {
  const stores = await loadRequestStores();
  const headers = new Headers();
  if (cookieHeader !== '') headers.set('cookie', cookieHeader);
  headers.set('x-request-id', 'paid-gate-request');
  const requestCookies = new stores.RequestCookies(headers);
  const workStore = { route: '/__paid-gate__', page: '/__paid-gate__', isStaticGeneration: false, forceStatic: false, dynamicShouldError: false };
  const workUnitStore = {
    type: 'request' as const,
    phase: 'action' as const,
    headers: stores.HeadersAdapter.seal(headers),
    cookies: requestCookies,
    userspaceMutableCookies: stores.RequestCookiesAdapter.seal(requestCookies),
    url: { pathname: workStore.route, search: '' },
  };
  return stores.workAsyncStorage.run(workStore, () => stores.workUnitAsyncStorage.run(workUnitStore, fn));
}

/** 関門の 1 回の観測。 */
export interface GateObservation {
  /** 応答のステータス(戻り値が `Response` でなければ null)。 */
  readonly status: number | null;
  /** 応答の本文(読めなければ null)。 */
  readonly body: string | null;
  /** 例外で落ちたならその理由(落ちなければ null)。 */
  readonly thrown: string | null;
  /** 呼び出しの間に偽の後段が受けたもの。 */
  readonly calls: readonly BackendCall[];
  /** 要求の本文を読んだか。 */
  readonly bodyUsed: boolean;
}

/**
 * 記録を空にしてから、要求の文脈の中で口を 1 回呼び、何に触れたかを観測する。
 *
 * @param handler - 口(`POST` などの本体)
 * @param request - 送る要求
 * @param backend - 偽の後段(`installFakeBackend`)
 * @param cookieHeader - 要求の cookie(空文字 = 未ログイン)
 * @returns 観測
 */
export async function observeGate(handler: (request: Request) => unknown, request: Request, backend: FakeBackend, cookieHeader: string): Promise<GateObservation> {
  backend.clear();
  let result: unknown;
  let thrown: string | null = null;
  try {
    result = await runInNextRequestContext(cookieHeader, async () => handler(request));
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }
  const response = result instanceof Response ? result : null;
  const body = response === null ? null : await response.text().catch(() => null);
  return { status: response?.status ?? null, body, thrown, calls: backend.calls(), bodyUsed: request.bodyUsed };
}

/** 関門が閉じたときの応答(状態と、固定の語の本文)。 */
export interface GateRefusal {
  readonly status: number;
  readonly error: string;
}

/** 未ログインの閉じ方(`runPaidEntry` の 401)。 */
export const UNAUTHENTICATED_REFUSAL: GateRefusal = { status: 401, error: 'unauthorized' };

/** 役を持たない人の閉じ方(`runPaidEntry` の 403)。 */
export const FORBIDDEN_REFUSAL: GateRefusal = { status: 403, error: 'forbidden' };

/** 閉じる要求で触れてよい呼び出し(セッションの確かめと、役の条件の行の読み取り)。 */
const ALLOWED: ReadonlySet<BackendCallKind> = new Set(['auth-user', 'read']);

/**
 * 関門が、期待した閉じ方で、何も使わずに閉じたか(純関数)。理由の印は `threw:{理由}` / `status:{値}` / `body:{本文}` /
 * `{種類}:{行き先}`(RPC・書き込み・ほかの宛先・ほかの認証の口) / `body-read`。
 *
 * @param observation - 観測
 * @param expected - 期待する閉じ方
 * @returns 正しく閉じていなければ理由の並び(空 = 期待の状態と本文で、本文を読まず、枠の RPC も書き込みも有料の宛先も呼ばずに閉じた)
 */
export function gateLeaks(observation: GateObservation, expected: GateRefusal): readonly string[] {
  const expectedBody = JSON.stringify({ error: expected.error });
  const statusLeak = observation.thrown === null && observation.status !== expected.status ? [`status:${String(observation.status)}`] : [];
  const bodyLeak = observation.status === expected.status && observation.body !== expectedBody ? [`body:${String(observation.body)}`] : [];
  return [
    ...(observation.thrown === null ? [] : [`threw:${observation.thrown}`]),
    ...statusLeak,
    ...bodyLeak,
    ...observation.calls.filter((call) => !ALLOWED.has(call.kind)).map((call) => `${call.kind}:${call.target}`),
    ...(observation.bodyUsed ? ['body-read'] : []),
  ];
}
