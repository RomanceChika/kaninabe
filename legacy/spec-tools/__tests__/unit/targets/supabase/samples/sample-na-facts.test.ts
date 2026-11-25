/**
 * 題材の表の n/a の条件の材料(`sample-na-facts.ts` の `naFactsOf`)のユニットテスト(差分点検 D27-1)。
 *
 * - 採った種類(`product.md` の `uses`)の仕様が無い・読めないなら例外(0 件と数えて n/a の条件を黙って成り立たせない)。採っていない種類は 0 件
 * - 手書きの本文は RPC とトリガの和(`kind: trigger` で `handwritten` を宣言したものも数える。宣言の無いトリガの本文は生成物なので数えない)
 */

import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { naFactsOf } from '../../../../../lib/targets/supabase/samples/sample-na-facts.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

/** fixture の題材の置き場。 */
const SAMPLES_ROOT = fileURLToPath(new URL('../../../../fixtures/samples/', import.meta.url));
const ROOTS = TEST_ROOTS;
/** 題材の仕様の木の backend の置き場(木の根から)。 */
const BACKEND = path.join(TEST_ROOTS.specs, 'backend');

let tree = '';

/** 題材を写した木を作る。 */
function copySample(name: string): string {
  cpSync(path.join(SAMPLES_ROOT, name), tree, { recursive: true });
  return tree;
}

/** 木の中のファイルの 1 か所を置き換える(空振りは例外)。 */
function replaceIn(file: string, from: string, to: string): void {
  const text = readFileSync(path.join(tree, file), 'utf8');
  if (!text.includes(from)) throw new Error(`置き換え元が無い: ${from}`);
  writeFileSync(path.join(tree, file), text.replace(from, to));
}

beforeEach(() => {
  tree = mkdtempSync(path.join(tmpdir(), 'na-facts-'));
});

afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
});

describe('naFactsOf', () => {
  it('正例: 題材の仕様から数える(採っていない種類は 0 件。rooms は external と jobs を採らない)', () => {
    expect(naFactsOf(copySample('rooms'), ROOTS)).toEqual({ paid: 0, scheduled: 0, handwritten: 0 });
  });

  it.each([
    ['採った external の仕様が無い', 'stores', () => rmSync(path.join(tree, BACKEND, 'external.md')), /external.*missing/],
    ['採った jobs の仕様が読めない(frontmatter が壊れている)', 'stores', () => writeFileSync(path.join(tree, BACKEND, 'jobs.md'), '---\n: [\n---\n'), /jobs.*load-failed/],
    ['採った data_tables の置き場が無い', 'rooms', () => rmSync(path.join(tree, BACKEND, 'data'), { recursive: true }), /data_tables.*missing/],
    ['採る種類の宣言(product.md)が無い', 'rooms', () => renameSync(path.join(tree, 'product.md'), path.join(tree, 'product.md.bak')), /uses が無い/],
  ] as const)('負例: %s なら例外(0 件と数えない)', (_name, sample, mutate, message) => {
    copySample(sample);
    mutate();
    expect(() => naFactsOf(tree, ROOTS)).toThrow(message);
  });

  it('負例: 仕様の無い種類を採ると宣言したら例外(rooms は external を採らないので external.md が無くても 0 件だが、uses に足すと赤)', () => {
    copySample('rooms');
    replaceIn('product.md', '  - data_tables\n', '  - data_tables\n  - external\n');
    expect(() => naFactsOf(tree, ROOTS)).toThrow(/external.*missing/);
  });

  it('手書きのトリガだけを持つ題材は、手書きの本文 1 件(宣言の無いトリガは本文が生成物なので数えない)', () => {
    copySample('stores');
    expect(naFactsOf(tree, ROOTS).handwritten).toBe(0);
    replaceIn(
      path.join(BACKEND, 'data', 'tables', 'products.md'),
      '  - name: check_stock_move_product_company_on_product\n    args: []\n    kind: trigger\n',
      '  - name: check_stock_move_product_company_on_product\n    args: []\n    kind: trigger\n    handwritten:\n      migration: 20260912100009_handwritten_trigger.sql\n      reason: 掴む順の負例のために手書きにしたトリガ\n',
    );
    expect(naFactsOf(tree, ROOTS).handwritten).toBe(1);
  });
});
