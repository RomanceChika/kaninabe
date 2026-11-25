import { describe, expect, it } from 'vitest';
import { MFA_ASSURANCE_LEVEL, sessionMfaVerified } from '../assurance';
import type { ClaimsReader } from '../assurance';
import { createSessionClient } from '../session-client';
import type { AuthOnlyDatabase } from '../session-client';
import { FAKE_AUTH_URL, recordingJar } from './fakes/auth-server';

type Claims = Awaited<ReturnType<ClaimsReader['auth']['getClaims']>>;
type Alive = Awaited<ReturnType<ClaimsReader['auth']['getUser']>>;

/** セッションが生きている `getUser` の結果(既定)。 */
const ALIVE: Alive = { data: { user: { id: 'u1' } }, error: null };

/**
 * `getClaims` と `getUser` が決まった結果を返すクライアント(署名の確かめと認証基盤への問い合わせはライブラリの仕事なので、
 * ここは結果の読み方だけを見る)。
 */
function reader(result: Claims, alive: Alive = ALIVE): ClaimsReader {
  return { auth: { getClaims: () => Promise.resolve(result), getUser: () => Promise.resolve(alive) } };
}

/**
 * セッションが多要素認証を済ませているかの読み取り(`assurance.ts`)。
 * **署名を確かめたクレームの `aal` が `aal2` のときだけ**済ませたと答え、それ以外は全部済ませていないと答える。
 */
describe('セッションの多要素認証', () => {
  it('署名を確かめたクレームの aal が aal2 なら済ませている', async () => {
    expect(MFA_ASSURANCE_LEVEL).toBe('aal2');
    await expect(sessionMfaVerified(reader({ data: { claims: { aal: 'aal2' } }, error: null }))).resolves.toBe(true);
  });

  it('aal1・aal の無いクレームは済ませていない', async () => {
    await expect(sessionMfaVerified(reader({ data: { claims: { aal: 'aal1' } }, error: null }))).resolves.toBe(false);
    await expect(sessionMfaVerified(reader({ data: { claims: {} }, error: null }))).resolves.toBe(false);
  });

  it('確かめられなかった(未ログイン・署名の不一致・問い合わせの失敗)ときは済ませていない', async () => {
    await expect(sessionMfaVerified(reader({ data: null, error: null }))).resolves.toBe(false);
    await expect(sessionMfaVerified(reader({ data: null, error: new Error('invalid JWT') }))).resolves.toBe(false);
    // エラーとクレームが同時に返る形でも、エラーを優先して信じない。
    await expect(sessionMfaVerified(reader({ data: { claims: { aal: 'aal2' } }, error: new Error('x') }))).resolves.toBe(false);
  });

  it('署名が有効で aal2 でも、セッションが終わっていれば(getUser が落ちる)済ませていない — ログアウト・無効化のあとの旧いトークン(V7.4.1)', async () => {
    const claims: Claims = { data: { claims: { aal: 'aal2' } }, error: null };
    await expect(sessionMfaVerified(reader(claims, { data: { user: null }, error: new Error('Auth session missing') }))).resolves.toBe(false);
    await expect(sessionMfaVerified(reader(claims, { data: null, error: null }))).resolves.toBe(false);
    await expect(sessionMfaVerified(reader(claims, { data: { user: undefined }, error: null }))).resolves.toBe(false);
    // エラーとユーザーが同時に返る形でも、エラーを優先して信じない。
    await expect(sessionMfaVerified(reader(claims, { data: { user: { id: 'u1' } }, error: new Error('x') }))).resolves.toBe(false);
  });

  it('aal2 でなければ、認証基盤へ問い合わせるまでもなく済ませていない(余計な往復をしない)', async () => {
    let asked = 0;
    const client: ClaimsReader = {
      auth: {
        getClaims: () => Promise.resolve({ data: { claims: { aal: 'aal1' } }, error: null }),
        getUser: () => {
          asked += 1;
          return Promise.resolve(ALIVE);
        },
      },
    };
    await expect(sessionMfaVerified(client)).resolves.toBe(false);
    expect(asked).toBe(0);
  });

  it('本物のサーバーのクライアントをそのまま渡せ、セッションが無ければ済ませていない', async () => {
    const client = createSessionClient<AuthOnlyDatabase, 'public'>({ url: FAKE_AUTH_URL, anonKey: 'anon' }, recordingJar());
    await expect(sessionMfaVerified(client)).resolves.toBe(false);
  });
});
