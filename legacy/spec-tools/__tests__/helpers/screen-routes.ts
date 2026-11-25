/**
 * 画面の器の往復(部品化 ③-d3)で使う、画面仕様の `route` の集め方と往復の確認。
 * 6 題材を見る本体のテスト(`unit/targets/nextjs/screen-shell-roundtrip.test.ts`)と、製品の実物を見る側
 * (`dev-repo/unit/targets/nextjs/screen-shell-roundtrip.test.ts`)が同じものを使う。
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import { layoutClassify } from '../../lib/model/product/layout-classify.js';
import { screenShellPath } from '../../lib/model/product/layout.js';
import { NEXTJS_LAYOUT } from '../../lib/targets/nextjs/layout.js';

/** ディレクトリの下の screen_spec(雛形・README を除く)の `route` を集める。 */
export function routesIn(dir: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('template.') || entry.name === 'README.md') continue;
    const text = readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
    if (!/^doc_type: screen_spec$/m.test(text)) continue;
    const route = /^route: *["']?([^\s"'#]+)["']?/m.exec(text)?.[1];
    if (route !== undefined) routes.push(route);
  }
  return routes;
}

/** 動的セグメント(`:id`)を持つ route か。 */
export const isDynamic = (route: string): boolean => route.split('/').some((segment) => segment.startsWith(':'));

/**
 * 宣言された route が、置き場 → 逆引きで同じ route に戻る(往復)ことを確かめる。置き場のディレクトリは動的セグメントだけ [x] になる。
 *
 * @param name 題材(製品)の名前(失敗の表示用)
 * @param routes 宣言された route
 */
export function expectRoundtrip(name: string, routes: readonly string[]): void {
  const placed = routes.map((route) => {
    const file = screenShellPath(NEXTJS_LAYOUT, { app: 'app' }, route);
    expect(file, `${name} ${route}`).not.toBeNull();
    return { route, file: file as string };
  });
  // 写像で得たディレクトリの本数は route の本数と同じ(重ならない)。動的の本数も保たれる。
  expect(new Set(placed.map(({ file }) => file)).size, name).toBe(routes.length);
  expect(placed.filter(({ file }) => file.includes('[')).length, name).toBe(routes.filter(isDynamic).length);
  for (const { route, file } of placed) {
    expect(file.includes(':'), `${name} ${route}: 置き場に仕様の記法 : が残らない`).toBe(false);
    expect(layoutClassify(NEXTJS_LAYOUT, 'app', file), `${name} ${route}`).toEqual([{ role: 'screen-shell', key: route }]);
  }
}
