/**
 * 製品が宣言する実装の範囲(`product.md` の `implemented`)の読み方。
 *
 * 見たいのは 4 つ。
 *   ① キーが無ければ「宣言なし」(`declared: false`)で、指摘も出ない(既存の製品は何も変わらない)
 *   ② `implemented: []` は「何も範囲に入れない」という正当な宣言で、無いのとは別
 *   ③ 値が壊れていれば P0 が落とし、範囲は「全部」として扱う(`declared: false`)。**壊れた宣言が「何も入れない」や
 *      「一部だけ」に化けて、検査を黙って外さない**(根と `uses` は読めたまま、全部の検査が走る)
 *   ④ 書ける値は仕様の id の文字列だけ(種類も wildcard も無い)。空・空白・制御文字・重複は 1 件ずつ指す
 *
 * `TEST_ROOTS` は使わない —— 宣言そのものの読み方を試すので自分でフィクスチャを組む。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadProductRoots } from '../../../lib/model/product/loader.js';
import { PRODUCT_DECL_FILE } from '../../../lib/io/paths.js';

/** 作った一時ツリー(後片付けのため)。 */
const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 必須の 4 根。 */
const ROOTS = ['  specs: spec', '  book: read', '  generated: impl/src/generated', '  migrations: db/migrations'];

/**
 * 宣言を 1 枚だけ持つ一時ツリーを作る。
 *
 * @param implementedYaml `implemented` の行(`null` なら**書かない**)
 */
function repoWith(implementedYaml: readonly string[] | null): string {
  const root = mkdtempSync(path.join(tmpdir(), 'product-implemented-'));
  created.push(root);
  writeFileSync(
    path.join(root, PRODUCT_DECL_FILE),
    [
      '---',
      'doc_type: product_roots',
      'scope: common',
      'id: product-roots',
      '',
      'name: test-product',
      '',
      'roots:',
      ...ROOTS,
      'uses:',
      '  - actions',
      ...(implementedYaml ?? []),
      '---',
      '',
    ].join('\n'),
  );
  return root;
}

describe('implemented を読む', () => {
  it('キーが無ければ宣言なし(指摘なし)。根と uses はいつもどおり読める', () => {
    const loaded = loadProductRoots(repoWith(null));

    expect(loaded.implemented).toEqual({ declared: false });
    expect(loaded.findings).toEqual([]);
    expect(loaded.uses).toEqual(['actions']);
    expect(loaded.model.roots).not.toBeNull();
  });

  it('`implemented: []` は「何も入れない」という正当な宣言で、宣言なしとは別物である', () => {
    const loaded = loadProductRoots(repoWith(['implemented: []']));

    expect(loaded.implemented).toEqual({ declared: true, ids: [] });
    expect(loaded.findings).toEqual([]);
    expect(loaded.model.roots).not.toBeNull();
  });

  it('id は宣言順のまま読める', () => {
    const loaded = loadProductRoots(repoWith(['implemented:', '  - room-create-action', '  - screen-room-list']));

    expect(loaded.findings).toEqual([]);
    expect(loaded.implemented).toEqual({ declared: true, ids: ['room-create-action', 'screen-room-list'] });
  });

  it.each([
    ['値が無い(YAML の null)', ['implemented:'], 'implemented'],
    ['リストでない(文字列)', ['implemented: room-create-action'], 'implemented'],
    ['リストでない(マッピング)', ['implemented:', '  room-create-action: true'], 'implemented'],
    ['文字列でない要素(数)', ['implemented:', '  - room-create-action', '  - 1'], 'implemented[1]'],
    ['文字列でない要素(null)', ['implemented:', '  - null'], 'implemented[0]'],
    ['空の要素', ['implemented:', '  - ""'], 'implemented[0]'],
    ['空白だけの要素', ['implemented:', '  - "   "'], 'implemented[0]'],
    ['途中に空白がある要素', ['implemented:', '  - "room create"'], 'implemented[0]'],
    ['前後に空白がある要素', ['implemented:', '  - " room-create-action"'], 'implemented[0]'],
    ['全角の空白(U+3000)を含む要素', ['implemented:', '  - "room\\u3000create"'], 'implemented[0]'],
    ['改行なしの空白(U+00A0)を含む要素', ['implemented:', '  - "room\\u00A0create"'], 'implemented[0]'],
    ['先頭が全角の空白の要素', ['implemented:', '  - "\\u3000room-create-action"'], 'implemented[0]'],
    ['制御文字(タブ)を含む要素', ['implemented:', '  - "room\\tcreate"'], 'implemented[0]'],
    ['制御文字(改行)を含む要素', ['implemented:', '  - "room\\ncreate"'], 'implemented[0]'],
    ['重複', ['implemented:', '  - room-create-action', '  - room-create-action'], 'implemented[1]'],
  ])('%sは P0 が指し、範囲は「全部」として扱う(根と uses は読めたまま)', (_label, yaml, pointer) => {
    const loaded = loadProductRoots(repoWith(yaml));

    expect(loaded.findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['P0', 'error']]);
    expect(loaded.findings[0]?.message).toContain(pointer);
    expect(loaded.findings[0]?.location.file).toBe(PRODUCT_DECL_FILE);
    // 壊れた宣言を「何も入れない」や「一部だけ」と読むと、検査が黙って外れる。読めなければ全部の検査を走らせる。
    expect(loaded.implemented).toEqual({ declared: false });
    expect(loaded.uses).toEqual(['actions']);
    expect(loaded.model.roots).not.toBeNull();
  });

  it('壊れた要素が 2 つあれば 1 件ずつ指す(最初の 1 件で打ち切らない)', () => {
    const loaded = loadProductRoots(repoWith(['implemented:', '  - ""', '  - a', '  - a']));

    expect(loaded.findings.map((finding) => finding.message.includes('implemented[0]') || finding.message.includes('implemented[2]'))).toEqual([true, true]);
    expect(loaded.implemented).toEqual({ declared: false });
  });

  it('宣言が読めない(uses が無い)ときは、implemented も宣言なしで返る(根ごと読めない既存の扱いのまま)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'product-implemented-'));
    created.push(root);
    writeFileSync(
      path.join(root, PRODUCT_DECL_FILE),
      ['---', 'doc_type: product_roots', 'scope: common', 'id: product-roots', 'name: test-product', 'roots:', ...ROOTS, 'implemented: []', '---', ''].join('\n'),
    );

    const loaded = loadProductRoots(root);

    expect(loaded.uses).toBeNull();
    expect(loaded.model.roots).toBeNull();
    expect(loaded.implemented).toEqual({ declared: false });
  });
});
