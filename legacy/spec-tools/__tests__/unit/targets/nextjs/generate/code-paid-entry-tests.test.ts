/**
 * アプリの枠の後段 Next.js の有料の口の関門の見張りテストの生成器(`code-paid-entry-tests`。点検 5 回目 B5-2)のユニットテスト。
 *
 * 固定するのは —— ①定数表に載る有料の口の、export しているメソッド全部を実物の route のモジュールで読み込む行(本文が読めなければ POST)
 * ②未ログイン 401・役なし 403 の 2 本と閉世界の 1 本が、外部連携カタログの test_cases が名指す ID とテスト名を持つ
 * ③観測は実行時パッケージの道具(偽の後段・要求の文脈)で、モジュールの差し替え(vi.mock)をしない ④セッションの cookie の名前は adapter の約束の写し
 * ⑤有料の口が無い・実装の木が無い製品では何も出さない ⑥別の配置では書き先も import も配置に従う。
 */

import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '@kaninabe/adapter-supabase-session/cookie-policy';
import { specModel, stubGuards } from '../../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';
import { FOREIGN_BODY_COMPATIBLE_LAYOUT, FOREIGN_ROOTS, TEST_LAYOUT, TEST_PLATFORM } from '../../../../helpers/platform.js';
import { NO_GATES } from '../../../../helpers/generate-context.js';
import { externalModel, integration } from '../../../../helpers/external-builder.js';
import type { IntegrationOpts } from '../../../../helpers/external-builder.js';
import type { GenerateContext } from '../../../../../lib/gen-kit/generator.js';
import { BODY_READS, GATE_HEADERS, GATE_REQUEST_FIELDS, PAID_ENTRY_TCS, PAID_ENTRY_TESTS_WORDING, paidEntryTestsGenerator } from '../../../../../lib/targets/nextjs/generate/code-paid-entry-tests.js';
import { layoutModule, layoutPath } from '../../../../../lib/model/product/layout.js';
import type { LayoutRole, ProductLayout } from '../../../../../lib/model/product/layout.js';

/** 配置が決める置き場(テストに製品の木のパスを直書きしない)。 */
function placeOf(role: LayoutRole, key?: string, layout: ProductLayout = TEST_LAYOUT, app: string | null = TEST_ROOTS.app): string | null {
  return layoutPath(layout, app, role, key);
}

const LOC = { file: 'external.md' };

/** 健全な有料の口 2 本。 */
const PAID: IntegrationOpts = {
  service: 'anthropic',
  effect: 'read',
  endpoints: ['/api/ai/a', '/api/ai/b'],
  spend: 'paid',
  abuse: { maxBodyBytes: { '/api/ai/a': 100, '/api/ai/b': 200 }, quota: { source: 'AI_LIMIT', per: '1 day', key: 'actor' }, location: LOC },
  meter: 'consume_quota',
  authz: { kind: 'role', role: 'member', location: LOC },
};

/** 生成の文脈。 */
function context(extra: Partial<GenerateContext> = {}): GenerateContext {
  return { guards: stubGuards(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, external: externalModel([integration('chat', PAID)]), ...extra };
}

/** 1 ファイルの本文。 */
function render(extra: Partial<GenerateContext> = {}): string {
  const sections = paidEntryTestsGenerator.generate(specModel([]), context(extra));
  expect(sections).toHaveLength(1);
  return sections[0]?.content ?? '';
}

describe('code-paid-entry-tests', () => {
  it('置き場は配置の paid-entry-test で、全置換', () => {
    const [section] = paidEntryTestsGenerator.generate(specModel([]), context());
    expect(section?.file).toBe(placeOf('paid-entry-test'));
    expect(section?.wholeFile).toBe(true);
  });

  it('有料の口の export しているメソッド全部を実物の route のモジュールで読む(本文が読めない口は POST)', () => {
    const routeSources = new Map([[placeOf('http-entry', '/api/ai/a') ?? '', 'export async function POST() {}\nexport async function GET() {}']]);
    const content = render({ routeSources });
    const moduleA = layoutModule(TEST_LAYOUT, 'http-entry', '/api/ai/a');
    const moduleB = layoutModule(TEST_LAYOUT, 'http-entry', '/api/ai/b');
    expect(content).toContain(`{ endpoint: '/api/ai/a', method: 'POST', load: async () => (await import('${String(moduleA)}')).POST },`);
    expect(content).toContain(`{ endpoint: '/api/ai/a', method: 'GET', load: async () => (await import('${String(moduleA)}')).GET },`);
    expect(content).toContain(`{ endpoint: '/api/ai/b', method: 'POST', load: async () => (await import('${String(moduleB)}')).POST },`);
    expect(content).toContain('export しているメソッド全部(3 本)');
  });

  it('閉世界・未ログイン 401・役なし 403 の 3 本が、カタログの test_cases の ID とテスト名を持つ', () => {
    const content = render();
    for (const key of ['closedWorld', 'unauthenticated', 'forbidden'] as const) {
      expect(content).toContain(`  // @spec external-catalog @tc ${PAID_ENTRY_TCS[key]}\n  it('${PAID_ENTRY_TESTS_WORDING[key]}'`);
    }
    expect(content).toContain("expect(await leaksOf(backend, '', UNAUTHENTICATED_REFUSAL, UNAUTHENTICATED_VARIANTS)).toEqual([]);");
    expect(content).toContain('expect(await leaksOf(backend, sessionCookieHeader(SESSION_COOKIE), FORBIDDEN_REFUSAL)).toEqual([]);');
    expect(content).toContain('expect([...new Set(ROUTES.map((route) => route.endpoint))].sort()).toEqual(Object.keys(PAID_ENTRIES).sort());');
  });

  it('未ログインの見張りは、ヘッダ × クエリ × 本文の組を全部送る(入口の前の文が見張りの送らない要求で分岐する形を観測する。B6-1)', () => {
    const content = render();
    // 探り台本 probe1 の形(x-preview-key)と、クエリ・壊れた本文を含む。
    expect(content).toContain("  { 'x-preview-key': 'preview' },");
    expect(content).toContain("const QUERIES: readonly string[] = ['', '?preview=1', '?debug=true&key=test&mode=internal'];");
    expect(content).toContain(`const BODIES: readonly string[] = ['{}', '{"preview":true,"key":"test","items":[]}', 'not-json'];`);
    expect(content).toContain('  QUERIES.flatMap((query) => BODIES.map((body) => ({ headers, query, body }))),');
    expect(content).toContain('expect(UNAUTHENTICATED_VARIANTS).toHaveLength(HEADER_SETS.length * QUERIES.length * BODIES.length);');
    // 各組のヘッダは見張りの基本のヘッダ(同じオリジン)を上書きできない(出どころの確認を通る要求のまま)。
    expect(content).toContain("    headers: { ...variant.headers, host: 'app.example', origin: 'https://app.example',");
    expect(content).toContain('  return new Request(`https://app.example${route.endpoint}${variant.query}`, {');
    expect(content).toContain("    body: route.method === 'GET' || route.method === 'HEAD' ? null : variant.body,");
    // 役なしの見張りは既定の組 1 つのまま(未ログインの組で入口の前の分岐は見える)。
    expect(content).toContain('expect(await leaksOf(backend, sessionCookieHeader(SESSION_COOKIE), FORBIDDEN_REFUSAL)).toEqual([]);');
  });

  it('見出しの読み取りを見張り、関門の許可表の外の名前・列挙を漏れにする(送るヘッダの見本に依らない。点検 7 回目 B7-1)', () => {
    const content = render();
    expect(content).toContain(`const GATE_HEADERS: ReadonlySet<string> = new Set([${GATE_HEADERS.map((name) => `'${name}'`).join(', ')}]);`);
    expect(content).toContain("      if (property === 'get' || property === 'has') return (name: string) => (read.add(name.toLowerCase()), target[property](name));");
    expect(content).toContain("const LISTING: ReadonlySet<PropertyKey> = new Set(['entries', 'forEach', 'keys', 'values', 'getSetCookie', Symbol.iterator]);");
    expect(content).toContain("      if (LISTING.has(property)) read.add('*');");
    // 未ログイン・役なしの両方の見張りが、包んだ要求で叩き、許可表の外の読み取りを漏れに足す。
    expect(content).toContain('      const observed = gateLeaks(await observeGate(await route.load(), watchHeaders(requestTo(route, variant), read), backend, cookie), expected);');
    expect(content).toContain(
      "      const reasons = [...observed, ...[...read].filter((name) => !GATE_HEADERS.has(name) && !GATE_REQUEST_FIELDS.has(name)).map((name) => (name.startsWith('request:') ? `request-read:${name.slice(8)}` : `header-read:${name}`))];",
    );
  });

  it('見出しのほかに url・本文・clone() の写しの読み取りも見張る(点検 8 回目 B8-5)', () => {
    const content = render();
    expect(content).toContain(`const BODY_READS: ReadonlySet<PropertyKey> = new Set([${BODY_READS.map((name) => `'${name}'`).join(', ')}]);`);
    expect(content).toContain("const GATE_REQUEST_FIELDS: ReadonlySet<string> = new Set(['request:url']);");
    expect(content).toContain("      if (property === 'url') read.add('request:url');");
    expect(content).toContain('      if (BODY_READS.has(property)) read.add(`request:body:${String(property)}`);');
    // 写しも同じ包み(写しの見出し・本文の読み取りが記録の外へ逃げない)。
    expect(content).toContain("      if (property === 'clone') return () => watchHeaders(target.clone(), read);");
  });

  it.each([
    { name: 'url は出どころの確認が自分のスキームに読むので許可表にある', field: 'url', allowed: true },
    { name: '本文は許可表に無い(閉じるまでに読めば漏れ)', field: 'body', allowed: false },
  ])('要求の欄の許可表: $name', ({ field, allowed }) => {
    expect(GATE_REQUEST_FIELDS.includes(field)).toBe(allowed);
  });

  it('本文の口は Request の本文を読む口を全部持つ', () => {
    expect([...BODY_READS].sort()).toEqual(['arrayBuffer', 'blob', 'body', 'bytes', 'formData', 'json', 'text']);
  });

  it('関門の許可表は、出どころの確認と拒否の行の識別子の見出しだけ(送るヘッダの見本の名前を含まない)', () => {
    expect(GATE_HEADERS).toEqual(['sec-fetch-site', 'origin', 'x-forwarded-host', 'host', 'x-forwarded-proto', 'x-vercel-id', 'x-request-id']);
    for (const name of ['x-preview-key', 'x-debug', 'authorization', 'x-api-key', 'cookie']) expect(GATE_HEADERS).not.toContain(name);
  });

  it('観測は実行時パッケージの道具で、モジュールを差し替えない。cookie の名前は adapter の約束の写し', () => {
    const content = render();
    expect(content).toContain("from '@kaninabe/runtime/testing/http/paid-gate';");
    expect(content).not.toMatch(/vi\.(mock|doMock|spyOn)/u);
    expect(content).toContain(`const SESSION_COOKIE = '${SESSION_COOKIE_NAME}';`);
    expect(content).toContain('for (const [name, value] of Object.entries(FAKE_BACKEND_ENV)) vi.stubEnv(name, value);');
    expect(content).toContain('backend.dispose();');
  });

  it.each([
    ['外部連携カタログが無い', { external: { available: false, catalog: null } }],
    ['有料の口が無い(spend: paid でない)', { external: externalModel([integration('chat', { effect: 'read', endpoints: ['/api/ai/a'] })]) }],
    ['実装の木が無い', { roots: { ...TEST_ROOTS, app: null } }],
  ] as const)('%s → 何も出さない', (_title, extra) => {
    expect(paidEntryTestsGenerator.generate(specModel([]), context(extra as Partial<GenerateContext>))).toEqual([]);
  });

  it('別の配置では書き先も口の import も配置に従う', () => {
    const [section] = paidEntryTestsGenerator.generate(specModel([]), context({ layout: FOREIGN_BODY_COMPATIBLE_LAYOUT, roots: FOREIGN_ROOTS }));
    expect(section?.file).toBe(placeOf('paid-entry-test', undefined, FOREIGN_BODY_COMPATIBLE_LAYOUT, FOREIGN_ROOTS.app));
    expect(section?.content).toContain(`(await import('${String(layoutModule(FOREIGN_BODY_COMPATIBLE_LAYOUT, 'http-entry', '/api/ai/a'))}')).POST`);
  });
});
