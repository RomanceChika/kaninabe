/**
 * J2(続き)HTTP の入口の閉世界の**母集合**のテスト(6 回目 C6-2・C6-5・B6-2)。
 *
 * 母集合は「Next.js が要求を受けて実行するファイルの全種類」で、許すのは `src/app/**\/route.ts`(宣言との突き合わせ)・画面のページ・
 * メタデータの静的な形だけ。ほかの口になるファイル(メタデータのルートの動的な形・`route.` の別の綴り)と、走査の根の外の口の根
 * (製品の根の `pages` / `src/pages` / `app`)・`next.config.*` の許可表の外の欄(`pageExtensions` など。表のテストは `frame-config-keys.test.ts`)は error。表は `lib/targets/nextjs/layout.ts`(置き場の値のファイル)。
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyEntryClosedWorld } from '../../../../lib/job/verifiers/j2-entry-closed.js';
import type { EntryClosedInput } from '../../../../lib/job/verifiers/j2-entry-closed.js';
import { isHttpEntryCandidate, routingFileKind } from '../../../../lib/targets/nextjs/layout.js';
import { authModel } from '../../../helpers/auth-builder.js';
import { jobModel, scheduledJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { FRAME_CONFIG_TEXT, putFrameConfig } from '../../../helpers/frame-config.js';
import { UNSELECTED } from '../../../helpers/verify-inputs.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 製品の根(`app/`)からの相対パス → 本文 の一時の木(宣言した口 `/api/hook` の route.ts は常に置く)。 */
function productTree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'j2-entry-surface-'));
  made.push(root);
  // 枠の設定は在ることを要する(点検 16 回目 C16-3)。テストが自分で next.config.* を置くときは、それだけを置く。
  if (!Object.keys(files).some((file) => file.startsWith('next.config.'))) putFrameConfig(root);
  for (const [file, text] of Object.entries({ 'src/app/api/hook/route.ts': "import { guardRoute } from '@kaninabe/runtime/http/route-guard';\nexport const POST = guardRoute(async () => new Response());\n", ...files })) {
    const target = path.join(root, 'app', file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return root;
}

function run(repoRoot: string): ReturnType<typeof verifyEntryClosedWorld> {
  const input: EntryClosedInput = {
    jobs: jobModel([scheduledJob('hook', { endpoint: '/api/hook' })]),
    external: UNSELECTED,
    auth: authModel({}),
    repoRoot,
    roots: TEST_ROOTS,
    layout: TEST_LAYOUT,
  };
  return verifyEntryClosedWorld(input);
}

describe('routingFileKind(Next が要求を受けて実行する・配るファイルの表)', () => {
  it.each([
    // Route Handler
    ['api/x/route.ts', 'route'],
    ['api/x/route.api.ts', 'route'],
    ['route.js', 'route'],
    // メタデータの動的な形(どの深さでも: icon / apple-icon / opengraph-image / twitter-image(数字 1 つ)・sitemap)
    ['admin/opengraph-image.tsx', 'metadata-dynamic'],
    ['admin/opengraph-image2.tsx', 'metadata-dynamic'],
    ['x/twitter-image.ts', 'metadata-dynamic'],
    ['icon.tsx', 'metadata-dynamic'],
    ['x/icon1.js', 'metadata-dynamic'],
    ['apple-icon.jsx', 'metadata-dynamic'],
    ['sitemap.ts', 'metadata-dynamic'],
    ['x/sitemap.ts', 'metadata-dynamic'],
    ['icon.mts', 'metadata-dynamic'],
    ['icon.PNG', 'metadata-dynamic'],
    // 根だけの名前(robots / manifest / favicon)
    ['robots.ts', 'metadata-dynamic'],
    ['manifest.ts', 'metadata-dynamic'],
    ['favicon.tsx', 'metadata-dynamic'],
    // 静的な形
    ['icon.png', 'metadata-static'],
    ['icon.svg', 'metadata-static'],
    ['x/icon1.ico', 'metadata-static'],
    ['apple-icon.png', 'metadata-static'],
    ['opengraph-image.gif', 'metadata-static'],
    ['x/twitter-image.jpeg', 'metadata-static'],
    ['favicon.ico', 'metadata-static'],
    ['robots.txt', 'metadata-static'],
    ['manifest.webmanifest', 'metadata-static'],
    ['manifest.json', 'metadata-static'],
    ['x/sitemap.xml', 'metadata-static'],
    // 口にならないもの
    ['opengraph-image.alt.txt', null],
    ['x/robots.ts', null],
    ['x/favicon.ico', null],
    ['x/manifest.ts', null],
    ['icon12.png', null],
    ['icon-button.tsx', null],
    ['sitemap1.ts', null],
    ['page.tsx', null],
    ['layout.tsx', null],
    ['_components/Icon.tsx', null],
    ['api/x/routes.ts', null],
  ] as const)('%s → %s', (file, kind) => {
    expect(routingFileKind(file)).toBe(kind);
    expect(isHttpEntryCandidate(file)).toBe(kind === 'route' || kind === 'metadata-dynamic');
  });
});

describe('verifyEntryClosedWorld: 母集合は Next の口の全種類(C6-2)', () => {
  it('宣言した route.ts と静的なメタデータ・ページ・部品だけなら緑', () => {
    const root = productTree({
      'src/app/icon.png': '',
      'src/app/favicon.ico': '',
      'src/app/x/opengraph-image.png': '',
      'src/app/x/opengraph-image.alt.txt': 'alt',
      'src/app/robots.txt': '',
      'src/app/page.tsx': 'export default function P() { return null; }\n',
      'src/app/_components/icon-button.tsx': 'export {};\n',
      'next.config.ts': FRAME_CONFIG_TEXT,
    });
    expect(run(root).findings).toEqual([]);
  });

  it.each([
    ['C6-2 の反例: opengraph-image.tsx(認可の宣言なしの GET)', 'src/app/admin/opengraph-image.tsx'],
    ['sitemap.ts', 'src/app/sitemap.ts'],
    ['robots.ts', 'src/app/robots.ts'],
    ['manifest.ts', 'src/app/manifest.ts'],
    ['icon.tsx', 'src/app/x/icon.tsx'],
    ['apple-icon1.js', 'src/app/apple-icon1.js'],
    ['twitter-image.ts', 'src/app/x/twitter-image.ts'],
    ['C6-5 の反例: 点を含む拡張子の route.api.ts', 'src/app/api/x/route.api.ts'],
  ])('%s は error', (_name, file) => {
    const result = run(productTree({ [file]: 'export default function Image() { return new Response(); }\n' }));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ verifier: 'J2', severity: 'error', location: { file: `app/${file}` } });
    expect(result.findings[0]?.message).toContain('route.ts の綴りではありません');
  });
});

describe('verifyEntryClosedWorld: 走査の根の外の口の根と設定(C6-5・B6-2)', () => {
  it.each([
    ['B6-2 の反例: src/pages/api の Pages Router', 'src/pages/api/draft.js', 'app/src/pages'],
    ['製品の根の pages', 'pages/index.tsx', 'app/pages'],
    ['C6-5 の反例: 製品の根の app/(src/app より優先される)', 'app/api/x/route.ts', 'app/app'],
    ['空のファイルでも(Next は existsSync で選ぶ)', 'pages', 'app/pages'],
  ])('%s は error', (_name, file, located) => {
    const result = run(productTree({ [file]: 'export default function handler() {}\n' }));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ verifier: 'J2', severity: 'error', location: { file: located } });
    expect(result.findings[0]?.message).toContain('HTTP の口の根');
  });

  it.each([
    ['B13-7 の反例: public/api の文書', 'public/api/x.html'],
    ['public の直下の文書', 'public/x.htm'],
    ['スクリプトを持てる画像', 'public/x.svg'],
    ['スクリプト', 'public/a/b.js'],
    ['拡張子なし', 'public/LICENSE'],
    ['大文字の拡張子', 'public/x.PNG'],
  ])('%s は error', (_name, file) => {
    const result = run(productTree({ [file]: 'x\n' }));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ verifier: 'J2', severity: 'error', location: { file: `app/${file}` } });
    expect(result.findings[0]?.message).toContain('許可表の外');
  });

  it.each([['画像', 'public/a/x.png'], ['書体', 'public/x.woff2'], ['ico', 'public/favicon.ico']])('public の%sは通す', (_name, file) => {
    expect(run(productTree({ [file]: 'x\n' })).findings).toEqual([]);
  });

  it('リンクでも(宙ぶらりんでも)置き場があれば error', () => {
    const root = productTree({});
    symlinkSync(path.join(root, 'nowhere'), path.join(root, 'app', 'pages'));
    expect(run(root).findings.map((finding) => finding.location?.file)).toEqual(['app/pages']);
  });

  it('ルーティング層の中の pages という名前のセグメント(/pages の URL)は口の根ではない', () => {
    expect(run(productTree({ 'src/app/pages/page.tsx': 'export default function P() { return null; }\n' })).findings).toEqual([]);
  });

  it.each(['next.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.mts'])('C6-5 の反例: %s の pageExtensions は error', (file) => {
    const result = run(productTree({ [file]: "export default { pageExtensions: ['ts', 'tsx', 'api.ts'] };\n" }));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ verifier: 'J2', location: { file: `app/${file}` } });
    expect(result.findings[0]?.message).toContain('pageExtensions');
  });

  it.each([
    ['C7-4 の反例: 識別子の Unicode エスケープ', "export default { page\\u0045xtensions: ['ts', 'tsx', 'api.ts'] };\n"],
    ['C7-4 の反例: 計算した鍵', "const k = 'page' + 'Extensions';\nexport default { [k]: ['ts', 'tsx', 'api.ts'] };\n"],
    ['C7-4 の反例: 別ファイルからの import', "import base from './next.base';\nexport default base;\n"],
    ['rewrites(要求を別の行き先へ流す)', 'export default { async rewrites() { return []; } };\n'],
    ['B7-4 の反例: headers に Cache-Control: public を足す', 'export default { async headers() { return [{ source: "/:path*", headers: [{ key: "Cache-Control", value: "public" }] }]; } };\n'],
  ])('%s は error', (_name, text) => {
    const result = run(productTree({ 'next.config.ts': text }));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ verifier: 'J2', severity: 'error', location: { file: 'app/next.config.ts' } });
  });

  it('製品の実物の next.config.ts の形(許可表の 6 欄・const を指す既定の export)は緑', () => {
    const text = [
      'import type { NextConfig } from "next";',
      'const nextConfig: NextConfig = {',
      '  poweredByHeader: false,',
      '  async headers() { return [{ source: "/:path*", headers: staticHeaderEntries(BROWSER_DEFENSE) }]; },',
      '  agentRules: false,',
      '  distDir: process.env["NEXT_DIST_DIR"] ?? ".next",',
      '  typescript: { tsconfigPath: "tsconfig.json" },',
      '  experimental: { agentUpgrade: false },',
      '};',
      'export default nextConfig;',
    ].join('\n');
    expect(run(productTree({ 'next.config.ts': text })).findings).toEqual([]);
  });
});

describe('verifyEntryClosedWorld: 在ることを要する設定と、名前で呼ばれる直下(点検 16 回目 C16-3・C16-7)', () => {
  it('枠の設定がどの名前でも無ければ error(1 件。名前を全部挙げる)', () => {
    const root = productTree({ 'next.config.ts': FRAME_CONFIG_TEXT });
    rmSync(path.join(root, 'app/next.config.ts'));
    const result = run(root);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ verifier: 'J2', severity: 'error', location: { file: 'app/next.config.js' } });
    expect(result.findings[0]?.message).toContain('app/next.config.js / app/next.config.mjs / app/next.config.ts / app/next.config.mts のどれか');
  });

  it.each([
    ['headers を消す', 'export default { poweredByHeader: false };\n', '欄 headers が無い'],
    ['poweredByHeader を消す', 'export default { async headers() { return [{ source: "/:path*", headers: staticHeaderEntries(BROWSER_DEFENSE) }]; } };\n', '欄 poweredByHeader が無い'],
  ])('枠の設定から値を固定した欄を%sと error', (_name, text, message) => {
    const result = run(productTree({ 'next.config.ts': text }));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain(message);
  });

  it.each([
    ['C16-3 の反例: instrumentation.ts', 'src/instrumentation.ts'],
    ['instrumentation-client.ts', 'src/instrumentation-client.ts'],
    ['C16-3 の反例: middleware.ts(旧名の前段)', 'src/middleware.ts'],
    ['instrumentation.js', 'src/instrumentation.js'],
    ['middleware.mjs', 'src/middleware.mjs'],
    ['proxy.tsx(綴り違い)', 'src/proxy.tsx'],
    ['表に無い名前のコード', 'src/zz.ts'],
  ])('src の直下の %s は error', (_name, file) => {
    const result = run(productTree({ 'src/proxy.ts': 'export {};\n', [file]: 'export function register(): void {}\n' }));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ verifier: 'J2', severity: 'error', location: { file: `app/${file}` } });
    expect(result.findings[0]?.message).toContain('枠が名前で呼びうる置き場の直下のコード');
  });

  it.each([
    ['proxy.ts(許可表の名前)', 'src/proxy.ts'],
    ['コードでない README.md', 'src/README.md'],
    ['層の下の instrumentation.ts', 'src/composition/instrumentation.ts'],
    ['ドット始まりは枠が読まない', 'src/.middleware.ts'],
  ])('%s は通す', (_name, file) => {
    expect(run(productTree({ [file]: 'export {};\n' })).findings).toEqual([]);
  });

  it('C16-7 の反例: public の下の読めないディレクトリは error(中の文書を確かめられない)', () => {
    const root = productTree({ 'public/locked/x.html': '<script>alert(1)</script>\n' });
    const locked = path.join(root, 'app/public/locked');
    chmodSync(locked, 0o000);
    try {
      const result = run(root);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({ verifier: 'J2', severity: 'error', location: { file: 'app/public/locked' } });
      expect(result.findings[0]?.message).toContain('読めませんでした');
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  it('public の下の読めない名前(制御文字)も飛ばさずに拡張子を見る(C16-7)', () => {
    const result = run(productTree({ 'public/x\u0001.html': 'x\n' }));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('許可表の外');
  });
});

describe('verifyEntryClosedWorld: 指定子の解き方を変える設定(点検 7 回目 B7-2)', () => {
  /** 製品の実物の tsconfig の別名(配置の `@/` → `src`)。 */
  const TSCONFIG = JSON.stringify({ compilerOptions: { strict: true, paths: { '@/*': ['./src/*'] } } });

  it('正例: 製品の実物の形(package.json の依存の欄・tsconfig の別名 1 本)は緑', () => {
    const tree = productTree({ 'package.json': JSON.stringify({ name: 'app', dependencies: { next: '1' } }), 'tsconfig.json': TSCONFIG });
    expect(run(tree).findings).toEqual([]);
  });

  it.each([
    ['B7-2 の反例: package.json の imports', 'package.json', JSON.stringify({ name: 'app', imports: { '#comp/*': './src/composition/*.ts' } }), 'imports'],
    ['tsconfig の paths の別名', 'tsconfig.json', JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'], '#comp/*': ['./src/composition/*'] } } }), '#comp'],
    ['tsconfig の baseUrl', 'tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.' } }), 'baseUrl'],
  ])('負例: %s は J2 の error(ファイルを名指す)', (_name, file, text, reason) => {
    const result = run(productTree({ [file]: text }));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ verifier: 'J2', severity: 'error', location: { file: `app/${file}` } });
    expect(result.findings[0]?.message).toContain(reason);
  });
});
