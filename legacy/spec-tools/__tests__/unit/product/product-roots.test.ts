/**
 * 製品の根の宣言(`product.md`)の読み方と、P 群の検査のテスト。
 *
 * 見たいのは 3 つ。
 *   ① 宣言が閉じている(知らないキー・絶対パス・`..` を受けない)
 *   ② 省略できる根を省略したら `null` になり、それが「持たない製品」を意味する
 *   ③ P1 は**仕様の木の不在だけ**をエラーにし、生成前の空っぽを警告に化けさせない
 *
 * `TEST_ROOTS` は使わない —— この 1 本は宣言そのものの読み方を試すので、自分でフィクスチャを組む
 * (helpers/product-roots.ts の doc コメントが名指した唯一の例外)。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadProductRoots } from '../../../lib/model/product/loader.js';
import { verifyDeclaredRoots } from '../../../lib/product/verifiers/p1-declared-roots.js';
import { detectRepoRoot, PRODUCT_DECL_FILE } from '../../../lib/io/paths.js';
import { joinPath, specPath, stackConfigPath } from '../../../lib/model/product/paths.js';
import { NO_TERM_SCAN } from '../../../lib/model/product/types.js';

/** 作った一時ツリー(後片付けのため)。 */
const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 製品の名前(根ではない・必須)。 */
const NAME_LINE = 'name: test-product';

/**
 * 宣言を 1 枚だけ持つ一時ツリーを作る。
 *
 * @param rootsYaml `roots:` の下に並べる行
 * @param nameYaml 製品の名前の行(省略すると既定・`null` を渡すと**書かない**)
 * @param usesYaml `uses` の行(省略すると `uses: []`・`null` を渡すと**書かない**。採用の宣言の読み方は product-uses.test.ts が見る)
 * @returns 一時ツリーの絶対パス
 */
function repoWith(
  rootsYaml: readonly string[],
  nameYaml: string | null = NAME_LINE,
  usesYaml: readonly string[] | null = ['uses: []'],
): string {
  const root = mkdtempSync(path.join(tmpdir(), 'product-roots-'));
  created.push(root);
  writeFileSync(
    path.join(root, PRODUCT_DECL_FILE),
    [
      '---',
      'doc_type: product_roots',
      'scope: common',
      'id: product-roots',
      '',
      ...(nameYaml === null ? [] : [nameYaml, '']),
      'roots:',
      ...rootsYaml,
      ...(usesYaml ?? []),
      '---',
      '',
    ].join('\n'),
  );
  return root;
}

/** どの製品にも要る 4 根。 */
const REQUIRED = [
  '  specs: spec',
  '  book: read',
  '  generated: impl/src/generated',
  '  migrations: db/migrations',
];

describe('製品の根の宣言を読む', () => {
  it('必須の 4 根と製品の名前を書いた宣言は読めて、省略した 3 根は null になる', () => {
    const roots = loadProductRoots(repoWith(REQUIRED)).model.roots;

    expect(roots).toEqual({
      name: 'test-product',
      specs: 'spec',
      book: 'read',
      generated: 'impl/src/generated',
      migrations: 'db/migrations',
      app: null,
      knowledge: null,
      previews: null,
      // `term_scan` を書かない製品は、追加の走査範囲が空(開発用リポジトリの置き場を仕組みが知らないための口)。
      termScan: NO_TERM_SCAN,
    });
  });

  it('term_scan を書けば、追加の走査範囲として読める(欄ごとに省略できる)', () => {
    const lines = ['uses: []', 'term_scan:', '  prose_trees:', '    - memo', '  history:', '    - log.md', '    - journal/'];

    const result = loadProductRoots(repoWith(REQUIRED, NAME_LINE, lines));

    expect(result.findings).toEqual([]);
    expect(result.model.roots?.termScan).toEqual({ proseTrees: ['memo'], proseFiles: [], scriptTrees: [], history: ['log.md', 'journal/'] });
  });

  it.each([
    ['絶対パス', ['  prose_trees:', '    - /etc/memo'], 'term_scan.prose_trees[0]'],
    ['".." を含む', ['  prose_files:', '    - ../guide.md'], 'term_scan.prose_files[0]'],
    ['末尾がスラッシュ(history 以外では木ごと外す印にならない)', ['  script_trees:', '    - hooks/'], 'term_scan.script_trees[0]'],
    ['空', ['  history:', '    - ""'], 'term_scan.history[0]'],
    ['知らない欄', ['  prose_trees: []', '  design: memo'], 'term_scan.design'],
  ])('term_scan の値が%sなら P0 がエラーにし、その要素は範囲に入らない', (_label, body, pointer) => {
    const result = loadProductRoots(repoWith(REQUIRED, NAME_LINE, ['uses: []', 'term_scan:', ...body]));

    expect(result.findings.map((finding) => [finding.verifier, finding.location.pointer])).toEqual([['P0', pointer]]);
    expect(result.model.roots?.termScan).toEqual(NO_TERM_SCAN);
  });

  it('term_scan がマッピングでなければ P0 がエラーにし、範囲は空になる', () => {
    const result = loadProductRoots(repoWith(REQUIRED, NAME_LINE, ['uses: []', 'term_scan: memo']));

    expect(result.findings.map((finding) => [finding.verifier, finding.location.pointer])).toEqual([['P0', 'term_scan']]);
    expect(result.model.roots?.termScan).toEqual(NO_TERM_SCAN);
  });

  it('宣言ファイルが無ければ available: false(ローダーは文言を持たない)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'product-roots-none-'));
    created.push(root);

    const result = loadProductRoots(root);

    expect(result.model).toEqual({ available: false, roots: null });
    expect(result.uses).toBeNull();
    expect(result.findings).toEqual([]);
  });

  it('製品の名前が無ければ P0 がエラーにする(W1 の語彙に製品名が入らないまま黙るのを防ぐ)', () => {
    // 束 ①-c-c のレビューの実測: `name:` を消すと、仕組み側コードに書いた製品名が
    // **W1 も W2 も落とさず完全に無音**になった。宣言を新設したら番人も置く。
    const result = loadProductRoots(repoWith(REQUIRED, null));

    expect(result.findings.map((finding) => finding.verifier)).toEqual(['P0']);
    expect(result.findings[0]?.message).toContain('name');
  });

  it('知らないキーは P0 がエラーにする(書いたのに効いていない状態を作らない)', () => {
    const result = loadProductRoots(repoWith([...REQUIRED, '  handwritten: impl/src/operation']));

    expect(result.findings.map((finding) => finding.verifier)).toEqual(['P0']);
    expect(result.findings[0]?.message).toContain('handwritten');
  });

  it.each([
    ['絶対パス', '  specs: /etc/spec'],
    ['".." を含む', '  specs: ../spec'],
    ['末尾がスラッシュ', '  specs: spec/'],
    ['ドライブ文字で始まる', '  specs: C:/spec'],
    ['バックスラッシュを含む(書き先の綴りが曖昧になる)', '  specs: "docs\\\\spec"'],
    ['"." の要素を含む', '  specs: ./spec'],
    ['空の要素を含む', '  specs: spec//domain'],
    ['.git の要素を含む(フックを書き換える口)', '  specs: .git/hooks'],
    ['.github の要素を含む(CI を書き換える口)', '  specs: site/.github/specs'],
    ['"." で始まる要素を含む(.env など)', '  specs: site/.hidden/specs'],
    ['node_modules の要素を含む', '  specs: site/node_modules/specs'],
    ['仕組みの木(framework)の下', `  specs: ${['framework', 'specs'].join('/')}`],
    ['道具の木(tools)の下', `  specs: ${['tools', 'specs'].join('/')}`],
    ['空白を含む要素', '  specs: "site/my specs"'],
  ])('根の値が%sなら P0 がエラーにし、必須が欠けるので読めない', (_label, line) => {
    const result = loadProductRoots(repoWith([line, ...REQUIRED.slice(1)]));

    expect(result.model.roots).toBeNull();
    expect(result.findings.map((finding) => finding.verifier)).toContain('P0');
  });

  it('roots ごと無ければ読めない', () => {
    expect(loadProductRoots(repoWith([])).model.roots).toBeNull();
  });
});

describe('detectRepoRoot は宣言を上へ探す', () => {
  it('宣言を持つ木の中から呼べば、その木の根で止まる', () => {
    const root = repoWith(REQUIRED);
    const deep = path.join(root, 'spec', 'domain', 'workshop');
    mkdirSync(deep, { recursive: true });

    expect(detectRepoRoot(deep)).toBe(root);
  });
});

describe('P1 宣言した根の実在', () => {
  it('宣言が無ければエラーで報告する(黙って違う根で実行しない)', () => {
    const findings = verifyDeclaredRoots({
      repoRoot: '/nowhere',
      product: { available: false, roots: null },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain(PRODUCT_DECL_FILE);
  });

  it('宣言が読めなかった場合は何も言わない(文言は P0 が持つ)', () => {
    expect(verifyDeclaredRoots({ repoRoot: '/nowhere', product: { available: true, roots: null } })).toEqual([]);
  });

  it('仕様の木が無ければエラー(正の在り処が違うと以降が空振りする)', () => {
    const root = repoWith(REQUIRED);

    const findings = verifyDeclaredRoots({ repoRoot: root, product: loadProductRoots(root).model });

    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['P1', 'error']]);
    expect(findings[0]?.location.pointer).toBe('roots.specs');
  });

  it('仕様の木があれば、生成物・migration・読み物が無くても何も言わない', () => {
    const root = repoWith(REQUIRED);
    mkdirSync(path.join(root, 'spec'), { recursive: true });

    expect(verifyDeclaredRoots({ repoRoot: root, product: loadProductRoots(root).model })).toEqual([]);
  });
});

describe('宣言からパスを組み立てる', () => {
  it('仕様の木の中の位置は宣言された根の下に出る', () => {
    const roots = loadProductRoots(repoWith(REQUIRED)).model.roots;
    if (roots === null) throw new Error('宣言を読めませんでした');

    expect(specPath(roots, 'backend/config.md')).toBe('spec/backend/config.md');
    expect(joinPath('impl/src', 'operation', 'entry.ts')).toBe('impl/src/operation/entry.ts');
    // ローカルスタックの設定は migration の置き場の隣(製品が置き場を動かせば一緒に動く)。
    expect(stackConfigPath(roots)).toBe('db/config.toml');
  });
});
