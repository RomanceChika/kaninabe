/**
 * **セッションの終わらせ方と確かめ方**の保証の見張り(ASVS V7.4.1・V7.4.2・V7.4.4・V7.4.5・V7.5.2・V10.4.9)。
 *
 *   - `fw_session_end_declared` … アカウントを止める遷移がセッションを終える効果を宣言していなければ J7 が止め(R11)、生成する遷移の
 *     RPC は宣言したイベントでだけ同じトランザクションで呼び出しを持つ
 *   - `fw_logout_visible` … 認証の要る全画面が、ログアウトの遷移を持つ共有クロームを被っていなければ H8 が止める
 *   - `fw_session_server_validated` … セッションの確かめは認証基盤への問い合わせ(`getUser`)を通る。署名を確かめただけのクレームで
 *     「生きている」と答える経路を持たない(非対称の署名鍵では、終わったセッションのアクセストークンが期限まで署名として有効)
 *   - `fw_session_admin_ops` … セッションの管理(一覧・1 本・自分以外・全部・全員)は、返す欄を絞り、ID の形を確かめてから呼ぶ
 *
 * 検査の表(止める形・受け入れる形の全部)は `unit/job/verifiers/j7-ends-sessions.test.ts` と `unit/auth/verifiers/h8-logout-control.test.ts`
 * が持ち、ここは台帳の見張りとして最小の一対(止まる形と通る形)を固定する。実 DB での挙動は製品の統合テスト(保証 `session_management`)が見る。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { retryRollbacks } from '@kaninabe/adapter-postgrest';
import { createSessionAdmin, sessionMfaVerified } from '@kaninabe/adapter-supabase-session';
import type { ClaimsReader } from '@kaninabe/adapter-supabase-session';
import { verifyLogoutControl } from '../../lib/auth/verifiers/h8-logout-control.js';
import { rpcBodiesGenerator } from '../../lib/generate/render/code-rpc-bodies.js';
import { detectRepoRoot } from '../../lib/io/paths.js';
import { verifyEndsSessions } from '../../lib/job/verifiers/j7-ends-sessions.js';
import { authLogout, authModel } from '../helpers/auth-builder.js';
import { dataTable, dataTableModel } from '../helpers/data-builder.js';
import { GEN_CTX } from '../helpers/generate-context.js';
import { jobModel, outboxJob } from '../helpers/job-builder.js';
import { aggregate, effect, entitySpec, event, field, machine, specModel } from '../helpers/model-builder.js';
import { TEST_ROOTS } from '../helpers/product-roots.js';
import { screenSpec } from '../helpers/screen-builder.js';
import { loadedInput } from '../helpers/verify-inputs.js';

/** リポジトリのルート。 */
const REPO_ROOT = detectRepoRoot(import.meta.dirname);

/** 退会(終端)と一時停止を持つアカウント。`effects` は遷移 → 積む効果。 */
function accountModel(effects: readonly ReturnType<typeof effect>[]) {
  return specModel([
    aggregate('account', {
      entity: entitySpec('account', {
        label: 'アカウント',
        context: { account: 'account.id' },
        fields: [field('id', { kind: 'uuid' }, { auto: true }), field('state', { kind: 'state', machine: 'membership' })],
      }),
      stateMachines: [
        machine('membership', {
          states: ['active', 'paused', 'left'],
          initial: 'active',
          final: ['left'],
          events: [event('pause', { from: ['active'], to: 'paused', by: ['member'] }), event('leave', { from: ['active', 'paused'], to: 'left', by: ['member'] })],
          effects,
        }),
      ],
    }),
  ]);
}

const END = outboxJob('end_account_sessions', { kind: 'end', endsSessions: 'account', platformCall: 'revoke_auth_sessions', inTransaction: true });
const KIND_TERMS = [{ id: 'end', inTransaction: true, declares: ['ends_sessions' as const] }, { id: 'plain' }];
const AUTH = authModel({ subject: 'membership' });

describe('アカウントを止める遷移はセッションを終える効果を宣言する(R11)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-SESSIONEND-001
  it('終端の状態へ行く遷移がセッションを終える効果を宣言していなければ J7 が止め、宣言すれば通る(一時停止には求めない)', () => {
    const catalog = jobModel([END], true, KIND_TERMS);

    const missing = verifyEndsSessions(accountModel([]), catalog, AUTH, TEST_ROOTS);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ verifier: 'J7', severity: 'error', counterexample: { event: 'membership.leave', to: 'left' } });

    expect(verifyEndsSessions(accountModel([effect('leave', ['end_account_sessions'])]), catalog, AUTH, TEST_ROOTS)).toEqual([]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-SESSIONEND-002
  it('生成する遷移の RPC は、効果を宣言したイベントでだけ、遷移と同じトランザクションの中で呼び出しを持つ', () => {
    const rpc = {
      name: 'apply_account_transition',
      args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid', 'text[]'],
      params: ['p_account_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id', 'p_actor_roles'],
      kind: 'rpc' as const,
      shape: 'transition' as const,
      migration: '20261023000800_apply_account_transition.sql',
      alsoWrites: [],
    };
    const context = { ...GEN_CTX, dataTables: dataTableModel([dataTable('accounts', { entity: 'account', functions: [rpc] })]), jobs: jobModel([END], true, KIND_TERMS) };

    const [section] = rpcBodiesGenerator.generate(accountModel([effect('leave', ['end_account_sessions'])]), context);
    const sql = section?.content ?? '';

    expect(sql).toContain("if p_event_id in ('membership.leave') then");
    expect(sql).toContain(`perform ${GEN_CTX.platform.exposedSchema}.revoke_auth_sessions(p_account_id);`);
    // 呼び出しの条件は、効果を宣言したイベントだけ(宣言していない一時停止は入らない)。
    expect(sql.match(/if p_event_id in \(([^)]*)\) then/gu)).toEqual(["if p_event_id in ('membership.leave') then"]);
  });
});

describe('認証の要る全画面からログアウトが見える(V7.4.4)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-LOGOUT-001
  it('ログアウトの遷移を持つ共有クロームを被っていない要ログインの画面を H8 が止め、被っていれば通る', () => {
    const flow = authModel({ logout: authLogout('/api/auth/logout', 'signed_out') }).flow;
    const wrap = (...list: ReturnType<typeof screenSpec>[]) => ({ available: true as const, screens: list, chromes: [], unexposed: [], unreachableStates: [], unseenStates: [] });
    const bare = screenSpec({ name: 'orphan', requiresAuth: true });
    const wrapped = screenSpec({ name: 'wrapped', requiresAuth: true, chrome: 'chrome-member', navigations: [{ on: 'signed_out', to: 'screen-login', viaChrome: 'chrome-member' }] });

    const findings = verifyLogoutControl(flow, loadedInput(wrap(bare, wrapped)));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'H8', severity: 'error', counterexample: { screen: 'orphan' } });
    expect(verifyLogoutControl(flow, loadedInput(wrap(wrapped)))).toEqual([]);
  });
});

describe('セッションの確かめは認証基盤への問い合わせを通る(V7.4.1)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-SESSIONVALID-001
  it('署名が有効で aal2 のアクセストークンでも、セッションが終わっていれば(getUser が落ちる)多要素認証を済ませたと答えない', async () => {
    const claims = () => Promise.resolve({ data: { claims: { aal: 'aal2' } }, error: null });
    const alive: ClaimsReader = { auth: { getClaims: claims, getUser: () => Promise.resolve({ data: { user: { id: 'u' } }, error: null }) } };
    const ended: ClaimsReader = { auth: { getClaims: claims, getUser: () => Promise.resolve({ data: { user: null }, error: new Error('Auth session missing') }) } };

    await expect(sessionMfaVerified(alive)).resolves.toBe(true);
    await expect(sessionMfaVerified(ended)).resolves.toBe(false);
  });

  /** 非テストのソース(`__tests__` と `*.test.*` を除く)の絶対パスを集める。 */
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sources(path);
      return /\.(ts|tsx)$/u.test(name) && !/\.test\./u.test(name) ? [path] : [];
    });
  }

  /** `getClaims()` を呼んでよいファイル。どれも「クレームを読む」だけで、セッションが生きているかの判断には使わない。 */
  const CLAIMS_ALLOWED = new Set([
    // aal を読む。aal2 のときだけ getUser でセッションの生存を確かめる。
    'framework/adapters/supabase-session/src/assurance.ts',
    // ログアウトの記録に載せる実行者の ID を読むだけ(失敗してもログアウトは止めない)。
    'framework/adapters/supabase-session/src/sign-out.ts',
    // いまの端末のセッション ID を読むだけ(メンバー ID は getUser が導く)。
    'framework/adapters/supabase-session/src/session-admin.ts',
  ]);

  // @spec framework-guarantee-catalog @tc TC-FW-SESSIONVALID-002
  it('製品の実装とセッションの adapter は、cookie から読んだだけの値(getSession)を使わず、署名だけを確かめるクレーム(getClaims)は許可した 3 か所だけで読む', () => {
    // 製品の実装の木(app/src)は、あるときだけ数える(この木のデモ製品は仕様だけで、実装の木を持たない)
    const roots = [join(REPO_ROOT, 'app', 'src'), join(REPO_ROOT, 'framework', 'adapters', 'supabase-session', 'src')].filter((dir) => existsSync(dir));
    const files = roots.flatMap(sources);
    expect(files.length).toBeGreaterThan(5);

    const getSession: string[] = [];
    const getClaims: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const path = relative(REPO_ROOT, file);
      if (/\.getSession\s*\??\.?\s*\(/u.test(text)) getSession.push(path);
      if (/\.getClaims\s*\??\.?\s*\(/u.test(text)) getClaims.push(path);
    }

    expect(getSession).toEqual([]);
    expect(getClaims.filter((path) => !CLAIMS_ALLOWED.has(path))).toEqual([]);
    // 対照: 許可した場所には実際に読む呼び出しがある(走査が空振りでない)。
    expect(getClaims.sort()).toEqual([...CLAIMS_ALLOWED].sort());
  });
});

describe('セッションの管理の部品(V7.5.2・V7.4.5・V10.4.9)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-SESSIONADMIN-001
  it('一覧は欄を絞って返し(トークンの類は通さない)、ID が UUID の形でなければ RPC を呼ばずに落とす', async () => {
    const calls: string[] = [];
    const client = retryRollbacks({
      rpc: (fn: string) => {
        calls.push(fn);
        return Promise.resolve({
          data: [{ id: '11111111-1111-4111-8111-111111111111', created_at: 'a', last_active_at: 'b', user_agent: null, ip: null, refresh_token: 'secret' }],
          error: null,
        });
      },
    });
    const admin = createSessionAdmin(client);

    const list = await admin.list('22222222-2222-4222-8222-222222222222', null);
    expect(JSON.stringify(list)).not.toContain('secret');
    expect(Object.keys(list[0] ?? {}).sort()).toEqual(['createdAt', 'current', 'id', 'ip', 'lastActiveAt', 'userAgent']);

    await expect(admin.endAll('not-a-uuid')).rejects.toMatchObject({ name: 'SessionAdminError' });
    expect(calls).toEqual(['list_auth_sessions']);
  });
});
