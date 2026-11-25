/**
 * 仕様の生テキストの母集合(`readSpecSources`)の、**読まない置き場**(`excludedPlaces`)を見る。
 *
 * ハンドブックだけを出す入口は、製品が採っていない種類の置き場を渡す(置き場に有効な仕様が残っていても、標識の集計の材料に
 * 混ぜない)。全部入りの `generate` は渡さないので、母集合は従来のまま(台帳に載るファイルも、仕様の木の Markdown も全部)。
 */

import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSpecModel } from '../../../lib/model/loader.js';
import { loadProductRoots } from '../../../lib/model/product/loader.js';
import { specPath } from '../../../lib/model/product/paths.js';
import type { ProductRoots } from '../../../lib/model/product/types.js';
import type { SpecModel } from '../../../lib/model/types.js';
import { readGenerateInputs } from '../../../lib/generate/generate-inputs.js';
import type { GenerateContext } from '../../../lib/gen-kit/generator.js';
import { isUnderPlace, readSpecSources } from '../../../lib/generate/spec-sources.js';
import { TEST_LAYOUT, TEST_PLATFORM } from '../../helpers/platform.js';

const SAMPLE = path.join(import.meta.dirname, '../../fixtures/samples/library');

let roots: ProductRoots;
let model: SpecModel;
let base: GenerateContext;

beforeAll(() => {
  const loaded = loadProductRoots(SAMPLE).model.roots;
  if (loaded === null) throw new Error('題材の product.md を読めません');
  roots = loaded;
  const domain = loadSpecModel(path.join(SAMPLE, specPath(roots, 'domain'))).model;
  if (domain === null) throw new Error('題材のドメイン仕様を読めません');
  model = domain;
  base = { ...readGenerateInputs(SAMPLE, roots, TEST_LAYOUT), platform: TEST_PLATFORM, layout: TEST_LAYOUT };
});

describe('isUnderPlace: 置き場(ファイルまたはディレクトリ)の下か', () => {
  it('置き場そのもの・ディレクトリの下は真。名前が前方一致するだけの別のファイルは偽', () => {
    expect(isUnderPlace('a/jobs.md', ['a/jobs.md'])).toBe(true);
    expect(isUnderPlace('a/queries/x/y.md', ['a/queries'])).toBe(true);
    expect(isUnderPlace('a/jobs.md.bak', ['a/jobs.md'])).toBe(false);
    expect(isUnderPlace('a/queries-extra/y.md', ['a/queries'])).toBe(false);
    expect(isUnderPlace('a/jobs.md', [])).toBe(false);
  });
});

describe('readSpecSources: 読まない置き場', () => {
  it('渡さなければ全部読む(全部入りの generate と同じ母集合)', () => {
    const all = readSpecSources(SAMPLE, roots, model, base);
    expect([...all.keys()]).toContain(specPath(roots, 'backend/jobs.md'));
    expect([...readSpecSources(SAMPLE, roots, model, base, [])]).toEqual([...all]);
  });

  it('置き場の下は読まない(台帳に載るファイルも・仕様の木の Markdown も)。ほかは同じ', () => {
    const all = readSpecSources(SAMPLE, roots, model, base);
    const jobs = specPath(roots, 'backend/jobs.md');
    const queries = specPath(roots, 'backend/queries');
    const cut = readSpecSources(SAMPLE, roots, model, base, [jobs, queries]);
    expect([...cut.keys()]).not.toContain(jobs);
    expect([...cut.keys()].filter((file) => file.startsWith(`${queries}/`))).toEqual([]);
    expect([...cut.keys()]).toEqual([...all.keys()].filter((file) => file !== jobs && !file.startsWith(`${queries}/`)));
  });
});
