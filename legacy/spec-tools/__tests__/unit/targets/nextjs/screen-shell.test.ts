/**
 * アプリの枠の後段 Next.js の、画面の器まわりの置き場の値(`screen-shell` の逆引き `routeFromPageFile`・`request-gate` ・`screen-part` ・
 * `screen-test` ・`app-icon`)のテスト。
 *
 * 逆引きの規則は **Next.js の規則の写し**(旧 `screen/route-match.ts` の `routeFromPageFile`。移しただけで挙動は変えない)。
 * 解決の仕組みそのもの(役割 + キー → パス・往復)は `model/product/layout.test.ts` が見る。
 */

import { describe, expect, it } from 'vitest';
import {
  appIconPath,
  layoutPath,
  layoutRoundTrips,
  layoutScan,
  requestGatePath,
  screenPartPath,
  screenShellPath,
  screenTestPath,
} from '../../../../lib/model/product/layout.js';
import { layoutDefinitionProblems } from '../../../../lib/model/product/layout-definition.js';
import { screenDetailsGenerator } from '../../../../lib/generate/render/code-screen-details.js';
import { screenFormsGenerator } from '../../../../lib/generate/render/code-screen-forms.js';
import { screenTablesGenerator } from '../../../../lib/generate/render/code-screen-tables.js';
import { platformPartsGenerator } from '../../../../lib/generate/render/code-platform-parts.js';
import { isSpecRouteForm } from '../../../../lib/model/screen/route-syntax.js';
import { classifyPageFile, isHttpEntryCandidate, isRouteFile, NEXTJS_LAYOUT, routeFromPageFile, urlFromRouteFile } from '../../../../lib/targets/nextjs/layout.js';

const ROOTS = { app: 'app' };

describe('routeFromPageFile(screen-shell の逆引き)', () => {
  it('page.tsx の位置をルート表記にする', () => {
    expect(routeFromPageFile('page.tsx')).toBe('/');
    expect(routeFromPageFile('login/page.tsx')).toBe('/login');
  });

  it('置き場の動的セグメント [id] は仕様の :id に正規化して返す(逆引きは仕様の記法で返す)', () => {
    expect(routeFromPageFile('workshops/[id]/page.tsx')).toBe('/workshops/:id');
    expect(routeFromPageFile('stores/[store_id]/shelves/[shelf_id]/page.tsx')).toBe('/stores/:store_id/shelves/:shelf_id');
    expect(routeFromPageFile('(app)/workshops/[id]/page.tsx')).toBe('/workshops/:id');
  });

  it('キャッチオール [...x] / [[...x]] は未対応として別に返す(単一の param に誤変換しない)。キーとしては置き場の綴りのまま返り、どの仕様の route とも一致しない', () => {
    expect(classifyPageFile('docs/[...slug]/page.tsx')).toMatchObject({ rawRoute: '/docs/[...slug]/page.tsx', unsupported: expect.stringContaining('[...slug]') });
    expect(classifyPageFile('docs/[[...slug]]/page.tsx')).toMatchObject({ rawRoute: '/docs/[[...slug]]/page.tsx' });
    expect(classifyPageFile('docs/[Id]/page.tsx')).toMatchObject({ rawRoute: '/docs/[Id]/page.tsx' });
    expect(classifyPageFile('docs/[id]/page.tsx')).toEqual({ route: '/docs/:id' });
    expect(classifyPageFile('guide/parts.tsx')).toEqual({ outside: 'not-a-page' });
    expect(routeFromPageFile('docs/[...slug]/page.tsx')).toBe('/docs/[...slug]/page.tsx');
    expect(routeFromPageFile('docs/[...slug]/page.tsx')).not.toBe('/docs/:slug');
  });

  it('ルートグループはパスに現れない', () => {
    expect(routeFromPageFile('(marketing)/about/page.tsx')).toBe('/about');
  });

  it('page 以外のファイルはルートを作らない', () => {
    expect(routeFromPageFile('layout.tsx')).toBeNull();
    expect(routeFromPageFile('api/jobs/run/route.ts')).toBeNull();
    expect(routeFromPageFile('workshops/parts.tsx')).toBeNull();
    expect(routeFromPageFile('proxy.ts')).toBeNull();
  });

  it('非公開フォルダの下はルートを作らない(Next.js が読まない)', () => {
    expect(routeFromPageFile('workshops/_components/page.tsx')).toBeNull();
    expect(classifyPageFile('workshops/_components/page.tsx')).toEqual({ outside: 'private' });
    expect(classifyPageFile('_x/@modal/page.tsx')).toEqual({ outside: 'private' });
  });

  // 点検 13 回目 B13-1: 以前は null で黙って落ちた形。どれも本物の URL になる(本番ビルドで実測)ので、未対応の配置として S7 が赤にする。
  it.each([
    ['@modal/page.tsx', '/@modal/page.tsx', 'パラレルルート'],
    ['@modal/secret/page.tsx', '/@modal/secret/page.tsx', 'パラレルルート'],
    ['@modal/api/preview/page.tsx', '/@modal/api/preview/page.tsx', 'パラレルルート'],
    ['@modal/organizer/reports/[id]/page.tsx', '/@modal/organizer/reports/[id]/page.tsx', 'パラレルルート'],
    ['@modal/[...all]/page.tsx', '/@modal/[...all]/page.tsx', 'パラレルルート'],
    ['@modal/default.tsx', '/@modal/default.tsx', 'パラレルルート'],
    ['@modal/layout.tsx', '/@modal/layout.tsx', 'パラレルルート'],
    ['@modal/parts/card.tsx', '/@modal/parts/card.tsx', 'パラレルルート'],
    ['feed/@side/page.tsx', '/feed/@side/page.tsx', 'パラレルルート'],
    ['(g)/@modal/page.tsx', '/@modal/page.tsx', 'パラレルルート'],
    ['feed/(.)photo/page.tsx', '/feed/(.)photo/page.tsx', 'インターセプト'],
    ['feed/(..)photo/page.tsx', '/feed/(..)photo/page.tsx', 'インターセプト'],
    ['feed/(...)photo/page.tsx', '/feed/(...)photo/page.tsx', 'インターセプト'],
    ['feed/(..)(..)photo/page.tsx', '/feed/(..)(..)photo/page.tsx', 'インターセプト'],
    ['zint/(.)zt/page.tsx', '/zint/(.)zt/page.tsx', 'インターセプト'],
    ['feed/(.)photo/layout.tsx', '/feed/(.)photo/layout.tsx', 'インターセプト'],
    ['docs/[...slug]/layout.tsx', '/docs/[...slug]/layout.tsx', 'キャッチオール'],
    ['docs/[...slug]/parts/card.tsx', '/docs/[...slug]/parts/card.tsx', 'キャッチオール'],
    ['%5Fx/page.tsx', '/%5Fx/page.tsx', '読める形'],
    ['Admin/page.tsx', '/Admin/page.tsx', '読める形'],
    ['a.b/page.tsx', '/a.b/page.tsx', '読める形'],
    ['.well-known/page.tsx', '/.well-known/page.tsx', '読める形'],
    ['(a)(b)/page.tsx', '/(a)(b)/page.tsx', '読める形'],
    ['(a)b/page.tsx', '/(a)b/page.tsx', '読める形'],
    ['(A)/page.tsx', '/(A)/page.tsx', '読める形'],
    ['a b/page.tsx', '/a b/page.tsx', '読める形'],
    ['x/page.mjs', '/x/page.mjs', 'ページの綴り'],
    ['x/page.mdx', '/x/page.mdx', 'ページの綴り'],
    ['x/page.test.tsx', '/x/page.test.tsx', 'ページの綴り'],
    ['x/Page.tsx', '/x/Page.tsx', 'ページの綴り'],
  ])('%s は未対応の配置(%s)', (file, rawRoute, reason) => {
    expect(classifyPageFile(file)).toEqual({ rawRoute, unsupported: expect.stringContaining(reason) });
    const key = routeFromPageFile(file);
    expect(key).toBe(rawRoute);
    expect(isSpecRouteForm(key ?? '')).toBe(false);
  });

  it('読める配置のページでないファイルは、名指して外す(黙って落ちる枝は無い)', () => {
    for (const file of ['layout.tsx', 'api/x/route.ts', 'x/parts.tsx', 'x/ui.module.css', 'proxy.ts', 'x/pages.tsx', 'x/page', 'x/layouts.tsx', 'x/templates.ts', 'x/errors.ts']) {
      expect(classifyPageFile(file), file).toEqual({ outside: 'not-a-page' });
    }
  });

  // @spec screen-spec-writing 点検 14 回目 B14-1: page の外側で描くファイルの閉世界。出力は関門の結果を待たずに 307 / 404 の本文へ流れる
  it.each([
    ['docs/layout.tsx', '/docs/layout.tsx'],
    ['(g)/layout.tsx', '/layout.tsx'],
    ['a/b/[id]/layout.tsx', '/a/b/[id]/layout.tsx'],
    ['layout.js', '/layout.js'],
    ['layout.ts', '/layout.ts'],
    ['Layout.tsx', '/Layout.tsx'],
    ['x/layout.mjs', '/x/layout.mjs'],
    ['template.tsx', '/template.tsx'],
    ['x/template.tsx', '/x/template.tsx'],
    ['docs/[id]/loading.tsx', '/docs/[id]/loading.tsx'],
    ['(g)/error.tsx', '/error.tsx'],
    ['error.tsx', '/error.tsx'],
    ['global-error.tsx', '/global-error.tsx'],
    ['not-found.tsx', '/not-found.tsx'],
    ['x/not-found.tsx', '/x/not-found.tsx'],
    ['x/forbidden.tsx', '/x/forbidden.tsx'],
    ['x/unauthorized.tsx', '/x/unauthorized.tsx'],
    ['x/default.tsx', '/x/default.tsx'],
  ])('%s は関門の外側で描くので未対応の配置', (file, rawRoute) => {
    expect(classifyPageFile(file)).toEqual({ rawRoute, unsupported: expect.stringContaining('関門の外側') });
    expect(isSpecRouteForm(routeFromPageFile(file) ?? '')).toBe(false);
  });

  it('非公開フォルダの下の同じ名前はルーティングに載らないので見ない(対照)', () => {
    expect(classifyPageFile('_lib/layout.tsx')).toEqual({ outside: 'private' });
    expect(classifyPageFile('_screens/generated/default.module.css')).toEqual({ outside: 'private' });
  });

  it('page.ts / page.jsx / page.js も page として扱う', () => {
    for (const file of ['page.ts', 'page.jsx', 'page.js']) expect(routeFromPageFile(file), file).toBe('/');
  });
});

describe('urlFromRouteFile(http-entry の逆引き。部品化 ③-c2b)', () => {
  it('route.ts の位置を URL のパスにする(根は `/`・ルートグループはパスに現れない)', () => {
    expect(urlFromRouteFile('route.ts')).toBe('/');
    expect(urlFromRouteFile('api/jobs/run/route.ts')).toBe('/api/jobs/run');
    expect(urlFromRouteFile('(internal)/api/x/route.ts')).toBe('/api/x');
    // 受ける綴りは route.ts だけ(ほかの綴りは閉世界が綴りの誤りとして言う。5 回目 C5-4・B5-1)
    expect(urlFromRouteFile('api/x/route.js')).toBeNull();
  });

  it('route 以外のファイル(page・layout・テスト)は HTTP の入口ではない。画面の器の逆引きも route.ts を拾わない', () => {
    for (const file of ['page.tsx', 'api/x/page.tsx', 'layout.tsx', 'api/__tests__/generated/cron-routes.test.ts', 'proxy.ts']) {
      expect(urlFromRouteFile(file), file).toBeNull();
    }
    expect(routeFromPageFile('api/x/route.ts')).toBeNull();
  });

  it('非公開フォルダ・パラレルルート・インターセプトの下は URL にならない。動的なセグメントは 1 本の URL に結べないので null(Cron が叩く URL にならない)', () => {
    for (const file of ['_cron/x/route.ts', 'api/_x/route.ts', '@a/x/route.ts', '(.)x/route.ts', '[x]/y/route.ts', 'a/[...rest]/route.ts', 'a/[[...rest]]/route.ts']) {
      expect(urlFromRouteFile(file), file).toBeNull();
    }
  });
});

describe('isRouteFile(http-entry の入口のファイル。キーに結べるかには依らない)', () => {
  it('route. で始まるファイルは全部入口のファイル(route.ts 以外の綴り — 点を含む pageExtensions の route.api.ts も — 閉世界が綴りの誤りとして言うために数える。6 回目 C6-5)。動的なセグメントや非公開フォルダの下でも入口のファイルとして数える(urlFromRouteFile は null を返す)', () => {
    for (const file of ['route.ts', 'route.tsx', 'api/jobs/run/route.ts', 'api/x/route.js', 'api/x/route.jsx', 'api/x/route.tsx', 'api/x/route.mjs', 'api/x/route.cjs', 'api/x/route.mts', 'api/x/route.api.ts', 'api/x/route.test.ts', 'api/[id]/route.ts', 'a/[...rest]/route.ts', '_cron/x/route.ts', '@a/x/route.ts', '(.)x/route.ts']) {
      expect(isRouteFile(file), file).toBe(true);
    }
    for (const file of ['page.tsx', 'api/x/page.tsx', 'layout.tsx', 'api/__tests__/generated/cron-routes.test.ts', 'proxy.ts', 'api/x/routes.ts', 'api/x/route', 'api/x/my-route.ts']) {
      expect(isRouteFile(file), file).toBe(false);
    }
    expect(urlFromRouteFile('api/[id]/route.ts')).toBeNull();
    expect(urlFromRouteFile('api/x/route.tsx')).toBeNull();
    expect(urlFromRouteFile('api/x/route.jsx')).toBeNull();
    expect(urlFromRouteFile('api/x/route.ts')).toBe('/api/x');
  });

  it('受ける綴りは route.ts 1 つで、置き場(httpEntryPath の綴り)と同じ(閉世界と検査側の食い違いをなくす)', () => {
    expect(NEXTJS_LAYOUT['http-entry']?.classify?.entryFileName).toBe('route.ts');
    expect(layoutScan(NEXTJS_LAYOUT, 'app', 'http-entry')?.entryFileName).toBe('route.ts');
    expect(NEXTJS_LAYOUT['http-entry']?.place?.('/api/x').endsWith('/route.ts')).toBe(true);
  });

  it('配置の http-entry の逆引きは入口のファイルの判定(entryOf)を持ち、走査の口(layoutScan)がそのまま運ぶ。画面の器の逆引きは持たない', () => {
    expect(NEXTJS_LAYOUT['http-entry']?.classify?.entryOf).toBe(isHttpEntryCandidate);
    expect(layoutScan(NEXTJS_LAYOUT, 'app', 'http-entry')?.entryOf?.('api/[id]/route.ts')).toBe(true);
    expect(layoutScan(NEXTJS_LAYOUT, 'app', 'screen-shell')?.entryOf).toBeUndefined();
  });
});

describe('NEXTJS_LAYOUT: 画面の器まわり', () => {
  it('仕様の route(動的セグメントは `:id`)→ 画面の器のパス(ディレクトリは `[id]`)', () => {
    expect(screenShellPath(NEXTJS_LAYOUT, ROOTS, '/')).toBe('app/src/app/page.tsx');
    expect(screenShellPath(NEXTJS_LAYOUT, ROOTS, '/workshops/:id')).toBe('app/src/app/workshops/[id]/page.tsx');
    expect(screenShellPath(NEXTJS_LAYOUT, ROOTS, '/stores/:store_id/shelves/:shelf_id')).toBe('app/src/app/stores/[store_id]/shelves/[shelf_id]/page.tsx');
    expect(screenShellPath(NEXTJS_LAYOUT, { app: null }, '/')).toBeNull();
  });

  it('逆引きの走査の根は画面の器の領域で、実在のファイル → route が往復で同じ route に戻る(非公開の名前の route は戻らない)', () => {
    expect(layoutScan(NEXTJS_LAYOUT, '', 'screen-shell')?.dir).toBe('src/app');
    expect(layoutScan(NEXTJS_LAYOUT, 'app', 'screen-shell')?.dir).toBe('app/src/app');
    expect(layoutScan(NEXTJS_LAYOUT, null, 'screen-shell')).toBeNull();
    // HTTP の入口も同じ走査の根を取る(同じセグメントに page と route の両方は置けない。逆引きの規則は urlFromRouteFile)。
    expect(layoutScan(NEXTJS_LAYOUT, '', 'http-entry')?.dir).toBe('src/app');
    expect(NEXTJS_LAYOUT['composition-root']?.classify).toBeUndefined();
    for (const route of ['/', '/login', '/workshops/:id', '/stores/:store_id/shelves/:shelf_id']) expect(layoutRoundTrips(NEXTJS_LAYOUT, 'screen-shell', route), route).toBe(true);
    expect(layoutRoundTrips(NEXTJS_LAYOUT, 'screen-shell', '/_private/x')).toBe(false);
    expect(layoutRoundTrips(NEXTJS_LAYOUT, 'screen-shell', '/@modal')).toBe(false);
    expect(layoutRoundTrips(NEXTJS_LAYOUT, 'http-entry', '/api/x')).toBe(true);
  });

  it('リクエスト前段・画面の部品の生成物・画面テスト・既定のアイコンの置き場', () => {
    expect(requestGatePath(NEXTJS_LAYOUT, ROOTS)).toBe('app/src/proxy.ts');
    expect(screenPartPath(NEXTJS_LAYOUT, ROOTS, 'workshop_manage.venue_form.tsx')).toBe('app/src/app/_screens/generated/workshop_manage.venue_form.tsx');
    expect(screenPartPath(NEXTJS_LAYOUT, { app: '' }, 'default.module.css')).toBe('src/app/_screens/generated/default.module.css');
    expect(screenTestPath(NEXTJS_LAYOUT, ROOTS, 'workshop-detail.test.tsx')).toBe('app/src/app/__screens__/workshop-detail.test.tsx');
    expect(appIconPath(NEXTJS_LAYOUT, ROOTS)).toBe('app/src/app/favicon.ico');
    expect(layoutPath(NEXTJS_LAYOUT, 'app', 'screen-part', 'a/b.tsx')).toBeNull();
  });

  it('配置そのものの契約を満たし、画面の器の部品を書く生成器の ID はコアの生成器と同じ', () => {
    expect(layoutDefinitionProblems(NEXTJS_LAYOUT)).toEqual([]);
    const owners = NEXTJS_LAYOUT['screen-part']?.owners.map((owner) => (owner.kind === 'generator' ? owner.id : owner.kind)).sort();
    expect(owners).toEqual([platformPartsGenerator.id, screenDetailsGenerator.id, screenFormsGenerator.id, screenTablesGenerator.id].sort());
  });
});
