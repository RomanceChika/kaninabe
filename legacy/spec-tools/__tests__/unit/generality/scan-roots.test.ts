/**
 * 語彙漏れの走査の範囲(`vocabularyScanRoots`)が、置き場の配置が宣言する層と土台の表から決まることのテスト。
 *
 * 走査の範囲に層の綴り(`components` ほか)を直書きしていた(部品化 ③-c5 の前)ので、別の配置を選んでも Next.js の綴りを走査する形だった。
 * いまは、仕組みの置き場(検証器・生成器・実行時パッケージ・約束事のモデル)は配置に依らず、実装の木の中の走査範囲だけが配置に従う。
 */

import { describe, expect, it } from 'vitest';
import { vocabularyScanRoots } from '../../../lib/generality/scan.js';
import { EMPTY_LAYOUT } from '../../../lib/model/product/layout.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/** 実装の木の中(製品の根の下)の走査の根だけ。 */
function insideApp(layout: typeof TEST_LAYOUT, roots = TEST_ROOTS): readonly (readonly [string, readonly string[]])[] {
  const app = roots.app ?? '';
  return vocabularyScanRoots(roots, layout)
    .filter((root) => root.dir.startsWith(`${app}/`))
    .map((root) => [root.dir, root.extensions] as const);
}

describe('vocabularyScanRoots: 実装の木の中の走査範囲は、配置の層と土台の表から決まる', () => {
  it('Next.js の配置: 共有の部品の層ぜんたい(.ts / .tsx)と、手書きで仕組みの側にある土台(ジョブ基盤・接続層)', () => {
    expect(insideApp(TEST_LAYOUT)).toEqual([
      ['app/src/components', ['.ts', '.tsx']],
      ['app/src/operation/jobs', ['.ts']],
      ['app/src/infrastructure/supabase', ['.ts']],
    ]);
  });

  it('別の配置(架空の値): 架空のソースの根と、架空の層・土台に従う(Next.js の綴りを走査しない)', () => {
    expect(insideApp(FOREIGN_LAYOUT)).toEqual([
      ['app/server_code/ui', ['.ts']],
      ['app/server_code/operation/common', ['.ts']],
      ['app/server_code/infrastructure/connectors', ['.ts']],
    ]);
  });

  it('仕組みの置き場(検証器・生成器・実行時パッケージ・約束事のモデル)は配置に依らず同じ', () => {
    const outside = (layout: typeof TEST_LAYOUT) => vocabularyScanRoots(TEST_ROOTS, layout).filter((root) => !root.dir.startsWith('app/'));

    expect(outside(FOREIGN_LAYOUT)).toEqual(outside(TEST_LAYOUT));
    expect(outside(TEST_LAYOUT).length).toBeGreaterThan(0);
  });

  it('接続の方式ごとの adapter(framework/adapters)も仕組みの置き場として根に入る(runtime の外へ出ても走査から落ちない)', () => {
    const roots = vocabularyScanRoots(TEST_ROOTS, TEST_LAYOUT);

    expect(roots.map((root) => root.dir)).toEqual(expect.arrayContaining(['framework/runtime', 'framework/adapters']));
    expect(roots.find((root) => root.dir === 'framework/adapters')?.extensions).toEqual(expect.arrayContaining(['.ts', '.mts']));
  });

  it('実装の木を持たない製品・配置が表を持たない(空の配置)と、実装の木の中の走査範囲は 0 本', () => {
    expect(insideApp(TEST_LAYOUT, { ...TEST_ROOTS, app: null })).toEqual([]);
    expect(insideApp(EMPTY_LAYOUT)).toEqual([]);
  });
});
