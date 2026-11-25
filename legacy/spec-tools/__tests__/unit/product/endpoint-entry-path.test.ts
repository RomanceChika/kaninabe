/**
 * 起動口(`endpoint`)に対応する Route Handler の位置(置き場の配置の役割 `http-entry`。部品化 ③-c6 で旧い口 `endpointRoutePath` から移した)のテスト。
 *
 * 見たいのは 2 点 —— `endpoint` 先頭の `/`(URL の綴り)が二重の区切りにならないこと、実装の木を持たない製品では null。
 */

import { describe, expect, it } from 'vitest';
import { httpEntryPath } from '../../../lib/model/product/layout.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

describe('httpEntryPath(起動口)', () => {
  it('endpoint を `src/app` の下の route.ts に解く(先頭の / は落とす)', () => {
    expect(httpEntryPath(TEST_LAYOUT, TEST_ROOTS, '/api/jobs/run')).toBe('app/src/app/api/jobs/run/route.ts');
  });

  it('先頭に / が無い綴りでも同じ', () => {
    expect(httpEntryPath(TEST_LAYOUT, TEST_ROOTS, 'api/jobs/run')).toBe('app/src/app/api/jobs/run/route.ts');
  });

  it('実装の木を持たない製品では null', () => {
    expect(httpEntryPath(TEST_LAYOUT, { ...TEST_ROOTS, app: null }, '/api/jobs/run')).toBeNull();
  });
});
