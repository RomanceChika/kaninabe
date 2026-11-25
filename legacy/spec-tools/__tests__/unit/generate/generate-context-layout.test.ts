/**
 * 生成の文脈の必須の欄 `layout`(置き場の配置)のテスト。
 *
 * 配置は `GenerateContext` の型の欄で、`completeGenerateContext` が呼び側(組み立ての根)の選んだ配置をそのまま載せる
 * (グローバルな選択済みの値は無い。配置を差し替えれば差し替わる)。型の欄なので渡し忘れは型が止める。
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { completeGenerateContext } from '../../../lib/generate/generate-context.js';
import { readGenerateInputs } from '../../../lib/generate/generate-inputs.js';
import { loadSpecModel } from '../../../lib/model/loader.js';
import { loadProductRoots } from '../../../lib/model/product/loader.js';
import { specPath } from '../../../lib/model/product/paths.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT, TEST_PLATFORM } from '../../helpers/platform.js';

const SAMPLE = path.join(import.meta.dirname, '../../fixtures/samples/library');

describe('completeGenerateContext は渡された配置を文脈の必須の欄に載せる', () => {
  it('呼び側が選んだ配置がそのまま載る(配置を差し替えれば差し替わる)', () => {
    const roots = loadProductRoots(SAMPLE).model.roots;
    if (roots === null) throw new Error('題材の product.md を読めません');
    const model = loadSpecModel(path.join(SAMPLE, specPath(roots, 'domain'))).model;
    if (model === null) throw new Error('題材のドメイン仕様を読めません');
    const inputs = readGenerateInputs(SAMPLE, roots, TEST_LAYOUT);

    const withNext = completeGenerateContext(SAMPLE, roots, TEST_PLATFORM, TEST_LAYOUT, model, inputs, null, null);
    const withForeign = completeGenerateContext(SAMPLE, roots, TEST_PLATFORM, FOREIGN_LAYOUT, model, inputs, null, null);

    expect(withNext.layout).toBe(TEST_LAYOUT);
    expect(withForeign.layout).toBe(FOREIGN_LAYOUT);
  });
});
