/**
 * 画面の器の往復(部品化 ③-d3): 6 つの題材で宣言された route について、
 * `resolve(route) → classify(path) → route` が同一になること(動的セグメントの `:id` ⇔ ディレクトリ `[id]` を含む)。
 *
 * 順写像だけを直して逆引きが取り残されると、実装の木を走査した route が仕様と食い違う(S7 が全部「実ルートが無い」になる)。
 * その形を固定する。題材ごとの「route の本数 / 動的の本数 / 写像で得たディレクトリの本数」も数える。
 * 製品の実物の分は `dev-repo/unit/targets/nextjs/screen-shell-roundtrip.test.ts`(製品を持たない配布の木では回さない)。
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutClassify } from '../../../../lib/model/product/layout-classify.js';
import { NEXTJS_LAYOUT } from '../../../../lib/targets/nextjs/layout.js';
import { expectRoundtrip, isDynamic, routesIn } from '../../../helpers/screen-routes.js';

const SAMPLES = path.resolve(import.meta.dirname, '../../../fixtures/samples');

/** 題材の名前 → 画面仕様のディレクトリ。 */
function subjects(): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const name of readdirSync(SAMPLES).sort()) {
    const dir = path.join(SAMPLES, name, 'docs/specs/frontend/screens');
    if (existsSync(dir)) map.set(name, dir); // 画面を持たない題材(dual_actors)は対象外
  }
  return map;
}

describe('画面の器の往復: 全題材の宣言された route', () => {
  const all = [...subjects()].map(([name, dir]) => ({ name, routes: routesIn(dir) }));

  it('どの題材も画面を持つ。動的な route は 6 題材で固定(archive 1・expenses 1・library 1・rooms 2・stores 2)', () => {
    const counts = Object.fromEntries(all.map(({ name, routes }) => [name, routes.filter(isDynamic).length]));
    expect(counts).toEqual({ archive: 1, expenses: 1, library: 1, rooms: 2, stores: 2 });
    for (const { name, routes } of all) expect(routes.length, name).toBeGreaterThan(0);
  });

  it('宣言された route は、置き場 → 逆引きで同じ route に戻る(往復)。置き場のディレクトリは動的セグメントだけ [x] になる', () => {
    for (const { name, routes } of all) expectRoundtrip(name, routes);
  });

  it('ルートグループ (g) は往復で route に現れない(今のまま)', () => {
    const grouped = layoutClassify(NEXTJS_LAYOUT, 'app', 'app/src/app/(marketing)/pages/[slug]/page.tsx');
    expect(grouped).toEqual([{ role: 'screen-shell', key: '/pages/:slug' }]);
  });
});
