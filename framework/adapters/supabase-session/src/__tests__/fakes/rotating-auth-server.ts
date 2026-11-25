/**
 * テスト用の偽の認証基盤のうち、**更新トークンの回り方を GoTrue(v2.196.0)と同じ規則で持つ**もの(`fetch` の差し替え。ネットワークに出ない)。
 *
 * 規則(GoTrue の `RefreshTokenGrant` を読んで写した。点検 17 回目 B の実測とも合う):
 * - 生きている更新トークンを出すと、それを失効させ、子を発行する(セッションのいま生きているトークンは、いちばん新しい失効していないもの)。
 * - 失効したトークンでも、**いま生きているトークンの親**なら、その生きているトークンを返す(新しく発行しない。猶予の時間を問わない)。
 * - それ以外の失効したトークンは、失効から再利用の猶予(既定 10 秒)の内なら、子を発行する。猶予の外なら `refresh_token_already_used` で、
 *   **セッションの系列を全部失効させる**(締め出し)。
 * - アクセストークンの寿命は `jwtExpSeconds`(測りの `GOTRUE_JWT_EXP`)。利用者の取得は、生きているアクセストークンでだけ答える。
 *
 * 時刻は `Date.now()`(テストが偽の時計で進める)。
 */

import { fakeUser } from './auth-server';

/** 偽の認証基盤の URL(どこにもつながらない)。 */
export const ROTATING_AUTH_URL = 'http://rotating-auth.invalid';

/** 認証基盤の v2 の失敗の答え。 */
function failure(status: number, code: string): Response {
  return Response.json({ code, message: code }, { status, headers: { 'x-supabase-api-version': '2024-01-01' } });
}

/** 更新トークン 1 本。 */
interface TokenRow {
  readonly token: string;
  readonly parent: string | null;
  revokedAt: number | null;
}

/** 回り方の設定。 */
export interface RotatingAuthOptions {
  /** アクセストークンの寿命(秒)。 */
  readonly jwtExpSeconds: number;
  /** 再利用の猶予(秒。既定 10)。 */
  readonly reuseIntervalSeconds?: number;
}

/** 偽の認証基盤(回り方を持つ)。 */
export interface RotatingAuthServer {
  /** 実体 1 つぶんの `fetch` を作る(前段・後段・別の実体で分けて使う。中身の台帳は共有)。 */
  instance(): typeof fetch;
  /** 最初のセッション(アクセストークンは `accessExpiresIn` 秒後に切れる)の cookie の値。 */
  initialCookieValue(accessExpiresIn: number): string;
  /** 更新の口を叩いた回数。 */
  refreshCalls(): number;
  /** セッションの系列が失効したか(締め出し)。 */
  familyRevoked(): boolean;
  /** 更新の口の答えの記録(`in` → `out` か失敗のコード)。 */
  readonly log: { readonly at: number; readonly in: string; readonly out: string | null; readonly code: string | null }[];
}

/** 文字列を UTF-8 の base64url にする。 */
function base64url(text: string): string {
  const binary = String.fromCharCode(...new TextEncoder().encode(text));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 回り方を持つ偽の認証基盤を作る。
 *
 * @param options - アクセストークンの寿命と再利用の猶予
 * @returns 偽の認証基盤
 */
export function createRotatingAuthServer(options: RotatingAuthOptions): RotatingAuthServer {
  const reuseMs = (options.reuseIntervalSeconds ?? 10) * 1000;
  const rows: TokenRow[] = [];
  const accessExpiry = new Map<string, number>();
  const log: RotatingAuthServer['log'] = [];
  let serial = 0;
  let revokedFamily = false;

  const issue = (parent: string | null, accessExpiresIn: number): Record<string, unknown> => {
    serial += 1;
    const token = `rt-${String(serial)}`;
    rows.push({ token, parent, revokedAt: null });
    return sessionOf(token, accessExpiresIn);
  };
  const sessionOf = (token: string, accessExpiresIn: number): Record<string, unknown> => {
    const access = `at-${token}`;
    const expiresAt = Math.floor(Date.now() / 1000) + accessExpiresIn;
    accessExpiry.set(access, expiresAt * 1000);
    return { access_token: access, refresh_token: token, token_type: 'bearer', expires_in: accessExpiresIn, expires_at: expiresAt, user: fakeUser() };
  };
  const active = (): TokenRow | undefined => [...rows].reverse().find((row) => row.revokedAt === null);

  const refresh = (token: string): Response => {
    const row = rows.find((candidate) => candidate.token === token);
    const now = Date.now();
    const record = (out: string | null, code: string | null): void => {
      log.push({ at: now, in: token, out, code });
    };
    if (row === undefined || revokedFamily) {
      record(null, 'refresh_token_not_found');
      return failure(400, 'refresh_token_not_found');
    }
    if (row.revokedAt !== null) {
      const current = active();
      if (current?.parent === token) {
        record(current.token, null);
        return Response.json(sessionOf(current.token, options.jwtExpSeconds));
      }
      if (now - row.revokedAt > reuseMs) {
        revokedFamily = true;
        for (const each of rows) each.revokedAt ??= now;
        record(null, 'refresh_token_already_used');
        return failure(400, 'refresh_token_already_used');
      }
    }
    // 出したトークンだけを失効させる(猶予の内の兄弟は生きたまま残る。いま生きているのは、いちばん新しい失効していないもの)。
    row.revokedAt ??= now;
    const session = issue(token, options.jwtExpSeconds);
    record(session['refresh_token'] as string, null);
    return Response.json(session);
  };

  const user = (authorization: string | null): Response => {
    const access = authorization?.replace(/^Bearer /, '') ?? '';
    const expiry = accessExpiry.get(access);
    if (revokedFamily) return failure(403, 'session_not_found');
    if (expiry === undefined || expiry <= Date.now()) return failure(403, 'bad_jwt');
    return Response.json(fakeUser());
  };

  const instance = (): typeof fetch =>
    ((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === '/auth/v1/token') {
        const { refresh_token: token } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { readonly refresh_token?: string };
        return Promise.resolve(refresh(token ?? ''));
      }
      if (url.pathname === '/auth/v1/user') return Promise.resolve(user(new Headers(init?.headers).get('authorization')));
      return Promise.resolve(Response.json({ message: 'not found' }, { status: 404 }));
    }) as typeof fetch;

  return {
    instance,
    initialCookieValue: (accessExpiresIn) => `base64-${base64url(JSON.stringify(issue(null, accessExpiresIn)))}`,
    refreshCalls: () => log.length,
    familyRevoked: () => revokedFamily,
    log,
  };
}
