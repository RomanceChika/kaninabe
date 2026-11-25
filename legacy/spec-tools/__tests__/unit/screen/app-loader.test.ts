/**
 * 実装(app/)側ルートのローダー(I/O 境界)のテスト。
 *
 * 対象の要求: 「走査の起点を引数で受け取り、`app/src/app` の page からルートを集める。
 * `src/proxy.ts` の matcher を静的に読む。app/ が無くても壊れない」。
 *
 * 規約(scripts-code-quality.md)により fixture ファイルを使うのはローダー自身のテストだけである。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadAppRoutes } from '../../../lib/screen/app-loader.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures');
const REPO_ROOT = path.resolve(FIXTURES, '..');

/** fixture の app ツリーを repoRoot 固定で読む(相対パスを安定させるため)。 */
function load(name: string) {
  return loadAppRoutes(path.join(FIXTURES, name), { roots: TEST_ROOTS, repoRoot: REPO_ROOT, layout: TEST_LAYOUT });
}

describe('loadAppRoutes', () => {
  it('page から実ルートを集める(ルートグループは畳み、内部ファイルは拾わない)', () => {
    const model = load('app-routes');

    expect(model.available).toBe(true);
    expect(model.routes.map((route) => route.route)).toEqual([
      '/',
      '/about',
      '/login',
      '/workshops',
      '/workshops/:id',
    ]);
  });

  it('ルーティング層の下の全部のファイルを数える: スロット・インターセプトの部品も、知らない形のセグメントも実ルートとして S7 の前に並ぶ(点検 13 回目 B13-1)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'app-slot-'));
    try {
      for (const file of ['src/app/page.tsx', 'src/app/@modal/default.tsx', 'src/app/@modal/secret/page.tsx', 'src/app/x/(.)y/page.tsx', 'src/app/%5Fz/card.tsx', 'src/app/_private/page.tsx', 'src/app/layout.tsx']) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), '');
      }
      const model = loadAppRoutes(root, { roots: TEST_ROOTS, repoRoot: root, layout: TEST_LAYOUT });
      expect(model.routes.map((route) => route.route).sort()).toEqual(['/', '/%5Fz/card.tsx', '/@modal/default.tsx', '/@modal/secret/page.tsx', '/x/(.)y/page.tsx'].sort());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('見つけたルートにリポジトリ相対のファイルパスを添える(指摘の位置になる)', () => {
    const detail = load('app-routes').routes.find((route) => route.route === '/workshops/:id');

    expect(detail?.file).toBe('fixtures/app-routes/src/app/workshops/[id]/page.tsx');
  });

  it('proxy.ts の matcher を文字列の実行時の値で読む(解釈はしない。字面の `\\d` は JS では `d` — 6 回目 B6-3 でエスケープを外して読む)', () => {
    const proxy = load('app-routes').proxy;

    expect(proxy.available).toBe(true);
    expect(proxy.patterns).toEqual(['/workshops/:path*', '/settings/:id(d+)']);
    expect(proxy.file).toBe('fixtures/app-routes/src/proxy.ts');
  });

  it('app/src/app が無ければ available: false(実装がまだ無い構成でも壊れない)', () => {
    const model = load('domain-valid');

    expect(model.available).toBe(false);
    expect(model.routes).toEqual([]);
    expect(model.proxy.available).toBe(false);
  });

  it('proxy.ts が無ければ matcher は「読めていない」になる(覆っている扱いにしない)', () => {
    // app-sample には src/app はあるが src/proxy.ts が無い。
    const model = load('app-sample');

    expect(model.available).toBe(true);
    expect(model.proxy).toMatchObject({ available: false, patterns: [] });
  });
});

describe('loadAppRoutes: 走査の根・逆引き・リクエスト前段の置き場は置き場の配置から引く(Next.js と綴りの重ならない架空の配置)', () => {
  const created: string[] = [];
  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** 一時ディレクトリを作る(テストの後で消す)。 */
  function temp(prefix: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), prefix));
    created.push(dir);
    return dir;
  }

  /** 架空の配置(`server_code/pages/*.view.ts` ・`server_code/edge_filter.ts`)に合わせた木を一時ディレクトリに作る。 */
  function foreignTree(): string {
    const root = temp('app-loader-foreign-');
    const write = (relative: string, text: string): void => {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      writeFileSync(path.join(root, relative), text);
    };
    write('server_code/pages/index.view.ts', '');
    write('server_code/pages/workshops/:id.view.ts', '');
    write('server_code/pages/workshops/notes.txt', '');
    write('server_code/edge_filter.ts', "export const config = { matcher: ['/workshops/:path*'] };\n");
    // Next.js の綴りの木は、この配置では画面の器ではない(走査の根の外・逆引きに当たらない)。
    write('src/app/ignored/page.tsx', '');
    write('server_code/pages/ignored/page.tsx', '');
    return root;
  }

  it('配置の走査の根の下から、配置の逆引きで route を集める(Next.js の page.tsx は数えない)', () => {
    const root = foreignTree();
    const model = loadAppRoutes(root, { roots: TEST_ROOTS, repoRoot: root, layout: FOREIGN_LAYOUT });

    expect(model.available).toBe(true);
    expect(model.routes.map((route) => route.route)).toEqual(['/', '/workshops/:id']);
    expect(model.routes.map((route) => route.file)).toEqual(['server_code/pages/index.view.ts', 'server_code/pages/workshops/:id.view.ts']);
  });

  it('リクエスト前段の matcher は、配置のリクエスト前段の置き場から読む', () => {
    const root = foreignTree();
    const model = loadAppRoutes(root, { roots: TEST_ROOTS, repoRoot: root, layout: FOREIGN_LAYOUT });

    expect(model.proxy).toMatchObject({ available: true, patterns: ['/workshops/:path*'] });
    expect(model.proxy.file).toMatch(/server_code\/edge_filter\.ts$/);
  });

  it('実装の木はあるが走査の根(配置の画面の器の置き場)がまだ無いときは available: false(実装がまだ無い = スキップ。配置の欠落ではない)', () => {
    const empty = temp('app-loader-empty-');
    const model = loadAppRoutes(empty, { roots: TEST_ROOTS, repoRoot: empty, layout: FOREIGN_LAYOUT });

    expect(model.available).toBe(false);
    expect(model.placementProblem).toBeUndefined();
  });

  it('実装の木(ディレクトリ)があるのに、配置が画面の器の走査の根を決められない(空の配置・逆引きの無い宣言)ときは、スキップではなく前提の失敗(placementProblem)', () => {
    const tree = foreignTree();
    for (const layout of [{}, { ...FOREIGN_LAYOUT, 'screen-shell': undefined }]) {
      const model = loadAppRoutes(tree, { roots: TEST_ROOTS, repoRoot: tree, layout });

      expect(model.available).toBe(false);
      expect(model.routes).toEqual([]);
      expect(model.placementProblem).toContain('画面の器(screen-shell)の走査の根を決められません');
    }
    // 実装の木そのものが無ければ、配置が欠けていても実装が無いことが先(スキップ)。
    const missing = path.join(temp('app-loader-missing-'), 'no-such-app');
    expect(loadAppRoutes(missing, { roots: TEST_ROOTS, repoRoot: REPO_ROOT, layout: {} })).toMatchObject({ available: false });
    expect(loadAppRoutes(missing, { roots: TEST_ROOTS, repoRoot: REPO_ROOT, layout: {} }).placementProblem).toBeUndefined();
  });

  it('配置にリクエスト前段(request-gate)が無い構成は、matcher を「読めていない」ではなく配置に無い(requestGateMissing)と持ち帰る', () => {
    const tree = foreignTree();
    const { 'request-gate': _gate, ...withoutGate } = FOREIGN_LAYOUT;
    const model = loadAppRoutes(tree, { roots: TEST_ROOTS, repoRoot: tree, layout: withoutGate });

    expect(model.available).toBe(true);
    expect(model.routes.map((route) => route.route)).toEqual(['/', '/workshops/:id']);
    expect(model.requestGateMissing).toBe(true);
    expect(model.proxy).toEqual({ available: false, file: '', patterns: [] });
    // 配置にあるなら立たない(置き場に書かれていなければ「読めていない」のまま)。
    expect(loadAppRoutes(tree, { roots: TEST_ROOTS, repoRoot: tree, layout: FOREIGN_LAYOUT }).requestGateMissing).toBeUndefined();
  });
});
