import path from 'node:path';
import { TEST_LAYOUT, TEST_PLATFORM } from '../../helpers/platform.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSpecModel } from '../../../lib/model/loader.js';
import { loadProductRoots } from '../../../lib/model/product/loader.js';
import { specPath } from '../../../lib/model/product/paths.js';
import { BOOK_GENERATORS } from '../../../lib/compose/book-generators.js';
import { completeGenerateContext } from '../../../lib/generate/generate-context.js';
import { readGenerateInputs } from '../../../lib/generate/generate-inputs.js';
import { testGenerators } from '../../helpers/generators.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../../lib/gen-kit/generator.js';
import type { SpecModel } from '../../../lib/model/types.js';
import type { ProductRoots } from '../../../lib/model/product/types.js';

/**
 * **ハンドブックだけを出す入口の生成器の一覧(`BOOK_GENERATORS`)が、全部入りの並び(`allGenerators`)の
 * ハンドブックの部分と同じ出力を出す**ことを確かめる(設計メモ framework-modules §11 の部分利用)。
 *
 * 入口が「別の本」を出さない根拠は 2 つ:
 *   1. 一覧の正は 1 本で、全部入りの並びは同じ位置に展開している(宣言順 = 出力順が変わらない)
 *   2. **同じ文脈なら、ハンドブックの根の下のファイルは両方の並びで 1 バイトも違わない**(章が他の生成器の出力を
 *      読む形は無い。生成器は文脈を受け取るだけで互いの結果を渡し合わない)。かつ一覧はハンドブックの根の外へ書かない
 *
 * 文脈は検証を回さない形(`findings` なし)・変異なしで組む —— 入口が実際に作る文脈と同じである。
 */

const SAMPLE = path.join(import.meta.dirname, '../../fixtures/samples/library');

/** 全部入りの生成器の一覧(コアの生成器 + 本番と同じ後段が登録する生成器)。 */
const ALL = testGenerators();

let roots: ProductRoots;
let model: SpecModel;
let ctx: GenerateContext;

beforeAll(() => {
  const loaded = loadProductRoots(SAMPLE).model.roots;
  if (loaded === null) throw new Error('題材の product.md を読めません');
  roots = loaded;
  const domain = loadSpecModel(path.join(SAMPLE, specPath(roots, 'domain'))).model;
  if (domain === null) throw new Error('題材のドメイン仕様を読めません');
  model = domain;
  ctx = completeGenerateContext(SAMPLE, roots, TEST_PLATFORM, TEST_LAYOUT, model, readGenerateInputs(SAMPLE, roots, TEST_LAYOUT), null, null);
});

/** 生成器の並びを回して、出力先のファイルごとのセクションにする。 */
function sectionsOf(generators: readonly DocGenerator[]): ReadonlyMap<string, readonly GeneratedSection[]> {
  const byFile = new Map<string, GeneratedSection[]>();
  for (const generator of generators) {
    for (const section of generator.generate(model, ctx)) byFile.set(section.file, [...(byFile.get(section.file) ?? []), section]);
  }
  return byFile;
}

/** ハンドブックの根の下か(`roots.book` が根の宣言)。 */
function underBook(file: string): boolean {
  return file === roots.book || file.startsWith(`${roots.book}/`);
}

describe('BOOK_GENERATORS: ハンドブックだけを出す一覧', () => {
  it('全部入りの並びが同じ位置・同じ順序で展開している(出力の順序は変わらない)', () => {
    const start = ALL.indexOf(BOOK_GENERATORS[0] as DocGenerator);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(ALL.slice(start, start + BOOK_GENERATORS.length)).toEqual([...BOOK_GENERATORS]);
    expect(new Set(BOOK_GENERATORS.map((generator) => generator.id)).size, '生成器の ID は重ならない').toBe(BOOK_GENERATORS.length);
  });

  it('book- で始まる生成器は全部この一覧にある(一覧から漏れた章が入口だけ出ない、を作らない)', () => {
    const named = ALL.filter((generator) => generator.id.startsWith('book-'));
    expect(named.map((generator) => generator.id).sort()).toEqual(['book-assets', 'book-html', 'book-html-examples', 'book-results-data']);
    expect(named.filter((generator) => !BOOK_GENERATORS.includes(generator)).map((generator) => generator.id)).toEqual([]);
    expect(BOOK_GENERATORS.filter((generator) => !generator.id.startsWith('book-')).map((generator) => generator.id)).toEqual([]);
  });

  it('一覧はハンドブックの根の下にしか書かない(migration・実装の部品・テストを 1 本も書かない)', () => {
    const files = [...sectionsOf(BOOK_GENERATORS).keys()];
    expect(files.length, '空の題材でない').toBeGreaterThan(10);
    expect(files.filter((file) => !underBook(file))).toEqual([]);
  });

  it('同じ文脈なら、ハンドブックの根の下のファイルは全部入りの並びと 1 バイトも違わない(ファイルの集合も同じ)', () => {
    const only = sectionsOf(BOOK_GENERATORS);
    const all = sectionsOf(ALL);
    const allBook = new Map([...all].filter(([file]) => underBook(file)));
    expect([...only.keys()].sort()).toEqual([...allBook.keys()].sort());
    for (const [file, sections] of allBook) expect(only.get(file), file).toEqual(sections);
    expect([...all.keys()].filter((file) => !underBook(file)).length, '全部入りは根の外にも書く(比べる意味がある)').toBeGreaterThan(50);
  });
});

describe('completeGenerateContext: 検証を回さない入口は findings を載せない', () => {
  it('null なら `findings` の欄ごと無い(章は「未集計」と言う)。空配列は「警告 0 件」で別の状態', () => {
    expect('findings' in ctx).toBe(false);
    const empty = completeGenerateContext(SAMPLE, roots, TEST_PLATFORM, TEST_LAYOUT, model, readGenerateInputs(SAMPLE, roots, TEST_LAYOUT), [], null);
    expect(empty.findings).toEqual([]);
  });

  it('変異の口が null(この入口は変異を回さない)の文脈は not_run を載せる(回せなかった unavailable とも、欄が無いこととも別)', () => {
    expect(ctx.mutation).toEqual({ state: 'not_run' });
  });

  it('口が実測を返せば ran、材料が無いと返せば理由つきの unavailable がそのまま載る(口は実測の欄を除いた文脈で 1 度だけ回る)', () => {
    const inputs = readGenerateInputs(SAMPLE, roots, TEST_LAYOUT);
    const seen: GenerateContext[] = [];
    const unavailable = completeGenerateContext(SAMPLE, roots, TEST_PLATFORM, TEST_LAYOUT, model, inputs, null, (_model, base) => {
      seen.push(base);
      return { state: 'unavailable', reason: '材料が無い' };
    });
    expect(unavailable.mutation).toEqual({ state: 'unavailable', reason: '材料が無い' });
    expect(seen).toHaveLength(1);
    expect(seen[0] && 'mutation' in seen[0]).toBe(false);

    const report = { rows: [], operators: [], detectors: [], withoutSite: [], scope: '', unmutated: [] };
    const ran = completeGenerateContext(SAMPLE, roots, TEST_PLATFORM, TEST_LAYOUT, model, inputs, null, () => ({ state: 'ran', report }));
    expect(ran.mutation).toEqual({ state: 'ran', report });
  });
});
