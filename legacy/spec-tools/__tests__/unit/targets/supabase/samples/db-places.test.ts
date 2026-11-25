/**
 * 通し実行の一時ツリーの、置き場の配置が決める位置(`db-places.ts`。部品化 ③-c6 で `src/infrastructure/…` の直書きから移した)のテスト。
 *
 * 固定するのは 3 点 —— ①実物の配置では、直書きしていたときと同じパス ②別の配置(架空の値)ではその値に従い、Next.js の綴りが残らない
 * ③決められないときは既定値に倒さず止める(一時ツリーの外を指さない)。
 */

import { describe, expect, it } from 'vitest';
import { EMPTY_LAYOUT } from '../../../../../lib/model/product/layout.js';
import { sampleBaseDir, sampleInfrastructureTests, sampleSourceAlias, sampleSourceRoot } from '../../../../../lib/targets/supabase/samples/db-places.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

describe('実物の配置: 直書きしていたときと同じパス', () => {
  it('接続層・テスト支援・ソースの根・別名', () => {
    expect(sampleBaseDir(TEST_ROOTS, TEST_LAYOUT, { layer: 'infrastructure', dir: 'supabase' })).toBe('app/src/infrastructure/supabase');
    expect(sampleInfrastructureTests(TEST_ROOTS, TEST_LAYOUT)).toBe('app/src/infrastructure/__tests__');
    expect(sampleSourceRoot(TEST_ROOTS, TEST_LAYOUT)).toBe('app/src');
    expect(sampleSourceAlias(TEST_LAYOUT)).toBe('@');
  });
});

describe('別の配置(架空の値): その値に従う', () => {
  it('ソースの根・別名・テスト支援が架空の綴りになり、Next.js の綴りが残らない', () => {
    expect(sampleSourceRoot(TEST_ROOTS, FOREIGN_LAYOUT)).toBe('app/server_code');
    expect(sampleSourceAlias(FOREIGN_LAYOUT)).toBe('~srv');
    expect(sampleInfrastructureTests(TEST_ROOTS, FOREIGN_LAYOUT)).toBe('app/server_code/infrastructure/__tests__');
    expect(sampleBaseDir(TEST_ROOTS, FOREIGN_LAYOUT, { layer: 'infrastructure', dir: 'connectors' })).toBe('app/server_code/infrastructure/connectors');
  });
});

describe('決められないときは止める', () => {
  it('配置が宣言していない土台・空の配置・実装の木を持たない製品', () => {
    expect(() => sampleBaseDir(TEST_ROOTS, FOREIGN_LAYOUT, { layer: 'infrastructure', dir: 'supabase' })).toThrow('土台 infrastructure/supabase を宣言していない');
    expect(() => sampleInfrastructureTests(TEST_ROOTS, EMPTY_LAYOUT)).toThrow();
    expect(() => sampleSourceRoot(TEST_ROOTS, EMPTY_LAYOUT)).toThrow('source-root');
    expect(() => sampleSourceAlias(EMPTY_LAYOUT)).toThrow('module');
    expect(() => sampleSourceRoot({ ...TEST_ROOTS, app: null }, TEST_LAYOUT)).toThrow();
    expect(() => sampleInfrastructureTests({ ...TEST_ROOTS, app: null }, TEST_LAYOUT)).toThrow('app が無い');
  });
});
