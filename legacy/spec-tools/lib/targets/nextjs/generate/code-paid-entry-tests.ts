/**
 * アプリの枠の後段 Next.js の**有料の口の関門の見張りテスト**(ユニットテスト)の生成器。
 *
 * ## なぜ生成するのか
 *
 * 有料の口(外部連携の `spend: paid` の `endpoints`)の Route Handler は製品が手で書く。形は X8 が構文木の許可表で見るが、
 * 形の検査は「書いた形」しか見ない —— 認可の部品の中身・形の表の外の書き方で開いた口は、型も lint も通り、形の検査の目をすり抜けうる
 * (点検 5 回目 B5-2: 役を捨てる認可 + meter を参照するだけの消費で、未ログインの要求が有料の処理まで届いた)。
 * そこで**実際の route のモジュールを実物のまま叩き**、口ごとに次を見る見張りを宣言から生成する(口を足せば見張りも増える):
 *
 *   1. 見張る口は定数表 `PAID_ENTRIES` の鍵と同じ集合(閉世界。表に足した口を見張りが落とさない)
 *   2. **未ログイン**の要求は、`401 {"error":"unauthorized"}` で閉じ、本文を読まず、枠の RPC・書き込み・有料の宛先に触れない。
 *      要求は 1 種類でなく**ヘッダ × クエリ × 本文の組**(`UNAUTHENTICATED_VARIANTS`)で送る —— 入口の前の文が見張りの送らない要求で
 *      分岐して有料の処理へ行く形(点検 6 回目 B6-1 の `x-preview-key`)を、どの組でも閉じることで観測する。形は X8 が本体の文の並びの
 *      許可表で別に閉じる(こちらは実物の挙動の側の守り)。組は送るヘッダの**見本**にすぎない(表に無いヘッダで分岐されれば観測できない。
 *      点検 7 回目 B7-1)ので、さらに**要求の見出しの読み取りを見張る**: 閉じるまでに読んでよい見出しは関門(出どころの確認)が読む
 *      `GATE_HEADERS` の許可表だけで、それ以外の名前を `get` / `has` で読む・見出しを列挙する(`entries` / `forEach` / 反復)と赤。
 *      送るヘッダの拒否リストでなく「未ログインなら、要求の中身を見る前に閉じる」ことを、どの名前のヘッダでも成り立つ形で見る
 *   3. **役を持たない人**(ログインしているが、役の条件の行が 0 本)の要求は、`403 {"error":"forbidden"}` で同じく閉じる
 *
 * 観測は `@kaninabe/runtime/testing/http/paid-gate` が持つ(グローバルの `fetch` を偽の後段に差し替え、Next.js の要求の文脈を作って口を呼ぶ)。
 * **モジュールの差し替え(`vi.mock` の類)はしない**(この仕組みが禁じている)。手書きの route を別の実装に差し替えても、閉じ方が変われば赤になる。
 * 要求は同じオリジンのページからのもの(出どころの確認を通る)で、本文つき(関門が本文を読まないことも見る)。
 *
 * 前提: ユニットテストの setupFiles が `@kaninabe/runtime/testing/http/next-async-context` を読む(Next.js の要求の文脈に要る)。規約どおりファイル I/O はしない純粋関数である。
 */

import { SESSION_COOKIE_NAME } from '@kaninabe/adapter-supabase-session/cookie-policy';
import type { SpecModel } from '../../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../../gen-kit/generator.js';
import { generatedHeader, tsString } from '../../../gen-kit/code-emit.js';
import { bodyModulesOf } from '../../../generate/body-modules.js';
import { placedModule, placedPath } from '../../../generate/layout-placement.js';
import { paidEntryUrls } from '../../../generate/render/code-paid-entries.js';
import { RUNTIME_PAID_GATE_MODULE } from '../../../generate/render/runtime-modules.js';
import { testPlacerOf } from '../../../generate/render/test-placement.js';
import type { SourceLocation } from '../../../kernel/source-location.js';
import { exportedHttpMethods } from '../../../semantics/route-exports.js';
import type { HttpMethod } from '../../../semantics/route-exports.js';

/**
 * 閉じる要求で関門が読んでよい見出しの名前(許可表。点検 7 回目 B7-1)。未ログイン・役なしの要求は、これ以外の見出しを読む前に閉じる。
 *
 * | 名前 | 読む部品(実行時パッケージ) |
 * |---|---|
 * | `sec-fetch-site` / `origin` / `x-forwarded-host` / `host` / `x-forwarded-proto` | 出どころの確認 `isSameOriginRequest`(`http/request-origin.ts`) |
 * | `x-vercel-id` / `x-request-id` | 拒否の行の要求の識別子 `REQUEST_ID_HEADERS`(`operation/security-log.ts`) |
 */
export const GATE_HEADERS: readonly string[] = ['sec-fetch-site', 'origin', 'x-forwarded-host', 'host', 'x-forwarded-proto', 'x-vercel-id', 'x-request-id'];

/**
 * 閉じる要求で関門が読んでよい、見出しのほかの要求の欄(許可表。点検 8 回目 B8-5)。
 *
 * | 欄 | 読む部品 |
 * |---|---|
 * | `url` | 出どころの確認 `isSameOriginRequest` が、`X-Forwarded-Proto` の無いときの自分のスキームに読む(`http/request-origin.ts`) |
 *
 * `url` を読めることはクエリを読めることでもある —— クエリでの分岐は `QUERIES` の組(見本)で観測する残りであり、ここでは拒めない。
 * 本文(`BODY_READS`)は許可表に無く、閉じるまでに読めば赤(`clone()` の写しの本文・見出しも同じ包みで記録する)。
 */
export const GATE_REQUEST_FIELDS: readonly string[] = ['url'];

/** 本文を読む `Request` の口(閉じるまでに読めば漏れ)。 */
export const BODY_READS: readonly string[] = ['body', 'text', 'json', 'arrayBuffer', 'blob', 'formData', 'bytes'];

/** この生成器の ID(置き場の配置の `paid-entry-test` の持ち主と同じ)。 */
export const PAID_ENTRY_TESTS_GENERATOR_ID = 'code-paid-entry-tests';

/** 生成した定数表のモジュール名(`code-paid-entries` の出力)。 */
const PAID_ENTRIES_MODULE_NAME = 'paid-entries';

/** 前提の失敗が指す位置(値の正)。 */
const PROFILE_LOCATION: SourceLocation = { file: 'legacy/spec-tools/lib/targets/nextjs/generate/code-paid-entry-tests.ts' };

/** 外部連携カタログ(`external-catalog`)の `test_cases` が名指すテストケース ID(テスト名は文言表が持つ)。 */
export const PAID_ENTRY_TCS = {
  closedWorld: 'TC-EXTERNAL-PAID-001',
  unauthenticated: 'TC-EXTERNAL-PAID-002',
  forbidden: 'TC-EXTERNAL-PAID-003',
} as const;

/** テストの文言(`it` の名前。見張りの意味を 1 か所に持つ)。 */
export const PAID_ENTRY_TESTS_WORDING = {
  suite: '有料の口の関門(生成)',
  closedWorld: '見張る口は定数表 PAID_ENTRIES の鍵と同じ集合である(表に足した口を見張りが落とさない)',
  unauthenticated: '未ログインの要求は、どの有料の口も 401 で閉じ、本文を読まず、枠の RPC・書き込み・有料の宛先に触れない',
  forbidden: '役を持たない人(ログインしているが役の条件の行が 0 本)の要求は、どの有料の口も 403 で閉じ、本文を読まず、枠の RPC・書き込み・有料の宛先に触れない',
} as const;

/** 見張る口 1 本の 1 メソッド。 */
interface PaidRoute {
  readonly endpoint: string;
  readonly module: string;
  readonly method: HttpMethod;
}

/** 口の置き場の主張(配置の `http-entry`)。 */
function entryOf(url: string): { role: 'http-entry'; key: string; what: string; location: SourceLocation } {
  return { role: 'http-entry', key: url, what: `有料の口 ${url}`, location: PROFILE_LOCATION };
}

/** 有料の口(定数表の鍵の並び)と、export しているメソッド全部(本文が読めない口は `POST` とみなす。規約: ブラウザからの口は POST)。 */
export function paidRoutes(ctx: GenerateContext): readonly PaidRoute[] {
  const catalog = ctx.external?.catalog ?? null;
  if (catalog === null) return [];
  return paidEntryUrls(catalog).flatMap((endpoint) => {
    const route = placedPath(ctx.layout, ctx.roots, entryOf(endpoint));
    const source = ctx.routeSources?.get(route);
    const exported = source === undefined ? [] : exportedHttpMethods(route, source);
    const methods: readonly HttpMethod[] = exported.length === 0 ? ['POST'] : exported;
    return methods.map((method) => ({ endpoint, module: placedModule(ctx.layout, entryOf(endpoint)), method }));
  });
}

/** ファイル全体。 */
function renderFile(ctx: GenerateContext, routes: readonly PaidRoute[]): string {
  const modules = bodyModulesOf(ctx, { what: '有料の口の関門の見張りテスト', location: PROFILE_LOCATION });
  const rows = routes.map(
    (route) => `  { endpoint: ${tsString(route.endpoint)}, method: ${tsString(route.method)}, load: async () => (await import(${tsString(route.module)})).${route.method} },`,
  );
  return [
    generatedHeader([PROFILE_LOCATION.file, ...(ctx.external?.catalog === undefined || ctx.external.catalog === null ? [] : [ctx.external.catalog.location.file])]),
    '',
    "import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';",
    `import { FAKE_BACKEND_ENV, FORBIDDEN_REFUSAL, UNAUTHENTICATED_REFUSAL, gateLeaks, installFakeBackend, observeGate, sessionCookieHeader } from ${tsString(RUNTIME_PAID_GATE_MODULE)};`,
    `import type { FakeBackend, GateRefusal } from ${tsString(RUNTIME_PAID_GATE_MODULE)};`,
    `import { PAID_ENTRIES } from ${tsString(modules.generated(PAID_ENTRIES_MODULE_NAME))};`,
    '',
    '/** セッションの cookie の名前(セッションの adapter の約束 `SESSION_COOKIE_NAME` の写し)。 */',
    `const SESSION_COOKIE = ${tsString(SESSION_COOKIE_NAME)};`,
    '',
    '/** 見張る口 1 本の 1 メソッド。`load` は口のモジュールを読み、そのメソッドを返す。 */',
    'interface PaidRoute {',
    '  readonly endpoint: string;',
    '  readonly method: string;',
    '  readonly load: () => Promise<(request: Request) => unknown>;',
    '}',
    '',
    `/** 有料の口の、export しているメソッド全部(${String(rows.length)} 本)。 */`,
    rows.length === 0 ? 'const ROUTES: readonly PaidRoute[] = [];' : 'const ROUTES: readonly PaidRoute[] = [',
    ...(rows.length === 0 ? [] : [...rows, '];']),
    '',
    '/** 要求の組 1 つ(足すヘッダ・クエリ・本文)。 */',
    'interface RequestVariant {',
    '  readonly headers: Readonly<Record<string, string>>;',
    '  readonly query: string;',
    '  readonly body: string;',
    '}',
    '',
    '/** 既定の組(見張りの基本の要求)。 */',
    "const PLAIN: RequestVariant = { headers: {}, query: '', body: '{}' };",
    '',
    '/** 未ログインで送る、ヘッダ・クエリ・本文の組の母集合(入口の前の文が見張りの送らない要求で分岐する形を、どの組でも閉じることで見る)。 */',
    'const HEADER_SETS: readonly Readonly<Record<string, string>>[] = [',
    '  {},',
    "  { 'x-preview-key': 'preview' },",
    "  { 'x-debug': 'true', 'x-internal': '1', 'x-bypass': '1' },",
    "  { authorization: 'Bearer test', 'x-api-key': 'test' },",
    "  { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1', 'x-forwarded-host': 'app.example' },",
    '];',
    "const QUERIES: readonly string[] = ['', '?preview=1', '?debug=true&key=test&mode=internal'];",
    'const BODIES: readonly string[] = [\'{}\', \'{"preview":true,"key":"test","items":[]}\', \'not-json\'];',
    'const UNAUTHENTICATED_VARIANTS: readonly RequestVariant[] = HEADER_SETS.flatMap((headers) =>',
    '  QUERIES.flatMap((query) => BODIES.map((body) => ({ headers, query, body }))),',
    ');',
    '',
    '/** 同じオリジンのページからの要求(出どころの確認を通る)。本文つき —— 関門が本文を読まないことも見る。 */',
    'function requestTo(route: PaidRoute, variant: RequestVariant): Request {',
    '  return new Request(`https://app.example${route.endpoint}${variant.query}`, {',
    '    method: route.method,',
    "    headers: { ...variant.headers, host: 'app.example', origin: 'https://app.example', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'content-type': 'application/json' },",
    "    body: route.method === 'GET' || route.method === 'HEAD' ? null : variant.body,",
    '  });',
    '}',
    '',
    '/** 閉じるまでに関門が読んでよい見出しの名前(出どころの確認が読むもの。許可表。点検 7 回目 B7-1)。 */',
    `const GATE_HEADERS: ReadonlySet<string> = new Set([${GATE_HEADERS.map((name) => tsString(name)).join(', ')}]);`,
    '',
    '/** 見出しを列挙する口(どの名前を読んだか分からないので、使えば全部を読んだとみなす)。 */',
    "const LISTING: ReadonlySet<PropertyKey> = new Set(['entries', 'forEach', 'keys', 'values', 'getSetCookie', Symbol.iterator]);",
    '',
    '/** 本文を読む口(閉じるまでに 1 つでも使えば漏れ。`clone()` の写しの本文も同じ。点検 8 回目 B8-5)。 */',
    `const BODY_READS: ReadonlySet<PropertyKey> = new Set([${BODY_READS.map((name) => tsString(name)).join(', ')}]);`,
    '',
    '/** 閉じるまでに関門が読んでよい要求の欄(見出しのほか。許可表)。 */',
    `const GATE_REQUEST_FIELDS: ReadonlySet<string> = new Set([${GATE_REQUEST_FIELDS.map((name) => tsString('request:' + name)).join(', ')}]);`,
    '',
    '/**',
    ' * 要求の読み取りを記録する包み(見出しの `get` / `has` は名前を、列挙は `*` を、`url` は `request:url` を、本文の口は `request:body:{口}` を',
    ' * `read` に足す)。`clone()` の写しも同じ包みで返す(写しの見出し・本文の読み取りも記録する)。中身と本文は元の要求のまま。',
    ' * 送るヘッダの組は見本にすぎないので、関門の許可表の外の読み取りそのものを漏れとして見る(どの名前のヘッダで分岐しても赤)。',
    ' */',
    'function watchHeaders(request: Request, read: Set<string>): Request {',
    '  const headers = new Proxy(request.headers, {',
    '    get(target, property) {',
    '      const value: unknown = Reflect.get(target, property, target);',
    "      if (property === 'get' || property === 'has') return (name: string) => (read.add(name.toLowerCase()), target[property](name));",
    "      if (LISTING.has(property)) read.add('*');",
    "      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;",
    '    },',
    '  });',
    '  return new Proxy(request, {',
    '    get(target, property) {',
    "      if (property === 'headers') return headers;",
    "      if (property === 'url') read.add('request:url');",
    "      if (BODY_READS.has(property)) read.add(`request:body:${String(property)}`);",
    "      if (property === 'clone') return () => watchHeaders(target.clone(), read);",
    '      const value: unknown = Reflect.get(target, property, target);',
    "      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;",
    '    },',
    '  });',
    '}',
    '',
    '/** 全部の口を、同じ cookie と各組で叩き、期待の閉じ方から外れたもの(関門の外の見出しの読み取りを含む)を並べる(空 = 全部閉じた)。 */',
    'async function leaksOf(backend: FakeBackend, cookie: string, expected: GateRefusal, variants: readonly RequestVariant[] = [PLAIN]): Promise<readonly string[]> {',
    '  const found: string[] = [];',
    '  for (const route of ROUTES) {',
    '    for (const variant of variants) {',
    '      const read = new Set<string>();',
    '      const observed = gateLeaks(await observeGate(await route.load(), watchHeaders(requestTo(route, variant), read), backend, cookie), expected);',
    "      const reasons = [...observed, ...[...read].filter((name) => !GATE_HEADERS.has(name) && !GATE_REQUEST_FIELDS.has(name)).map((name) => (name.startsWith('request:') ? `request-read:${name.slice(8)}` : `header-read:${name}`))];",
    "      if (reasons.length > 0) found.push(`${route.method} ${route.endpoint}${variant.query} ${JSON.stringify(variant.headers)} ${variant.body}: ${reasons.join(', ')}`);",
    '    }',
    '  }',
    '  return found;',
    '}',
    '',
    'let backend: FakeBackend;',
    '',
    'beforeEach(() => {',
    '  for (const [name, value] of Object.entries(FAKE_BACKEND_ENV)) vi.stubEnv(name, value);',
    '  backend = installFakeBackend();',
    '});',
    '',
    'afterEach(() => {',
    '  backend.dispose();',
    '  vi.unstubAllEnvs();',
    '});',
    '',
    `describe(${tsString(PAID_ENTRY_TESTS_WORDING.suite)}, () => {`,
    `  // @spec external-catalog @tc ${PAID_ENTRY_TCS.closedWorld}`,
    `  it(${tsString(PAID_ENTRY_TESTS_WORDING.closedWorld)}, () => {`,
    '    expect([...new Set(ROUTES.map((route) => route.endpoint))].sort()).toEqual(Object.keys(PAID_ENTRIES).sort());',
    '  });',
    '',
    `  // @spec external-catalog @tc ${PAID_ENTRY_TCS.unauthenticated}`,
    `  it(${tsString(PAID_ENTRY_TESTS_WORDING.unauthenticated)}, async () => {`,
    "    expect(UNAUTHENTICATED_VARIANTS).toHaveLength(HEADER_SETS.length * QUERIES.length * BODIES.length);",
    "    expect(await leaksOf(backend, '', UNAUTHENTICATED_REFUSAL, UNAUTHENTICATED_VARIANTS)).toEqual([]);",
    '  });',
    '',
    `  // @spec external-catalog @tc ${PAID_ENTRY_TCS.forbidden}`,
    `  it(${tsString(PAID_ENTRY_TESTS_WORDING.forbidden)}, async () => {`,
    '    expect(await leaksOf(backend, sessionCookieHeader(SESSION_COOKIE), FORBIDDEN_REFUSAL)).toEqual([]);',
    '  });',
    '});',
    '',
  ].join('\n');
}

/**
 * 有料の口の関門の見張りテストを生成するジェネレーター。出力は 1 ファイル(全置換)で、置き場は配置の `paid-entry-test`
 * (Next.js なら `{実装の木}/src/app/api/__tests__/generated/paid-entries.test.ts`)。実装の木を持たない製品・有料の口が無い製品では何も出さない。
 */
export const paidEntryTestsGenerator: DocGenerator = {
  id: PAID_ENTRY_TESTS_GENERATOR_ID,

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const place = testPlacerOf(ctx.layout, ctx.roots, 'paid-entry-test', { what: '有料の口の関門の見張りテスト', location: PROFILE_LOCATION });
    if (place === null) return [];
    const routes = paidRoutes(ctx);
    if (routes.length === 0) return [];
    const file = place('');
    return [{ file, content: renderFile(ctx, routes), wholeFile: true }];
  },
};
