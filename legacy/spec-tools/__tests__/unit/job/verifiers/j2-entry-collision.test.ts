/**
 * J2(続き)HTTP の入口の衝突のユニットテスト。
 *
 * ジョブの `endpoint`(手書きの起動口)と受信 Webhook の口(生成器が書く)は同じ URL の空間に入る。同じ URL を 2 つの持ち主が取れば、
 * 片方が黙って上書きする。ここは**主張を集めて配置に当てる**部分(`entryClaimsOf`)と、検査(`verifyEntryCollision`)の両方を見る。
 */

import { describe, expect, it } from 'vitest';
import { entryClaimsOf, INBOUND_ROUTE_GENERATOR_ID, verifyEntryCollision } from '../../../../lib/job/verifiers/j2-entry-collision.js';
import { inboundRouteGenerator } from '../../../../lib/generate/render/code-inbound-route.js';
import { NEXTJS_LAYOUT } from '../../../../lib/targets/nextjs/layout.js';
import { jobModel, notScheduledJob, outboxJob, scheduledJob } from '../../../helpers/job-builder.js';
import { externalModel, integration } from '../../../helpers/external-builder.js';
import { authCallback, authLogout, authModel } from '../../../helpers/auth-builder.js';
import { PRODUCT_DECL_FILE } from '../../../../lib/io/paths.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../../helpers/platform.js';
import { screenInput, screenSpec } from '../../../helpers/screen-builder.js';
import type { ScreenSpecModel } from '../../../../lib/model/screen/types.js';

/** 画面の route から画面仕様のモデルを作る(画面の主張の材料)。 */
function screensOf(...routes: readonly (readonly [string, string])[]): ScreenSpecModel {
  return screenInput({ screens: routes.map(([name, route]) => screenSpec({ name, route })) }).screens;
}

/** 受信の連携 1 件(`/api/inbound/{id}` に結ばれる)。 */
function inbound(id: string) {
  return integration(id, { direction: 'inbound', signature: 'hmac_sha256', signatureKey: 'K', eventIdTable: 't', emits: 'a.b' });
}

const EXTERNAL = externalModel([inbound('billing_hook'), integration('discord_webhook')]).catalog ?? undefined;
const JOBS = jobModel([
  scheduledJob('run_due_jobs', { endpoint: '/api/jobs/run' }),
  scheduledJob('close_due_workshops', { endpoint: '/api/deadlines/run' }),
  outboxJob('notify_organizer_new_entry'),
  notScheduledJob('not_wired_yet', 'まだ結線していない'),
]);

describe('entryClaimsOf: 主張の集め方', () => {
  it('ジョブの endpoint(持ち主は製品)と、受信の連携の口と配線(持ち主は受信口の生成器)を宣言の並びで集める。送信の連携・起動口の無いジョブは主張しない', () => {
    expect(entryClaimsOf(JOBS, EXTERNAL)).toEqual([
      { role: 'http-entry', key: '/api/jobs/run', owner: 'product', source: 'ジョブ run_due_jobs の endpoint /api/jobs/run' },
      { role: 'http-entry', key: '/api/deadlines/run', owner: 'product', source: 'ジョブ close_due_workshops の endpoint /api/deadlines/run' },
      { role: 'http-entry', key: '/api/inbound/billing_hook', owner: 'code-inbound-route', source: '外部連携 billing_hook の受信口 /api/inbound/billing_hook' },
      { role: 'composition-root', key: 'billing_hook', owner: 'code-inbound-route', source: '外部連携 billing_hook の受信の配線' },
    ]);
  });

  it('画面の route は役割をまたぐ主張(screen-shell・持ち主は製品)として最後に足す。画面を採っていない・省略ならジョブと受信だけ', () => {
    const claims = entryClaimsOf(jobModel([scheduledJob('run_due_jobs', { endpoint: '/api/jobs/run' })]), undefined, screensOf(['home', '/'], ['detail', '/workshops/:id']));
    expect(claims.map((claim) => [claim.role, claim.key, claim.owner])).toEqual([
      ['http-entry', '/api/jobs/run', 'product'],
      ['screen-shell', '/', 'product'],
      ['screen-shell', '/workshops/:id', 'product'],
    ]);
    expect(claims[1]?.source).toBe('画面 home の route /');
    expect(entryClaimsOf(JOBS, undefined, { ...screensOf(['home', '/']), available: false })).toEqual(entryClaimsOf(JOBS, undefined));
  });

  it('外部連携カタログが読めなければ、ジョブの主張だけ', () => {
    expect(entryClaimsOf(JOBS, undefined).map((claim) => claim.owner)).toEqual(['product', 'product']);
  });

  it('持ち主の生成器の ID は、実際の受信口の生成器の ID と、Next.js の配置が宣言した持ち主の ID と同じ(食い違えば宣言されていない持ち主として赤になる)', () => {
    expect(INBOUND_ROUTE_GENERATOR_ID).toBe(inboundRouteGenerator.id);
    const owners = ['http-entry', 'composition-root'].flatMap((role) => NEXTJS_LAYOUT[role as 'http-entry']?.owners ?? []);
    expect(owners.filter((owner) => owner.kind === 'generator').map((owner) => owner.id)).toEqual([
      INBOUND_ROUTE_GENERATOR_ID,
      INBOUND_ROUTE_GENERATOR_ID,
    ]);
  });
});

describe('entryClaimsOf: ログアウトの口', () => {
  it('ログアウトの口は製品の主張(手書き。中身はセッションの adapter)で、認証の口と同じ URL を取れば衝突する', () => {
    const claims = entryClaimsOf(jobModel([]), undefined, undefined, authModel({ logout: authLogout('/api/auth/logout') }));
    expect(claims.map((claim) => [claim.role, claim.key, claim.owner])).toEqual([['http-entry', '/api/auth/logout', 'product']]);
    const clash = verifyEntryCollision({
      jobs: jobModel([]),
      external: undefined,
      roots: TEST_ROOTS,
      layout: TEST_LAYOUT,
      auth: authModel({ callback: authCallback('/api/auth/x'), logout: authLogout('/api/auth/x') }),
    });
    expect(clash.map((finding) => finding.message.startsWith('HTTP の入口が衝突しています'))).toEqual([true]);
  });

  it('ログアウトの口の URL の書き誤りも指す(仕様に書く URL なので)', () => {
    const findings = verifyEntryCollision({ jobs: jobModel([]), external: undefined, roots: TEST_ROOTS, layout: TEST_LAYOUT, auth: authModel({ logout: authLogout('/api//x') }) });
    expect(findings.map((finding) => finding.counterexample)).toEqual([{ owner: 'logout', endpoint: '/api//x' }]);
  });
});

describe('verifyEntryCollision', () => {
  const run = (jobs = JOBS, external = EXTERNAL, layout = TEST_LAYOUT, roots = TEST_ROOTS) => verifyEntryCollision({ jobs, external, roots, layout });

  it('URL が重ならなければ違反なし', () => {
    expect(run()).toEqual([]);
  });

  it('ジョブの endpoint が受信口の URL と同じなら、2 つの持ち主を名指してエラー', () => {
    const jobs = jobModel([scheduledJob('sneaky', { endpoint: '/api/inbound/billing_hook' })]);

    const findings = run(jobs);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'J2', severity: 'error' });
    expect(findings[0]?.message).toContain('HTTP の入口が衝突しています');
    expect(findings[0]?.message).toContain('ジョブ sneaky の endpoint /api/inbound/billing_hook / 外部連携 billing_hook の受信口 /api/inbound/billing_hook');
    expect(findings[0]?.counterexample).toEqual({
      kind: 'duplicate_path',
      sources: 'ジョブ sneaky の endpoint /api/inbound/billing_hook / 外部連携 billing_hook の受信口 /api/inbound/billing_hook',
    });
  });

  it('2 つのジョブが同じ endpoint を取っても衝突', () => {
    const jobs = jobModel([scheduledJob('a', { endpoint: '/api/x/run' }), scheduledJob('b', { endpoint: '/api/x/run' })]);

    expect(run(jobs).map((finding) => finding.counterexample?.['kind'])).toEqual(['duplicate_path']);
  });

  it('配置を差し替えても同じ(URL の空間の衝突は配置の綴りに依らない)', () => {
    const jobs = jobModel([scheduledJob('sneaky', { endpoint: '/api/inbound/billing_hook' })]);

    expect(run(jobs, EXTERNAL, FOREIGN_LAYOUT)).toHaveLength(1);
  });

  it('外部連携カタログが読めていなければ、受信口の主張を作れないのでジョブどうしだけを見る', () => {
    const jobs = jobModel([scheduledJob('sneaky', { endpoint: '/api/inbound/billing_hook' })]);

    expect(verifyEntryCollision({ jobs, external: undefined, roots: TEST_ROOTS, layout: TEST_LAYOUT })).toEqual([]);
  });

  it('大文字小文字だけ違う URL は衝突(大文字小文字を区別しないファイルシステムでは同じディレクトリになる)', () => {
    const jobs = jobModel([scheduledJob('a', { endpoint: '/api/Jobs/run' }), scheduledJob('b', { endpoint: '/api/jobs/run' })]);

    const findings = run(jobs, undefined);

    expect(findings.map((finding) => finding.counterexample?.['kind'])).toEqual(['duplicate_path']);
    expect(findings[0]?.message).toContain('HTTP の入口が衝突しています');
    expect(findings[0]?.message).toContain('大文字小文字だけ違う綴りも、大文字小文字を区別しないファイルシステムでは同じ置き場');
    expect(findings[0]?.message).toContain('src/app/api/Jobs/run/route.ts / src/app/api/jobs/run/route.ts');
  });

  it('endpoint に `//`・`?`・`#` があるのは仕様の誤りで、衝突とは別に指す(実装の木の有無に依らない。置き場の主張にはしない)', () => {
    for (const endpoint of ['/api//x', '/api/x?a=1', '/api/x#top']) {
      const jobs = jobModel([scheduledJob('odd', { endpoint })]);
      const [finding, ...rest] = run(jobs, undefined);
      expect(rest, endpoint).toEqual([]);
      expect(finding?.message, endpoint).toContain(`ジョブ odd の endpoint ${endpoint} が URL のパスとして書けません`);
      expect(finding?.counterexample).toEqual({ job: 'odd', endpoint });
      expect(run(jobs, undefined, TEST_LAYOUT, { ...TEST_ROOTS, app: null }).map((entry) => entry.message), endpoint).toEqual([finding?.message]);
    }
    expect(entryClaimsOf(jobModel([scheduledJob('odd', { endpoint: '/api/x?a=1' })]), undefined)).toEqual([]);
  });

  it('endpoint に `.` / `..` のセグメントがあるのも仕様の誤り(置き場が親ディレクトリへ出る)。置き場の主張にはしない', () => {
    for (const endpoint of ['/api/../x', '/api/./x', '/..']) {
      const jobs = jobModel([scheduledJob('odd', { endpoint })]);
      const findings = run(jobs, undefined);
      expect(findings.map((finding) => finding.message), endpoint).toEqual([`ジョブ odd の endpoint ${endpoint} が URL のパスとして書けません(\`//\`・\`?\`・\`#\`・\`.\` / \`..\` のセグメントを含んでいます)`]);
      expect(entryClaimsOf(jobs, undefined), endpoint).toEqual([]);
    }
  });

  it('endpoint が置き場 → 逆引きで同じ URL に戻らない(ルーティングに使わない名前・消える名前・パラレルルート・動的なセグメント)と、Cron が叩いても 404 になるので「置き場を決められません」', () => {
    for (const endpoint of ['/_cron/x', '/(g)/x', '/@a/x', '/[x]/y']) {
      const findings = run(jobModel([scheduledJob('cronjob', { endpoint })]), undefined);
      expect(findings.map((finding) => finding.counterexample?.['kind']), endpoint).toEqual(['not_reachable']);
      expect(findings[0]?.message, endpoint).toContain('HTTP の入口の置き場を決められません');
      expect(findings[0]?.message, endpoint).toContain(`ジョブ cronjob の endpoint ${endpoint}`);
      expect(findings[0]?.suggestion, endpoint).toContain('動的なセグメントを含まない');
    }
    expect(run(jobModel([scheduledJob('cronjob', { endpoint: '/api/jobs/run' })]), undefined)).toEqual([]);
  });

  it('ルーティングの規約で同じ URL になる綴り(/(g)/x と /x)は、パスが違っても 1 つの置き場の衝突', () => {
    const findings = run(jobModel([scheduledJob('a', { endpoint: '/(g)/x' }), scheduledJob('b', { endpoint: '/x' })]), undefined);

    expect(findings.map((finding) => finding.counterexample?.['kind'])).toEqual(['not_reachable', 'duplicate_path']);
    expect(findings[1]?.message).toContain('綴りは違うが、ルーティングの規約で同じ実体になる置き場');
  });

  it('同じセグメントに画面の器(page)と HTTP の入口(route)の両方を取る衝突は、画面の route も主張に入れて見る', () => {
    const jobs = jobModel([scheduledJob('cronjob', { endpoint: '/health' })]);
    const input = { jobs, external: undefined, roots: TEST_ROOTS, layout: TEST_LAYOUT };

    const findings = verifyEntryCollision({ ...input, screens: screensOf(['health', '/health']) });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('HTTP の入口が衝突しています');
    expect(findings[0]?.message).toContain('ジョブ cronjob の endpoint /health / 画面 health の route /health');
    expect(findings[0]?.suggestion).toContain('画面の route');
    // 画面を渡さなければ(画面を採っていない)見ない・URL が違えば衝突しない・実装の木が無ければ置き場を見ない。
    expect(verifyEntryCollision(input)).toEqual([]);
    expect(verifyEntryCollision({ ...input, screens: screensOf(['health', '/healthz']) })).toEqual([]);
    expect(verifyEntryCollision({ ...input, roots: { ...TEST_ROOTS, app: null }, screens: screensOf(['health', '/health']) })).toEqual([]);
  });

  it('画面の主張だけが関わる指摘(画面どうしの route の重複・辿れない route)は S1 / S7 の持ち物なので、J2 は言わない', () => {
    const jobs = jobModel([scheduledJob('cronjob', { endpoint: '/api/x/run' })]);
    const input = { jobs, external: undefined, roots: TEST_ROOTS, layout: TEST_LAYOUT };

    expect(verifyEntryCollision({ ...input, screens: screensOf(['a', '/same'], ['b', '/same'], ['hidden', '/_private/x']) })).toEqual([]);
  });

  it('1 ジョブ 1 本: 2 つのジョブが同じ endpoint を共有すれば衝突(同じ URL を 2 つのジョブで共有しない)', () => {
    const jobs = jobModel([scheduledJob('a', { endpoint: '/api/shared/run' }), scheduledJob('b', { endpoint: '/api/shared/run/' })]);

    expect(run(jobs, undefined).map((finding) => finding.counterexample?.['kind'])).toEqual(['duplicate_path']);
  });

  it('配置が役割を宣言していない構成は、黙って見ない形にせず「置き場を決められません」と衝突とは別の文面で言う', () => {
    const jobs = jobModel([scheduledJob('sneaky', { endpoint: '/api/inbound/billing_hook' })]);

    const findings = run(jobs, EXTERNAL, {});

    expect(findings.map((finding) => finding.counterexample?.['kind'])).toEqual(['unknown_role', 'unknown_role', 'unknown_role']);
    for (const finding of findings) {
      expect(finding.message).toContain('HTTP の入口の置き場を決められません');
      expect(finding.message).not.toContain('衝突');
      expect(finding.suggestion).not.toContain('別の URL に直す');
    }
  });

  it('実装の木を持たない製品は置き場を見ない(置き場が無いことが事実)', () => {
    const jobs = jobModel([scheduledJob('sneaky', { endpoint: '/api/inbound/billing_hook' })]);
    expect(run(jobs, EXTERNAL, TEST_LAYOUT, { ...TEST_ROOTS, app: null })).toEqual([]);
    expect(verifyEntryCollision({ jobs: { available: false, catalog: null }, external: EXTERNAL, roots: { ...TEST_ROOTS, app: null }, layout: TEST_LAYOUT, screens: screensOf(['x', '/api/inbound/billing_hook']) })).toEqual([]);
  });

  it('ジョブのカタログを採らない製品でも、実装の木があれば受信口と画面の route の衝突は見る(位置は製品の宣言の実装の木。ジョブの主張が無いだけで検査は同じ)', () => {
    const noJobs = { available: false, catalog: null } as const;
    const input = { jobs: noJobs, external: EXTERNAL, roots: TEST_ROOTS, layout: TEST_LAYOUT };

    expect(verifyEntryCollision(input)).toEqual([]);
    const findings = verifyEntryCollision({ ...input, screens: screensOf(['hook', '/api/inbound/billing_hook']) });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'J2', severity: 'error', location: { file: PRODUCT_DECL_FILE, pointer: 'roots.app' } });
    expect(findings[0]?.message).toContain('HTTP の入口が衝突しています');
    expect(findings[0]?.message).toContain('外部連携 billing_hook の受信口 /api/inbound/billing_hook / 画面 hook の route /api/inbound/billing_hook');
    // 外部連携が読めない(受信口の主張が無い)ときは、画面だけなので衝突しない。
    expect(verifyEntryCollision({ ...input, external: undefined, screens: screensOf(['hook', '/api/inbound/billing_hook']) })).toEqual([]);
  });
});

describe('認証の callback と送信の連携の endpoints(手書きの口)の主張', () => {
  const AI = externalModel([integration('anthropic_chat', { service: 'anthropic', effect: 'read', endpoints: ['/api/ai/tutorial', '/api/ai/program-draft'] })]).catalog ?? undefined;
  const AUTH = authModel({ callback: authCallback('/api/auth/callback') });

  it('持ち主は製品(手書きの Route Handler)。ジョブ → 外部連携の宣言順 → 認証の口の順に、宣言の出どころを添えて集める', () => {
    const claims = entryClaimsOf(JOBS, AI, undefined, AUTH);

    expect(claims.map((claim) => [claim.role, claim.key, claim.owner, claim.source])).toEqual([
      ['http-entry', '/api/jobs/run', 'product', 'ジョブ run_due_jobs の endpoint /api/jobs/run'],
      ['http-entry', '/api/deadlines/run', 'product', 'ジョブ close_due_workshops の endpoint /api/deadlines/run'],
      ['http-entry', '/api/ai/tutorial', 'product', '外部連携 anthropic_chat の endpoints /api/ai/tutorial'],
      ['http-entry', '/api/ai/program-draft', 'product', '外部連携 anthropic_chat の endpoints /api/ai/program-draft'],
      ['http-entry', '/api/auth/callback', 'product', '認証 callback の endpoint /api/auth/callback'],
    ]);
  });

  it('認証仕様を渡さない・読めない・callback を持たないなら、認証の口の主張は無い', () => {
    const sources = (auth?: ReturnType<typeof authModel>) => entryClaimsOf(JOBS, undefined, undefined, auth).map((claim) => claim.source);

    expect(sources(undefined)).toHaveLength(2);
    expect(sources({ available: true, flow: null })).toHaveLength(2);
    expect(sources(authModel({}))).toHaveLength(2);
  });

  it('認証の callback がジョブの endpoint と同じ URL を取れば、2 つの持ち主を名指して衝突', () => {
    const jobs = jobModel([scheduledJob('sneaky', { endpoint: '/api/auth/callback' })]);

    const findings = verifyEntryCollision({ jobs, external: undefined, roots: TEST_ROOTS, layout: TEST_LAYOUT, auth: AUTH });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('HTTP の入口が衝突しています');
    expect(findings[0]?.message).toContain('ジョブ sneaky の endpoint /api/auth/callback / 認証 callback の endpoint /api/auth/callback');
    expect(findings[0]?.suggestion).toContain('認証の callback');
  });

  it('送信の連携の endpoints が受信口の URL や別の連携の口と同じなら衝突。認証仕様を渡さなければ callback の主張は無いので衝突しない', () => {
    const external = externalModel([
      inbound('billing_hook'),
      integration('a', { service: 'anthropic', effect: 'read', endpoints: ['/api/inbound/billing_hook', '/api/ai/x'] }),
      integration('b', { service: 'anthropic', effect: 'read', endpoints: ['/api/ai/x'] }),
    ]).catalog ?? undefined;
    const jobs = jobModel([]);

    const findings = verifyEntryCollision({ jobs, external, roots: TEST_ROOTS, layout: TEST_LAYOUT });

    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('外部連携 billing_hook の受信口 /api/inbound/billing_hook / 外部連携 a の endpoints /api/inbound/billing_hook'),
      expect.stringContaining('外部連携 a の endpoints /api/ai/x / 外部連携 b の endpoints /api/ai/x'),
    ]);
    expect(verifyEntryCollision({ jobs, external: AI, roots: TEST_ROOTS, layout: TEST_LAYOUT })).toEqual([]);
    expect(verifyEntryCollision({ jobs: jobModel([scheduledJob('x', { endpoint: '/api/auth/callback' })]), external: AI, roots: TEST_ROOTS, layout: TEST_LAYOUT })).toEqual([]);
  });

  it('callback.endpoint と endpoints の書き誤り(`//`・`?`・`#`・`.` / `..`)も、実装の木の有無に依らず URL のパスの誤りとして指す(置き場の主張にはしない)', () => {
    const badAuth = authModel({ callback: authCallback('/api/auth//callback') });
    const badExternal = externalModel([integration('anthropic_chat', { service: 'anthropic', effect: 'read', endpoints: ['/api/ai/x?a=1', '/api/../y'] })]).catalog ?? undefined;
    const noTree = { ...TEST_ROOTS, app: null };

    const found = verifyEntryCollision({ jobs: jobModel([]), external: badExternal, roots: noTree, layout: TEST_LAYOUT, auth: badAuth });

    expect(found.map((finding) => finding.message)).toEqual([
      '外部連携 anthropic_chat の endpoints /api/ai/x?a=1 が URL のパスとして書けません(`//`・`?`・`#`・`.` / `..` のセグメントを含んでいます)',
      '外部連携 anthropic_chat の endpoints /api/../y が URL のパスとして書けません(`//`・`?`・`#`・`.` / `..` のセグメントを含んでいます)',
      '認証 callback の endpoint /api/auth//callback が URL のパスとして書けません(`//`・`?`・`#`・`.` / `..` のセグメントを含んでいます)',
    ]);
    expect(found[0]?.counterexample).toEqual({ integration: 'anthropic_chat', endpoint: '/api/ai/x?a=1' });
    expect(found[2]).toMatchObject({ location: { file: 'docs/specs/backend/auth.md', pointer: 'callback' }, counterexample: { owner: 'callback', endpoint: '/api/auth//callback' } });
    expect(entryClaimsOf(jobModel([]), badExternal, undefined, badAuth)).toEqual([]);
    // 実装の木があっても、書き誤りは置き場の衝突としては数えず 1 度だけ指す。
    expect(verifyEntryCollision({ jobs: jobModel([]), external: badExternal, roots: TEST_ROOTS, layout: TEST_LAYOUT, auth: badAuth })).toHaveLength(3);
  });
});
