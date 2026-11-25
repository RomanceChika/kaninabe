/**
 * S7(実ルートとの突合)のテスト。
 *
 * 規約(scripts-code-quality.md)の「規約網羅」に従い、screen-spec-writing.md の S7 が
 * 要求する各項目(仕様 → 実ルート・実ルート → 仕様・requires_auth と matcher の被覆)に
 * 1 つ以上のケースを置く。実装のファイルシステムは読まず、モデルをリテラル構築する
 * (走査そのものは app-loader.test.ts が fixture で見る)。
 */

import { describe, expect, it } from 'vitest';
import type { AuthGateDecl } from '../../../../lib/model/auth/types.js';
import type { AppRoutesModel } from '../../../../lib/model/screen/app-types.js';
import type { ScreenSpec } from '../../../../lib/model/screen/types.js';
import { implementationRouteFindings, implementationRoutesVerifier } from '../../../../lib/screen/verifiers/s7-implementation-routes.js';
import { routeFromPageFile } from '../../../../lib/targets/nextjs/layout.js';
import { FOREIGN_LAYOUT } from '../../../helpers/platform.js';
import { appRoutes, SCREEN_CTX, screenInput, screenSpec } from '../../../helpers/screen-builder.js';

/** S7 を実行して Finding を返す。 */
function run(init: Parameters<typeof screenInput>[0]) {
  return implementationRoutesVerifier.verify(screenInput(init), SCREEN_CTX);
}

/** 実装と仕様が揃っている 2 枚。 */
const SCREENS = [
  screenSpec({ name: 'home', route: '/' }),
  screenSpec({ name: 'workshop_detail', route: '/workshops/:id', requiresAuth: true }),
];

describe('S7 関門の中の generateMetadata(点検 14 回目 B14-1)', () => {
  const GATES = [
    { id: 'session', guards: 'requires_auth', implementation: 'a.ts::requireSession' },
    { id: 'staff', guards: 'role_gate', role: 'staff', implementation: 'a.ts::requireStaff' },
  ] as unknown as readonly AuthGateDecl[];
  const verify = (screens: readonly ScreenSpec[], metadata: AppRoutesModel['routes'][number]['metadata']) =>
    implementationRouteFindings(screens, appRoutes({ routes: screens.map((screen) => screen.route), matcher: ['/x/:path*'], metadata: Object.fromEntries(screens.map((screen) => [screen.route, metadata])) }), { roots: SCREEN_CTX.roots, layout: SCREEN_CTX.layout }, GATES);
  const signedIn = screenSpec({ name: 'x_detail', route: '/x/:id', requiresAuth: true });
  const staff = screenSpec({ name: 'x_admin', route: '/x/admin', requiresAuth: true, for: ['staff'] });
  const open = screenSpec({ name: 'x_public', route: '/public' });

  it.each([
    ['要ログインの画面で関門の外', signedIn, { kind: 'unreadable' }],
    ['要ログインの画面で関門の実装でない呼び出しを待つ', signedIn, { kind: 'gated', symbol: 'readRows' }],
    ['ロールの画面でセッションの関門だけ', staff, { kind: 'gated', symbol: 'requireSession' }],
  ] as const)('%s は赤', (_name, screen, form) => {
    expect(verify([screen], form).map((finding) => finding.message)).toEqual([expect.stringContaining('関門の中にありません')]);
  });

  it.each([
    ['置いていない', signedIn, { kind: 'none' }],
    ['要ログインの画面で最初の文が関門', signedIn, { kind: 'gated', symbol: 'requireSession' }],
    ['ロールの画面で最初の文がロールの関門', staff, { kind: 'gated', symbol: 'requireStaff' }],
    ['関門の無い公開の画面は形を問わない', open, { kind: 'unreadable' }],
  ] as const)('%s は通す', (_name, screen, form) => {
    expect(verify([screen], form)).toEqual([]);
  });
});

describe('S7 実ルートとの突合', () => {
  it('仕様と実ルートが 1 対 1 で、要ログイン画面が matcher に覆われていれば通る', () => {
    const findings = run({
      screens: SCREENS,
      app: appRoutes({ routes: ['/', '/workshops/:id'], matcher: ['/workshops/:path*'] }),
    });

    expect(findings).toEqual([]);
  });

  it('app/ を読めていなければ何も見ない(実装の無い構成でも壊れない)', () => {
    expect(run({ screens: SCREENS })).toEqual([]);
  });

  it('同じ位置の静的セグメントと動的セグメント(/workshops/new と /workshops/:id)は別の route として 1 対 1 に突合する(Next の静的優先は照合の対象ではなく、キーの一致だけを見る)', () => {
    const screens = [
      screenSpec({ name: 'workshop_new', route: '/workshops/new' }),
      screenSpec({ name: 'workshop_detail', route: '/workshops/:id' }),
    ];
    expect(run({ screens, app: appRoutes({ routes: ['/workshops/new', '/workshops/:id'] }) })).toEqual([]);
    const missing = run({ screens, app: appRoutes({ routes: ['/workshops/:id'] }) });
    expect(missing.map((finding) => finding.message)).toEqual([expect.stringContaining('/workshops/new に対応する実ルート')]);
  });

  it('仕様にあるのに実ルートが無ければ失敗する', () => {
    const findings = run({
      screens: [screenSpec({ name: 'entry_new', route: '/workshops/:id/entries/new' })],
      app: appRoutes({ routes: ['/'], matcher: [] }),
    });

    expect(findings).toHaveLength(2); // 実ルート欠落 + 逆方向(/ の宣言が無い)
    const missing = findings.find((finding) => finding.message.includes('実ルートが'));
    expect(missing?.message).toContain('/workshops/:id/entries/new');
    expect(missing?.suggestion).toContain('app/src/app/workshops/[id]/entries/new/page.tsx');
  });

  it('実ルートがあるのに仕様が無ければ失敗する(逆方向。検査の穴を静かに開けさせない)', () => {
    const findings = run({
      screens: [screenSpec({ name: 'home', route: '/' })],
      app: appRoutes({ routes: ['/', '/admin'], matcher: [] }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('実ルート /admin を宣言している screen_spec がありません');
    expect(findings[0]?.location.file).toBe('app/src/app/admin/page.tsx');
  });

  it.each([
    ['@modal/organizer/reports/[id]/page.tsx'],
    ['@modal/api/preview/page.tsx'],
    ['@modal/default.tsx'],
    ['@modal/[...all]/page.tsx'],
    ['zint/(.)zt/page.tsx'],
  ])('点検 13 回目 B13-1 の反例 %s は、宣言していなくても「未対応の配置」で赤になる', (file) => {
    const route = routeFromPageFile(file);
    if (route === null) throw new Error(`${file} が分類から落ちた`);
    const findings = run({ screens: [], app: appRoutes({ routes: [route] }) });
    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('未対応の配置')]);
  });

  it('キャッチオールの page は「未対応」と名指し、route を書けと案内しない(書くと S1 が止めて循環するため)', () => {
    // 実装の木の逆引き(置き場の綴り → route)を実際に通して S7 まで届ける。
    const caught = routeFromPageFile('docs/[...slug]/page.tsx');
    expect(caught).not.toBeNull();
    const findings = run({
      screens: [screenSpec({ name: 'home', route: '/' })],
      app: appRoutes({ routes: ['/', caught ?? ''], matcher: [] }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('未対応の配置');
    expect(findings[0]?.message).not.toContain('宣言している screen_spec がありません');
    expect(findings[0]?.suggestion).not.toMatch(/screen_spec を書く/);
    expect(findings[0]?.suggestion).toContain('S1 が文法外として止める');
  });

  it('requires_auth: true の画面が matcher に覆われていなければ失敗する', () => {
    const findings = run({
      screens: [screenSpec({ name: 'settings', route: '/settings', requiresAuth: true })],
      app: appRoutes({ routes: ['/settings'], matcher: ['/workshops/:path*'] }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('matcher に覆われていません');
    expect(findings[0]?.severity).toBe('error');
  });

  it('requires_auth が false の画面は matcher の被覆を問わない', () => {
    const findings = run({
      screens: [screenSpec({ name: 'login', route: '/login' })],
      app: appRoutes({ routes: ['/login'], matcher: [] }),
    });

    expect(findings).toEqual([]);
  });

  it('matcher を読めなければ「覆っている」ではなく警告にする', () => {
    const findings = run({
      screens: [screenSpec({ name: 'settings', route: '/settings', requiresAuth: true })],
      app: appRoutes({ routes: ['/settings'] }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.message).toContain('matcher を読めませんでした');
  });

  it('静的に解釈できない matcher は検査の範囲外として警告する', () => {
    const findings = run({
      screens: [screenSpec({ name: 'settings', route: '/settings', requiresAuth: true })],
      app: appRoutes({ routes: ['/settings'], matcher: ['/settings/:id(\\d+)'] }),
    });

    // 解釈できない旨の警告 + 覆えていないというエラー(黙って緑にしない)。
    expect(findings.map((finding) => finding.severity)).toEqual(['warning', 'error']);
    expect(findings[0]?.message).toContain('静的に解釈できない');
  });
});

describe('S7 置き場の配置から読む(Next.js と綴りの重ならない架空の配置)', () => {
  const foreign = { ...SCREEN_CTX, layout: FOREIGN_LAYOUT, roots: { ...SCREEN_CTX.roots, app: 'app' } };
  const runForeign = (init: Parameters<typeof screenInput>[0]) => implementationRoutesVerifier.verify(screenInput(init), foreign);

  it('仕様の route に実ルートが無いときの道案内は、配置の画面の器の置き場と走査の根になる(Next.js の綴りが 1 つも出ない)', () => {
    const findings = runForeign({
      screens: [screenSpec({ name: 'entry_new', route: '/workshops/:id/entries/new' })],
      app: appRoutes({ routes: ['/'], matcher: [] }),
    });

    const missing = findings.find((finding) => finding.message.includes('実ルートが'));
    expect(missing?.message).toBe('route /workshops/:id/entries/new に対応する実ルートが app/server_code/pages にありません');
    expect(missing?.suggestion).toContain('app/server_code/pages/workshops/:id/entries/new.view.ts を作るか');
    for (const finding of findings) expect(`${finding.message}${finding.suggestion}`).not.toMatch(/page\.tsx|proxy\.ts|src\/app/);
  });

  it('保護範囲を読めないときの道案内は、配置のリクエスト前段の置き場になる', () => {
    const findings = runForeign({
      screens: [screenSpec({ name: 'settings', route: '/settings', requiresAuth: true })],
      app: appRoutes({ routes: ['/settings'] }),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestion).toContain('edge_filter.ts に `export const config = { matcher: [...] }`');
  });
});

describe('S7 辿れない route(置き場 → 逆引きが同じ route に戻らない。原因が配置の側にあることを実ルートの欠落とは別に言う)', () => {
  it('ルーティングに使わない名前の下の route は、実ルートの欠落とは別の指摘になる', () => {
    const findings = run({
      screens: [screenSpec({ name: 'hidden', route: '/_private/x' })],
      app: appRoutes({ routes: ['/_private/x'], matcher: [] }),
    });

    const unreachable = findings.filter((finding) => finding.message.includes('逆引きでは同じキーに戻りません'));
    expect(unreachable).toHaveLength(1);
    expect(unreachable[0]?.verifier).toBe('S7');
    expect(unreachable[0]?.location).toEqual({ file: 'docs/specs/frontend/screens/sample/hidden.md', pointer: 'route' });
    expect(unreachable[0]?.counterexample).toEqual({ screen: 'hidden', route: '/_private/x' });
  });

  it('route の重複は S1 の持ち物なので S7 は言わない・辿れる route は何も言わない', () => {
    const findings = run({
      screens: [screenSpec({ name: 'a', route: '/same' }), screenSpec({ name: 'b', route: '/same' })],
      app: appRoutes({ routes: ['/same'], matcher: [] }),
    });

    expect(findings.filter((finding) => finding.message.includes('同じ置き場'))).toEqual([]);
    expect(findings.filter((finding) => finding.message.includes('逆引き'))).toEqual([]);
  });
});

describe('S7 配置の欠落(部品化 ③-c2b): 黙って全部をスキップしない', () => {
  it('実装の木があるのに配置が画面の器の走査を決められない(placementProblem)ときは、スキップではなく前提の失敗(error)', () => {
    const findings = run({
      screens: SCREENS,
      app: { ...appRoutes({ routes: [] }), available: false, placementProblem: '置き場の配置から画面の器(screen-shell)の走査の根を決められません(テスト)' },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'S7', severity: 'error', location: { file: 'docs/specs/frontend/screens' }, counterexample: { role: 'screen-shell' } });
    expect(findings[0]?.message).toBe('実ルートとの突合の前提が満たされていません: 置き場の配置から画面の器(screen-shell)の走査の根を決められません(テスト)');
    expect(findings[0]?.suggestion).toContain('配置の定義の検査が、選ぶ根の 1 回でこの欠落を先に止める');
  });

  it('placementProblem が無い available: false(実装がまだ無い)は従来どおり何も見ない', () => {
    expect(run({ screens: SCREENS, app: { ...appRoutes({ routes: [] }), available: false } })).toEqual([]);
  });

  it('配置にリクエスト前段が無い(requestGateMissing)なら、matcher の被覆は警告にも緑の宣言にもしない(実行ログが「未実施」と言う)。実ルートの突合は続ける', () => {
    const app = { ...appRoutes({ routes: ['/', '/workshops/:id'] }), requestGateMissing: true as const, proxy: { available: false, file: '', patterns: [] } };
    expect(run({ screens: SCREENS, app })).toEqual([]);
    const missing = run({ screens: SCREENS, app: { ...app, routes: [] } });
    expect(missing.map((finding) => finding.message)).toEqual([
      'route / に対応する実ルートが app/src/app にありません',
      'route /workshops/:id に対応する実ルートが app/src/app にありません',
    ]);
  });
});
