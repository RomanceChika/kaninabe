/**
 * アプリの枠の後段 Next.js の**ブラウザ側の守りの配線の見張りテスト**(ユニットテスト)の生成器。
 *
 * ## なぜ生成するのか
 *
 * 守りの値と組み方は仕組みが持つ(宣言 = 後段の値・組み方 = 実行時パッケージ・リクエスト前段 = 生成物)が、**配線の一部は製品が手で書く** ——
 * 枠の設定(`next.config` の `headers()`)・根のレイアウト(要求ごとの描画)・cookie で認証する手書きの Route Handler。ここを外しても型は通り、
 * 外した製品だけが黙って開く。そこで配線そのものを実物で叩く見張りを、宣言から生成する(口を足せば見張りも自動で増える)。
 *
 * ## 形(保証台帳 `security_headers_set` の `test_cases` が名指す 5 本の `it()`)
 *
 *   1. 枠の設定の `headers()` が全ルートに固定のヘッダを全部そのまま配る(CSP と CORS を固定で配らない・X-Powered-By を出さない)
 *   2. リクエスト前段の保護範囲が宣言どおりで、出どころを確かめられない状態を変える要求を、**セッションの更新に触れずに** 403 で閉じる
 *   3. cookie で認証する口(送信の連携の `endpoints` と、認証の開始・ログアウトの口)の状態を変えるメソッドが全部、他のサイトからの要求・出どころの
 *      無い要求を、**外への呼び出しも認証の文脈も本文も使わずに、関門と同じ応答の** 403 で閉じる
 *   4. 根のレイアウトが要求ごとの描画を宣言している(`await connection()`。字面を見る —— 描画の文脈の外では呼べない)
 *   5. (対照)同じオリジンのページからの要求(フォームの送信・fetch・Server Action・前段の後ろの要求)は、口と前段の本体へ進む ——
 *      3 の観測が空振り(観測の口が効いていない・何でも閉じる)でないことの証拠
 *
 *   6. (保証台帳 `url_scheme_safe`。点検 10 回目 B10-1)**宣言した全部の口**(ジョブ・受信・認証・送信の連携)の export した全メソッドが、出口の関所
 *      `guardRoute` で包まれている(`isGuardedRoute`)。対照として、同じ関所が口の返した `Location: https://evil.example` と `text/html` の応答を本文の無い 500 に替えることを
 *      実物で叩く。字面の側(`export const GET = guardRoute(…)` の形)は J2 が構文木で見る
 *
 * 2・3・5 は、グローバルの `fetch` を「記録して拒む」ものに差し替えてから口を読み込み直し(`@kaninabe/runtime/testing/http/route-isolation`)、
 * 閉じる要求で ①外へ呼ばない(認証基盤・DB・外部の API はどれも `fetch` を通る)②例外を出さない(認証の `cookies()` は要求の文脈の外では投げる)
 * ③本文を読まない ④関門と同じ応答(`crossOriginRefusal`)で閉じる、を見る。**モジュールの差し替え(`vi.mock` の類)はしない**(この仕組みが禁じている)。
 * ④があるので、関門を飛ばして奥の守り(セッションの adapter の二重の確認)が別の形の 403 で閉じた口も赤になる。
 * 字面の側(最初の文で関門を呼び、その結果を返す形)は J2 が構文木で見る。
 *
 * 描画を伴う確かめ(文書の応答に nonce の CSP が付き、Next.js のスクリプトに同じ nonce が付く)は、実行時パッケージの単体テストと、
 * `next build` / `next start` の実測(配線の束の報告)が受け持つ。規約どおりファイル I/O はしない純粋関数である。
 *
 * @oversize 6 本の `it()` が、同じ口の表(宣言の突き合わせ・置き場の主張・`routeSources` から数えたメソッド)と、同じ前置き(観測の口・要求の組み立て)を
 *   共有する 1 枚の見張りテストの生成器である。出口の関所の 1 本(6)も「宣言した口を実物で読み込む」点で cookie の口の 3 本と同じ材料を読む。
 * @split-review 出口の関所の 1 本を別の生成器(別の置き場の役割)に割る案は、口の表を集める部分(宣言の突き合わせ・置き場・重複の除去)を 2 か所で持つことになり、
 *   宣言の種類を足した日に片方だけが新しい口を載せる形が残る。置き場の役割を増やす(配置の役割の表・役割の数の数え直し・ハンドブックの配置の章)費用もある。
 *   文言は `messages-browser-defense.ts` に、TC は `BROWSER_DEFENSE_TCS` に 1 か所ずつ置いてあるので、ここには組み立てだけが残る。採らない。
 */

import { posix } from 'node:path';
import type { SpecModel } from '../../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../../gen-kit/generator.js';
import { generatedHeader, tsString } from '../../../gen-kit/code-emit.js';
import { bodyModulesOf } from '../../../generate/body-modules.js';
import { placedModule, placedPath } from '../../../generate/layout-placement.js';
import { testPlacerOf } from '../../../generate/render/test-placement.js';
import { entryDeclarationsOf, isCookieAuthenticatedOrigin, isMalformedEndpoint } from '../../../job/entry-declarations.js';
import type { EntryDeclaration } from '../../../job/entry-declarations.js';
import { BROWSER_DEFENSE_WORDING } from '../../../messages/messages-browser-defense.js';
import { exportedHttpMethods } from '../../../semantics/route-exports.js';
import { RUNTIME_REQUEST_ORIGIN_MODULE, RUNTIME_ROUTE_GUARD_MODULE, RUNTIME_ROUTE_ISOLATION_MODULE } from '../../../generate/render/runtime-modules.js';
import type { HttpMethod } from '../../../semantics/route-exports.js';
import type { SourceLocation } from '../../../kernel/source-location.js';
import { NEXTJS_BROWSER_DEFENSE } from '../browser-defense.js';
import { BROWSER_DEFENSE_CONST, BROWSER_DEFENSE_MODULE_NAME, requestGateMatcher } from './code-browser-defense.js';

/** この生成器の ID(置き場の配置の `browser-defense-test` の持ち主と同じ)。 */
export const BROWSER_DEFENSE_TESTS_GENERATOR_ID = 'code-browser-defense-tests';

/** 保証台帳(`security_headers_set`)の見張りテストが指すテストケース ID(テスト名は文言表が持つ)。 */
export const BROWSER_DEFENSE_TCS = {
  staticHeaders: 'TC-GUAR-HEADERS-001',
  requestGate: 'TC-GUAR-HEADERS-002',
  cookieRoutes: 'TC-GUAR-HEADERS-003',
  dynamicRendering: 'TC-GUAR-HEADERS-004',
  trustedReach: 'TC-GUAR-HEADERS-006',
  routeGuard: 'TC-GUAR-LINK-006',
} as const;

/** 前提の失敗が指す位置(値の正)。 */
const PROFILE_LOCATION: SourceLocation = { file: 'legacy/spec-tools/lib/targets/nextjs/browser-defense.ts' };

/** 状態を変えないメソッド(出どころを確かめない)。 */
const SAFE: ReadonlySet<HttpMethod> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 見張る口 1 本(cookie で認証する口)。 */
interface CookieRoute {
  readonly decl: EntryDeclaration;
  /** 口のモジュール指定。 */
  readonly module: string;
  readonly methods: readonly HttpMethod[];
}

/** cookie で認証する口(宣言の並び)と、状態を変える export のメソッド。本文が読めない手書きの口は `POST` とみなす(規約: ブラウザからの口は POST)。 */
function cookieRoutes(ctx: GenerateContext): readonly CookieRoute[] {
  const external = ctx.external?.catalog ?? undefined;
  const declarations = entryDeclarationsOf(ctx.jobs ?? { available: false, catalog: null }, external, ctx.auth);
  return declarations
    .filter((decl) => isCookieAuthenticatedOrigin(decl.origin) && !isMalformedEndpoint(decl.url))
    .map((decl) => {
      const route = placedPath(ctx.layout, ctx.roots, entryOf(decl));
      const source = ctx.routeSources?.get(route);
      const exported = source === undefined ? [] : exportedHttpMethods(route, source);
      const methods = (exported.length === 0 ? (['POST'] as const) : exported).filter((method) => !SAFE.has(method));
      return { decl, module: placedModule(ctx.layout, entryOf(decl)), methods };
    });
}

/** 出口の関所を見張る口の 1 メソッド(宣言した全部の口。本文が読めない・メソッドを export していない口は J2 が言うので載せない)。 */
interface GuardedRouteRow {
  readonly decl: EntryDeclaration;
  readonly module: string;
  readonly method: HttpMethod;
}

/** 宣言した全部の口(ジョブ・受信・認証・送信の連携)の、export したメソッド全部。 */
function guardedRoutes(ctx: GenerateContext): readonly GuardedRouteRow[] {
  const external = ctx.external?.catalog ?? undefined;
  const declarations = entryDeclarationsOf(ctx.jobs ?? { available: false, catalog: null }, external, ctx.auth);
  const seen = new Set<string>();
  return declarations
    .filter((decl) => !isMalformedEndpoint(decl.url))
    .flatMap((decl) => {
      const route = placedPath(ctx.layout, ctx.roots, entryOf(decl));
      const source = ctx.routeSources?.get(route);
      if (source === undefined || seen.has(route)) return [];
      seen.add(route);
      return exportedHttpMethods(route, source).map((method) => ({ decl, module: placedModule(ctx.layout, entryOf(decl)), method }));
    });
}

/** 口の置き場の主張(配置の `http-entry`)。 */
function entryOf(decl: EntryDeclaration): { role: 'http-entry'; key: string; what: string; location: SourceLocation } {
  return { role: 'http-entry', key: decl.url, what: decl.source, location: decl.location };
}

/** テストファイルから、置き場(リポジトリルート相対)への相対パス。 */
function relativeFrom(testFile: string, target: string): string {
  return posix.relative(posix.dirname(testFile), target);
}

/** cookie で認証する口の表の行(状態を変えるメソッド 1 つにつき 1 行。空なら cookie の口を見る it を出さない)。 */
function cookieRouteRows(ctx: GenerateContext): readonly string[] {
  return cookieRoutes(ctx).flatMap((route) =>
    route.methods.map(
      (method) =>
        `  { source: ${tsString(route.decl.source)}, endpoint: ${tsString(route.decl.url)}, method: ${tsString(method)}, load: async () => (await import(${tsString(route.module)})).${method} },`,
    ),
  );
}

/** cookie で認証する口を見る it(表が空なら出さない。見る口が 0 本の it は何も見ずに通る — 生成器は見るものの無い試験を出さない)。 */
function cookieRoutesIt(): readonly string[] {
  return [
    `  // @spec guarantee-catalog @tc ${BROWSER_DEFENSE_TCS.cookieRoutes}`,
    `  it(${tsString(BROWSER_DEFENSE_WORDING.cookieRoutes)}, async () => {`,
    `    const refusal = await refusalShapeOf(crossOriginRefusal(${BROWSER_DEFENSE_CONST}));`,
    '    const leaks: string[] = [];',
    '    for (const route of ROUTES) {',
    '      leaks.push(',
    '        ...(await observeAll(route, UNTRUSTED, async (probe, handler, headers) => {',
    '          const reasons = refusalLeaks(await observeHandler(handler, requestTo(route, headers), probe, refusal), refusal);',
    "          return reasons.length === 0 ? null : reasons.join(', ');",
    '        })),',
    '      );',
    '    }',
    '    expect(leaks).toEqual([]);',
    '  });',
    '',
  ];
}

/** 生成するテストの前半(import・定数・口の表・要求の組み立て)。 */
function renderPrelude(ctx: GenerateContext, testFile: string): readonly string[] {
  const modules = bodyModulesOf(ctx, { what: 'ブラウザ側の守りの見張りテスト', location: PROFILE_LOCATION });
  const gatePath = placedPath(ctx.layout, ctx.roots, { role: 'request-gate', what: 'リクエスト前段', location: PROFILE_LOCATION, verifier: 'S7' });
  const appConfig = placedPath(ctx.layout, ctx.roots, { role: 'app-config', what: '枠の設定', location: PROFILE_LOCATION });
  const rootLayout = placedPath(ctx.layout, ctx.roots, { role: 'root-layout', what: '根のレイアウト', location: PROFILE_LOCATION });
  const gateModule = modules.sourceFile(gatePath);
  const guardedRows = guardedRoutes(ctx).map(
    (row) => `  { source: ${tsString(row.decl.source)}, method: ${tsString(row.method)}, load: async () => (await import(${tsString(row.module)})).${row.method} },`,
  );
  const rows = cookieRouteRows(ctx);
  return [
    generatedHeader([PROFILE_LOCATION.file]),
    '',
    "import { readFileSync } from 'node:fs';",
    "import path from 'node:path';",
    "import { NextRequest } from 'next/server';",
    "import { describe, expect, it, vi } from 'vitest';",
    `import { crossOriginRefusal } from ${tsString(RUNTIME_REQUEST_ORIGIN_MODULE)};`,
    `import { installNetworkProbe, observeHandler, passedGuard, refusalLeaks, refusalShapeOf } from ${tsString(RUNTIME_ROUTE_ISOLATION_MODULE)};`,
    `import type { NetworkProbe } from ${tsString(RUNTIME_ROUTE_ISOLATION_MODULE)};`,
    `import { ROUTE_GUARD_REFUSAL_STATUS, guardRoute, isGuardedRoute } from ${tsString(RUNTIME_ROUTE_GUARD_MODULE)};`,
    `import { ${BROWSER_DEFENSE_CONST} } from ${tsString(modules.generated(BROWSER_DEFENSE_MODULE_NAME))};`,
    `import * as requestGate from ${tsString(gateModule)};`,
    '',
    `/** 枠の設定(製品が手で書く。どの層でもないので静的に import しない)。 */`,
    `const APP_CONFIG = path.resolve(__dirname, ${tsString(relativeFrom(testFile, appConfig))});`,
    '',
    `/** 根のレイアウト(字面を読む)。 */`,
    `const ROOT_LAYOUT = path.resolve(__dirname, ${tsString(relativeFrom(testFile, rootLayout))});`,
    '',
    '/** リクエスト前段の保護範囲(宣言から)。 */',
    `const MATCHER = ${tsString(requestGateMatcher(NEXTJS_BROWSER_DEFENSE))};`,
    '',
    '/** 見張る口 1 本の 1 メソッド。`load` は口を読み込み直してそのメソッドを返す(外への呼び出しを観測の口に差し替えたあとで読む)。 */',
    'interface ObservedRoute {',
    '  readonly source: string;',
    '  readonly endpoint: string;',
    '  readonly method: string;',
    '  readonly load: () => Promise<(request: Request) => unknown>;',
    '}',
    '',
    `/** cookie で認証する口の、状態を変えるメソッド全部(${String(rows.length)} 本)。 */`,
    rows.length === 0 ? 'const ROUTES: readonly ObservedRoute[] = [];' : 'const ROUTES: readonly ObservedRoute[] = [',
    ...(rows.length === 0 ? [] : [...rows, '];']),
    '',
    '/** 出口の関所を見張る口の 1 メソッド(宣言した全部の口)。 */',
    'interface GuardedRoute {',
    '  readonly source: string;',
    '  readonly method: string;',
    '  readonly load: () => Promise<unknown>;',
    '}',
    '',
    `/** 宣言した全部の口の export したメソッド(${String(guardedRows.length)} 本)。 */`,
    guardedRows.length === 0 ? 'const GUARDED_ROUTES: readonly GuardedRoute[] = [];' : 'const GUARDED_ROUTES: readonly GuardedRoute[] = [',
    ...(guardedRows.length === 0 ? [] : [...guardedRows, '];']),
    '',
    '/** リクエスト前段(生成物)。前段は要求のボディを読まないので、ボディなしで渡す。 */',
    'const REQUEST_GATE: ObservedRoute = {',
    `  source: ${tsString(BROWSER_DEFENSE_WORDING.requestGateSource)},`,
    "  endpoint: '/',",
    "  method: 'POST',",
    '  load: async () => {',
    `    const gate = await import(${tsString(gateModule)});`,
    '    return (request: Request) => gate.proxy(new NextRequest(request.url, { method: request.method, headers: request.headers }));',
    '  },',
    '};',
    '',
    '/** 出どころを確かめられない要求のヘッダ(他のサイトから・出どころの無い要求・同じサイトの別のオリジン・同じホストの http のページ)。 */',
    'const UNTRUSTED: readonly Record<string, string>[] = [',
    "  { host: 'app.example', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },",
    "  { host: 'app.example' },",
    "  { host: 'app.example', origin: 'https://sub.app.example', 'sec-fetch-site': 'same-site' },",
    "  { host: 'app.example', origin: 'http://app.example', 'sec-fetch-site': 'same-site' },",
    '];',
    '',
    '/** 同じオリジンのページからの要求のヘッダ(フォームの送信・fetch・Server Action・前段のプロキシの後ろ)。 */',
    'const TRUSTED: readonly Record<string, string>[] = [',
    "  { host: 'app.example', origin: 'https://app.example', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'content-type': 'application/x-www-form-urlencoded' },",
    "  { host: 'app.example', origin: 'https://app.example', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'content-type': 'application/json' },",
    "  { host: 'app.example', origin: 'https://app.example', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'next-action': 'a'.repeat(42), accept: 'text/x-component' },",
    "  { host: 'internal:3000', 'x-forwarded-host': 'app.example', 'x-forwarded-proto': 'https', origin: 'https://app.example', 'sec-fetch-site': 'same-origin' },",
    '];',
    '',
    '/** 口に送る要求(ボディつき。拒む要求でボディを読んでいないことも見る)。 */',
    'function requestTo(route: ObservedRoute, headers: Record<string, string>): Request {',
    "  return new Request(`https://app.example${route.endpoint}`, { method: route.method, headers, body: 'a=1' });",
    '}',
    '',
    '/**',
    ' * 外への呼び出しを観測の口に差し替えてから口を読み込み直し、全部のヘッダで観測する(観測の口は必ず戻す)。',
    ' * 読み込み直すのは、読み込みのときに `fetch` を掴むクライアントも観測に入れるため(モジュールの差し替えはしない)。',
    ' */',
    'async function observeAll(route: ObservedRoute, headerSets: readonly Record<string, string>[], judge: (probe: NetworkProbe, handler: (request: Request) => unknown, headers: Record<string, string>) => Promise<string | null>): Promise<readonly string[]> {',
    '  vi.resetModules();',
    '  const probe = installNetworkProbe();',
    '  try {',
    '    const handler = await route.load();',
    '    const found: string[] = [];',
    '    for (const headers of headerSets) {',
    '      const finding = await judge(probe, handler, headers);',
    '      if (finding !== null) found.push(`${route.source} ${route.method} ${JSON.stringify(headers)}: ${finding}`);',
    '    }',
    '    return found;',
    '  } finally {',
    '    probe.dispose();',
    '  }',
    '}',
  ];
}

/** ファイル全体。 */
function renderFile(ctx: GenerateContext, testFile: string): string {
  return [
    ...renderPrelude(ctx, testFile),
    '',
    `describe(${tsString(BROWSER_DEFENSE_WORDING.suite)}, () => {`,
    `  // @spec guarantee-catalog @tc ${BROWSER_DEFENSE_TCS.staticHeaders}`,
    `  it(${tsString(BROWSER_DEFENSE_WORDING.staticHeaders)}, async () => {`,
    '    const loaded = (await import(/* @vite-ignore */ APP_CONFIG)) as {',
    '      default: { headers?: () => Promise<readonly { source: string; headers: readonly { key: string; value: string }[] }[]>; poweredByHeader?: boolean };',
    '    };',
    '    const rules = (await loaded.default.headers?.()) ?? [];',
    "    const all = rules.filter((rule) => rule.source === '/:path*');",
    '    expect(all).toHaveLength(1);',
    '    const delivered = new Map((all[0]?.headers ?? []).map((header) => [header.key.toLowerCase(), header.value]));',
    `    for (const header of ${BROWSER_DEFENSE_CONST}.headers) expect(delivered.get(header.name.toLowerCase()), header.name).toBe(header.value);`,
    '    const fixed = rules.flatMap((rule) => rule.headers.map((header) => header.key.toLowerCase()));',
    "    expect(fixed.filter((key) => key === 'content-security-policy' || key.startsWith('access-control-'))).toEqual([]);",
    '    expect(loaded.default.poweredByHeader).toBe(false);',
    '  });',
    '',
    `  // @spec guarantee-catalog @tc ${BROWSER_DEFENSE_TCS.requestGate}`,
    `  it(${tsString(BROWSER_DEFENSE_WORDING.requestGate)}, async () => {`,
    '    expect(requestGate.config.matcher).toEqual([MATCHER]);',
    `    const refusal = await refusalShapeOf(crossOriginRefusal(${BROWSER_DEFENSE_CONST}));`,
    '    const leaks = await observeAll(REQUEST_GATE, UNTRUSTED, async (probe, handler, headers) => {',
    "      const observed = await observeHandler(handler, new Request('https://app.example/', { method: 'POST', headers }), probe, refusal);",
    "      const reasons = refusalLeaks(observed, refusal);",
    "      return reasons.length === 0 ? null : reasons.join(', ');",
    '    });',
    '    expect(leaks).toEqual([]);',
    "    const response = await requestGate.proxy(new NextRequest('https://app.example/', { method: 'POST', headers: { host: 'app.example' } }));",
    `    expect(response.headers.get(${BROWSER_DEFENSE_CONST}.noStore.name)).toBe(${BROWSER_DEFENSE_CONST}.noStore.value);`,
    '  });',
    '',
    ...(cookieRouteRows(ctx).length === 0 ? [] : cookieRoutesIt()),
    `  // @spec guarantee-catalog @tc ${BROWSER_DEFENSE_TCS.dynamicRendering}`,
    `  it(${tsString(BROWSER_DEFENSE_WORDING.dynamicRendering)}, () => {`,
    "    const source = readFileSync(ROOT_LAYOUT, 'utf8');",
    "    expect(source).toMatch(/import\\s*\\{[^}]*\\bconnection\\b[^}]*\\}\\s*from\\s*['\"]next\\/server['\"]/);",
    '    expect(source).toMatch(/^\\s*await\\s+connection\\(\\)\\s*;?\\s*$/m);',
    '  });',
    '',
    `  // @spec guarantee-catalog @tc ${BROWSER_DEFENSE_TCS.trustedReach}`,
    `  it(${tsString(BROWSER_DEFENSE_WORDING.trustedReach)}, async () => {`,
    `    const refusal = await refusalShapeOf(crossOriginRefusal(${BROWSER_DEFENSE_CONST}));`,
    '    const unreached: string[] = [];',
    '    for (const route of [...ROUTES, REQUEST_GATE]) {',
    '      unreached.push(',
    '        ...(await observeAll(route, TRUSTED, async (probe, handler, headers) => {',
    '          const observed = await observeHandler(handler, requestTo(route, headers), probe, refusal);',
    `          return passedGuard(observed, refusal) ? null : ${tsString(BROWSER_DEFENSE_WORDING.closedByGuard)};`,
    '        })),',
    '      );',
    '    }',
    '    expect(unreached).toEqual([]);',
    '  });',
    '',
    `  // @spec guarantee-catalog @tc ${BROWSER_DEFENSE_TCS.routeGuard}`,
    `  it(${tsString(BROWSER_DEFENSE_WORDING.routeGuard)}, async () => {`,
    '    const unguarded: string[] = [];',
    '    for (const route of GUARDED_ROUTES) if (!isGuardedRoute(await route.load())) unguarded.push(`${route.source} ${route.method}`);',
    '    expect(unguarded).toEqual([]);',
    "    const hostile = guardRoute(() => new Response(null, { status: 303, headers: { Location: 'https://evil.example/login' } }), { logger: { write: () => undefined } });",
    "    const blocked = await hostile(new Request('https://app.example/'));",
    '    expect(blocked.status).toBe(ROUTE_GUARD_REFUSAL_STATUS);',
    "    expect(blocked.headers.get('location')).toBeNull();",
    "    const page = guardRoute(() => new Response('<!doctype html><script>alert(1)</script>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }), { logger: { write: () => undefined } });",
    "    const refused = await page(new Request('https://app.example/'));",
    '    expect(refused.status).toBe(ROUTE_GUARD_REFUSAL_STATUS);',
    "    expect(refused.headers.get('content-type')).toBeNull();",
    "    expect(await refused.text()).toBe('');",
    '  });',
    '});',
    '',
  ].join('\n');
}

/**
 * ブラウザ側の守りの配線の見張りテストを生成するジェネレーター。出力は 1 ファイル(全置換)で、置き場は配置の `browser-defense-test`
 * (Next.js なら `{実装の木}/src/app/api/__tests__/generated/browser-defense.test.ts`)。実装の木を持たない製品では何も出さない。
 * cookie で認証する口が 1 本も無い製品では、その口を見る 3 本目の `it()` だけを出さない(見る口が 0 本の `it()` は何も見ずに通る。
 * 生成器は見るものの無い試験を出さない — scripts-code-quality.md §テスト)。
 */
export const browserDefenseTestsGenerator: DocGenerator = {
  id: BROWSER_DEFENSE_TESTS_GENERATOR_ID,

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const place = testPlacerOf(ctx.layout, ctx.roots, 'browser-defense-test', { what: 'ブラウザ側の守りの見張りテスト', location: PROFILE_LOCATION });
    if (place === null) return [];
    const file = place('');
    return [{ file, content: renderFile(ctx, file), wholeFile: true }];
  },
};
