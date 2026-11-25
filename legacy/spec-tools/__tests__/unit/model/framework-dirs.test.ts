/**
 * 層の 4 名(framework-dirs.ts。コアの語)の規約網羅テスト。
 *
 * 層の直下の土台(集約でないディレクトリ)の表は、置き場の配置の `source-root` が宣言する(部品化 ③-c5)。配置から引く口のテストは `framework-base-dirs.test.ts`、
 * 表そのものの整合の検査は `product/layout-structure.test.ts`。ここが見るのは、配置に依らずコアが持つ 4 名の整合である。
 */

import { describe, expect, it } from 'vitest';
import { CORE_LAYERS } from '../../../lib/model/framework-dirs.js';

describe('層の 4 名(コアの語)', () => {
  it('domain / operation / infrastructure / composition の 4 つが、この順で並ぶ', () => {
    expect(CORE_LAYERS.map((layer) => layer.name)).toEqual(['domain', 'operation', 'infrastructure', 'composition']);
  });

  it('名前が重複せず、説明(role)が空でない', () => {
    const names = CORE_LAYERS.map((layer) => layer.name);
    expect(new Set(names).size).toBe(names.length);
    for (const layer of CORE_LAYERS) expect(layer.role.trim()).not.toBe('');
  });

  it('閉世界の見張り役は 3 値のいずれかである', () => {
    for (const layer of CORE_LAYERS) {
      expect(['structure_test', 'verifier', 'none']).toContain(layer.closedWorld);
    }
  });

  it('スタックの層(ルーティング・UI 部品)をコアは持たない —— 配置が足す', () => {
    const names = CORE_LAYERS.map((layer) => layer.name);
    expect(names).not.toContain('app');
    expect(names).not.toContain('components');
  });
});
