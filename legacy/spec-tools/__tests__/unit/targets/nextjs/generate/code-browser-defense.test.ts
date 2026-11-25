/**
 * アプリの枠の後段 Next.js のブラウザ側の守りの生成器 2 本(`code-browser-defense` / `code-browser-defense-tests`)のユニットテスト。
 *
 * 固定するのは —— ①宣言の値とリクエスト前段が書き出され、前段は守りの判定 → セッションの更新 → 応答のヘッダの順で、保護範囲は宣言の接頭辞を除く全部
 * ②見張りテストは cookie で認証する口(送信の連携の endpoints とサインインの開始・ログアウトの口)の状態を変えるメソッドを全部載せ、保証台帳が名指すテスト名と ID を持つ
 * ③ログアウトの口は出どころの確認と消去の応答だけを配線する ④実装の木を持たない製品・宣言の無い製品では何も出さない ⑤別の配置では書き先も import も配置に従う。
 */

import { describe, expect, it } from 'vitest';
import { specModel, stubGuards } from '../../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';
import { FOREIGN_BODY_COMPATIBLE_LAYOUT, FOREIGN_ROOTS, TEST_LAYOUT, TEST_PLATFORM } from '../../../../helpers/platform.js';
import { NO_GATES } from '../../../../helpers/generate-context.js';
import { externalModel, integration } from '../../../../helpers/external-builder.js';
import { authEntry, authLogout, authModel } from '../../../../helpers/auth-builder.js';
import type { GenerateContext } from '../../../../../lib/gen-kit/generator.js';
import { browserDefenseGenerator, matcherExclusionTerm, requestGateMatcher } from '../../../../../lib/targets/nextjs/generate/code-browser-defense.js';
import { BROWSER_DEFENSE_TCS, browserDefenseTestsGenerator } from '../../../../../lib/targets/nextjs/generate/code-browser-defense-tests.js';
import { NEXTJS_BROWSER_DEFENSE } from '../../../../../lib/targets/nextjs/browser-defense.js';
import { layoutPath } from '../../../../../lib/model/product/layout.js';
import type { LayoutRole, ProductLayout } from '../../../../../lib/model/product/layout.js';
import { DEEP_FREEZE_HELPER, generatedFile } from '../../../../../lib/gen-kit/code-emit.js';

/** 配置が決める置き場(テストに製品の木のパスを直書きしない)。 */
function placeOf(role: LayoutRole, key?: string, layout: ProductLayout = TEST_LAYOUT, app: string | null = TEST_ROOTS.app): string | null {
  return layoutPath(layout, app, role, key);
}
import { BROWSER_DEFENSE_WORDING } from '../../../../../lib/messages/messages-browser-defense.js';

/** 生成の文脈(省いた欄は無い)。 */
function context(extra: Partial<GenerateContext> = {}): GenerateContext {
  return { guards: stubGuards(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, ...extra };
}

/** cookie で認証する口を 2 本持つ外部連携(ブラウザから叩く口)。 */
const EXTERNAL = externalModel([integration('chat', { service: 'anthropic', effect: 'read', endpoints: ['/api/ai/a', '/api/ai/b'] })]);

describe('code-browser-defense(宣言の値とリクエスト前段)', () => {
  it('宣言の値は実行時パッケージの型で書き出し、開発中だけ足す源の理由を注釈に残す', () => {
    const [policy] = browserDefenseGenerator.generate(specModel([]), context());
    expect(policy?.file).toBe(generatedFile(TEST_ROOTS, 'browser-defense.ts'));
    expect(policy?.content).toContain("import type { BrowserDefensePolicy } from '@kaninabe/runtime/http/browser-defense';");
    expect(policy?.content).toContain('export const BROWSER_DEFENSE: BrowserDefensePolicy = deepFreeze({');
    // 値は深く凍結する(実行時の書き換えで no-store・CSP を外させない。点検 7 回目 B7-5)。
    expect(policy?.content).toContain(DEEP_FREEZE_HELPER.join('\n'));
    expect(policy?.content?.trimEnd().endsWith('});')).toBe(true);
    expect(policy?.content).toContain("- 開発中だけ script-src に 'unsafe-eval' を足す: ");
    expect(policy?.content).not.toContain('reason');
  });

  it('リクエスト前段は宣言の接頭辞を除く全部を通り、守りの判定 → セッションの更新 → 応答のヘッダの順で配線する', () => {
    const [, gate] = browserDefenseGenerator.generate(specModel([]), context());
    expect(gate?.file).toBe(placeOf('request-gate'));
    expect(requestGateMatcher(NEXTJS_BROWSER_DEFENSE)).toBe('/((?!api/|_next/static/|_next/image/|favicon\\.ico$).*)');
    expect(gate?.content).toContain("  matcher: ['/((?!api/|_next/static/|_next/image/|favicon\\\\.ico$).*)'],");
    expect(gate?.content).toContain("import { refreshSession } from '@/infrastructure/supabase/proxy-session';");
    const body = gate?.content ?? '';
    const order = ['gateDocumentRequest(request, BROWSER_DEFENSE', "if (gate.kind === 'refuse') return gate.response;", 'await refreshSession(request, gate.requestHeaders)', 'response.headers.set'];
    expect(order.map((line) => body.indexOf(line))).toEqual([...order.map((line) => body.indexOf(line))].sort((a, b) => a - b));
    expect(order.every((line) => body.includes(line))).toBe(true);
  });

  // 6 回目 B6-3: 除外は終端つき・エスケープつきの許可表(末尾 / は区切りつきの接頭辞、ほかは完全一致)。
  it.each([
    ['api/', 'api/'],
    ['_next/static/', '_next/static/'],
    ['favicon.ico', 'favicon\\.ico$'],
    ['a.b/', 'a\\.b/'],
    ['robots.txt', 'robots\\.txt$'],
    ['x', 'x$'],
  ])('除外の項: %s → %s', (exclusion, term) => {
    expect(matcherExclusionTerm(exclusion)).toBe(term);
  });

  it.each([
    ['/favicon.ico', false],
    ['/favicon.ico/x', true],
    ['/favicon.icoX', true],
    ['/faviconXico', true],
    ['/api/x', false],
    ['/api', true],
    ['/apix', true],
    ['/_next/static/a.js', false],
    ['/_next/staticX', true],
    ['/', true],
    ['/login', true],
  ])('生成した matcher の正規表現として %s が前段を通る = %s(似た URL は通る)', (url, through) => {
    expect(new RegExp(`^${requestGateMatcher(NEXTJS_BROWSER_DEFENSE)}$`).test(url)).toBe(through);
  });

  it('実装の木を持たない製品では何も出さない。別の配置では書き先も import も配置に従う', () => {
    expect(browserDefenseGenerator.generate(specModel([]), context({ roots: { ...TEST_ROOTS, app: null } }))).toEqual([]);
    const sections = browserDefenseGenerator.generate(specModel([]), context({ layout: FOREIGN_BODY_COMPATIBLE_LAYOUT, roots: FOREIGN_ROOTS }));
    expect(sections.map((section) => section.file)).toEqual([generatedFile(FOREIGN_ROOTS, 'browser-defense.ts'), placeOf('request-gate', undefined, FOREIGN_BODY_COMPATIBLE_LAYOUT, FOREIGN_ROOTS.app)]);
    expect(sections[1]?.content).toContain("import { refreshSession } from '~srv/store/session_renew';");
  });
});

describe('code-browser-defense-tests(配線の見張りテスト)', () => {
  it('cookie で認証する口(送信の連携の endpoints とサインインの開始・ログアウトの口)の、状態を変えるメソッドを全部載せる(本文が読めなければ POST)', () => {
    const routeSources = new Map([[placeOf('http-entry', '/api/ai/a') ?? '', 'export async function POST() {}\nexport async function GET() {}\nexport async function DELETE() {}']]);
    const [section] = browserDefenseTestsGenerator.generate(specModel([]), context({ external: EXTERNAL, auth: authModel({ start: authEntry('start'), logout: authLogout() }), routeSources }));
    expect(section?.file).toBe(placeOf('browser-defense-test'));
    const content = section?.content ?? '';
    expect(content).toContain("load: async () => (await import('@/app/api/ai/a/route')).DELETE },");
    expect(content).toContain("load: async () => (await import('@/app/api/auth/sign-in/route')).POST },");
    expect(content).toContain("load: async () => (await import('@/app/api/auth/logout/route')).POST },");
    const rows = [...content.matchAll(/^ {2}\{ source: .*endpoint: '([^']+)', method: '([^']+)'/gm)].map((match) => `${match[1] ?? ''} ${match[2] ?? ''}`);
    expect(rows).toEqual(['/api/ai/a POST', '/api/ai/a DELETE', '/api/ai/b POST', '/api/auth/sign-in POST', '/api/auth/logout POST']);
    expect(content).toContain("const APP_CONFIG = path.resolve(__dirname, '../../../../../next.config.ts');");
    expect(content).toContain("const ROOT_LAYOUT = path.resolve(__dirname, '../../../layout.tsx');");
  });

  it('口は外への呼び出しを観測の口に差し替えてから読み込み直し、モジュールの差し替えはしない(関門と同じ応答で閉じたかも見る)', () => {
    const content = browserDefenseTestsGenerator.generate(specModel([]), context({ external: EXTERNAL }))[0]?.content ?? '';
    expect(content).toContain("import { crossOriginRefusal } from '@kaninabe/runtime/http/request-origin';");
    expect(content).toContain("from '@kaninabe/runtime/testing/http/route-isolation';");
    expect(content).toContain('const probe = installNetworkProbe();');
    expect(content.indexOf('const probe = installNetworkProbe();')).toBeLessThan(content.indexOf('const handler = await route.load();'));
    expect(content).toContain('refusalShapeOf(crossOriginRefusal(BROWSER_DEFENSE))');
    expect(content).not.toMatch(/vi\.(?:mock|doMock|unmock|doUnmock)\(/);
  });

  it('宣言した全部の口の export したメソッドを出口の関所の表に載せ、関所が外の Location を止める対照を持つ(点検 10 回目 B10-1)', () => {
    const routeSources = new Map([
      [placeOf('http-entry', '/api/ai/a') ?? '', "export const POST = guardRoute(async () => new Response());\nexport const GET = guardRoute(async () => new Response());"],
      [placeOf('http-entry', '/api/auth/sign-in') ?? '', 'export const POST = guardRoute(async () => new Response());'],
    ]);
    const content =
      browserDefenseTestsGenerator.generate(specModel([]), context({ external: EXTERNAL, auth: authModel({ start: authEntry('start'), logout: authLogout() }), routeSources }))[0]?.content ?? '';
    const guarded = [...content.matchAll(/^ {2}\{ source: '([^']+)', method: '([^']+)', load/gm)].map((match) => `${match[1] ?? ''} ${match[2] ?? ''}`);
    expect(guarded).toHaveLength(3);
    expect(guarded.every((row) => /(\/api\/ai\/a (GET|POST)|\/api\/auth\/sign-in POST)$/u.test(row))).toBe(true);
    expect(content).toContain("import { ROUTE_GUARD_REFUSAL_STATUS, guardRoute, isGuardedRoute } from '@kaninabe/runtime/http/route-guard';");
    expect(content).toContain('if (!isGuardedRoute(await route.load())) unguarded.push(');
    expect(content).toContain("headers: { Location: 'https://evil.example/login' }");
    expect(content).toContain("headers: { 'Content-Type': 'text/html; charset=utf-8' }");
    expect(content).toContain("expect(refused.status).toBe(ROUTE_GUARD_REFUSAL_STATUS);");
    expect(content).toContain('expect(blocked.status).toBe(ROUTE_GUARD_REFUSAL_STATUS);');
  });

  it('保証台帳が名指す 6 本のテスト名と ID を持つ(cookie で認証する口がある製品)', () => {
    const content = browserDefenseTestsGenerator.generate(specModel([]), context({ external: EXTERNAL }))[0]?.content ?? '';
    expect(content).toContain('const GUARDED_ROUTES: readonly GuardedRoute[] = [];');
    for (const key of ['staticHeaders', 'requestGate', 'cookieRoutes', 'dynamicRendering', 'trustedReach', 'routeGuard'] as const) {
      expect(content).toContain(`// @spec guarantee-catalog @tc ${BROWSER_DEFENSE_TCS[key]}`);
      expect(content).toContain(`it('${BROWSER_DEFENSE_WORDING[key]}'`);
    }
    expect(content).toContain("endpoint: '/api/ai/a', method: 'POST'");
  });

  // 生成器は見るものの無い試験を出さない(fix27 A2): 見る口が 0 本の it は何も見ずに通るので、出さない。ほかの 5 本には落ちうる assertion がある。
  it.each([
    ['外部連携もサインインの口も無い', context()],
    ['cookie で認証しない連携(読み取りの定時の連携)だけ', context({ external: externalModel([integration('chat', { service: 'anthropic', effect: 'read' })]) })],
  ] as const)('負例: cookie で認証する口が 1 本も無い製品(%s)では、その口を見る it だけを出さない', (_name, ctx) => {
    const content = browserDefenseTestsGenerator.generate(specModel([]), ctx)[0]?.content ?? '';
    expect(content).toContain('const ROUTES: readonly ObservedRoute[] = [];');
    expect(content).not.toContain(BROWSER_DEFENSE_TCS.cookieRoutes);
    expect(content).not.toContain(`it('${BROWSER_DEFENSE_WORDING.cookieRoutes}'`);
    for (const key of ['staticHeaders', 'requestGate', 'dynamicRendering', 'trustedReach', 'routeGuard'] as const) {
      expect(content).toContain(`// @spec guarantee-catalog @tc ${BROWSER_DEFENSE_TCS[key]}`);
    }
  });

  it('実装の木を持たない製品では何も出さない', () => {
    expect(browserDefenseTestsGenerator.generate(specModel([]), context({ roots: { ...TEST_ROOTS, app: null } }))).toEqual([]);
  });
});
