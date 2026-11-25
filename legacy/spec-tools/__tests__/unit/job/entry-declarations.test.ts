/**
 * HTTP の入口の宣言の全数(`job/entry-declarations.ts`)のユニットテスト。
 *
 * 衝突の検査(J2 の続き)と閉世界の検査(J2 の続き)が同じ材料を読むための 1 か所なので、出どころの 6 種類・並び・持ち主の名前・位置をここで固定する。
 */

import { describe, expect, it } from 'vitest';
import { AUTH_CALLBACK_OWNER, AUTH_LOGOUT_OWNER, AUTH_START_OWNER, ENTRY_ORIGINS, entryDeclarationsOf, isCookieAuthenticatedOrigin, isHandwrittenOrigin, isMalformedEndpoint } from '../../../lib/job/entry-declarations.js';
import { authCallback, authEntry, authLogout, authModel } from '../../helpers/auth-builder.js';
import { externalModel, integration } from '../../helpers/external-builder.js';
import { jobModel, notScheduledJob, outboxJob, scheduledJob } from '../../helpers/job-builder.js';

const EXTERNAL =
  externalModel([
    integration('billing_hook', { direction: 'inbound', signature: 'hmac_sha256', signatureKey: 'K', eventIdTable: 't', emits: 'a.b' }),
    integration('anthropic_chat', { service: 'anthropic', effect: 'read', endpoints: ['/api/ai/tutorial', '/api/ai/program-draft'] }),
    integration('discord_webhook'),
  ]).catalog ?? undefined;

describe('entryDeclarationsOf: 出どころ 6 種類を宣言の並びで集める', () => {
  it('ジョブの endpoint → 外部連携の宣言順(受信口・送信の連携の口)→ 認証の口(帰り道・開始・ログアウト)。起動口の無いジョブ・口を持たない送信の連携は宣言しない', () => {
    const jobs = jobModel([scheduledJob('run_due_jobs', { endpoint: '/api/jobs/run' }), outboxJob('notify'), notScheduledJob('later', 'まだ')]);

    const declarations = entryDeclarationsOf(
      jobs,
      EXTERNAL,
      authModel({ callback: authCallback('/api/auth/callback'), start: authEntry('start'), logout: authEntry('logout') }),
    );

    expect(declarations.map((decl) => [decl.origin, decl.url, decl.owner, decl.source])).toEqual([
      ['job', '/api/jobs/run', 'run_due_jobs', 'ジョブ run_due_jobs の endpoint /api/jobs/run'],
      ['inbound', '/api/inbound/billing_hook', 'billing_hook', '外部連携 billing_hook の受信口 /api/inbound/billing_hook'],
      ['external_endpoint', '/api/ai/tutorial', 'anthropic_chat', '外部連携 anthropic_chat の endpoints /api/ai/tutorial'],
      ['external_endpoint', '/api/ai/program-draft', 'anthropic_chat', '外部連携 anthropic_chat の endpoints /api/ai/program-draft'],
      ['auth_callback', '/api/auth/callback', AUTH_CALLBACK_OWNER, '認証 callback の endpoint /api/auth/callback'],
      ['auth_start', '/api/auth/sign-in', AUTH_START_OWNER, '認証 start の endpoint /api/auth/sign-in'],
      ['auth_logout', '/api/auth/logout', AUTH_LOGOUT_OWNER, '認証 logout の endpoint /api/auth/logout'],
    ]);
  });

  it('宣言の位置(Finding の場所)は宣言そのもの: ジョブの行・連携の行・認証の callback', () => {
    const jobs = jobModel([scheduledJob('run_due_jobs', { endpoint: '/api/jobs/run' })]);

    const locations = entryDeclarationsOf(jobs, EXTERNAL, authModel({ callback: authCallback() })).map((decl) => decl.location.pointer);

    expect(locations).toEqual(['jobs.run_due_jobs', 'integrations.billing_hook', 'integrations.anthropic_chat', 'integrations.anthropic_chat', 'callback']);
  });

  it('読めない・無い種類は宣言を持たない(外部連携カタログが読めない・認証仕様が無い/構築できない/callback を持たない)', () => {
    const jobs = jobModel([]);

    expect(entryDeclarationsOf(jobs, undefined, undefined)).toEqual([]);
    expect(entryDeclarationsOf(jobs, undefined, { available: true, flow: null })).toEqual([]);
    expect(entryDeclarationsOf(jobs, undefined, { available: false, flow: null })).toEqual([]);
    expect(entryDeclarationsOf(jobs, undefined, authModel({}))).toEqual([]);
    expect(entryDeclarationsOf({ available: false, catalog: null }, undefined, undefined)).toEqual([]);
  });

  it('出どころの閉じた一覧は 6 つで、手書きの口を持つのは受信口以外(受信口は生成物)', () => {
    expect([...ENTRY_ORIGINS]).toEqual(['job', 'inbound', 'auth_callback', 'external_endpoint', 'auth_start', 'auth_logout']);
    expect(ENTRY_ORIGINS.filter(isHandwrittenOrigin)).toEqual(['job', 'auth_callback', 'external_endpoint', 'auth_start', 'auth_logout']);
  });

  it('cookie で認証する口は送信の連携の endpoints とサインインの開始・ログアウトの口(ジョブは共有秘密・受信口は署名・OAuth の帰り道は PKCE の検証子)', () => {
    expect(ENTRY_ORIGINS.filter(isCookieAuthenticatedOrigin)).toEqual(['external_endpoint', 'auth_start', 'auth_logout']);
  });

  it('ログアウトの口は認証の口のあとに並ぶ(持ち主は logout)', () => {
    const declarations = entryDeclarationsOf(jobModel([]), undefined, authModel({ callback: authCallback(), logout: authLogout() }));
    expect(declarations.map((decl) => [decl.origin, decl.url, decl.owner])).toEqual([
      ['auth_callback', '/api/auth/callback', 'callback'],
      ['auth_logout', '/api/auth/logout', 'logout'],
    ]);
  });
});

describe('isMalformedEndpoint: URL のパスとして書けない形', () => {
  it('`//`・`?`・`#`・`.` / `..` のセグメントは誤り。普通のパスは誤りではない', () => {
    for (const endpoint of ['/api//x', '/api/x?a=1', '/api/x#top', '/api/../x', '/api/./x', '/..']) expect(isMalformedEndpoint(endpoint), endpoint).toBe(true);
    for (const endpoint of ['/api/x', '/api/x/', '/', '/a/b..c/.d']) expect(isMalformedEndpoint(endpoint), endpoint).toBe(false);
  });
});
