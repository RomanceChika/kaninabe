/**
 * W3(仕組みは製品の根の綴りでパスを組み立てない)のテスト。
 *
 * 見たいのは 4 つ。
 *   ① **このリポジトリの仕組み側コードに 1 件も無い**(束 ①-a の受け入れそのもの。`.mjs` の道具と、
 *      道具の場所から根を探す形も含めて直した後の木が緑であること = 束 分離 ②-a)
 *   ② 根で始まるリテラルを置けば捕る(検査が飾りでない)
 *   ③ 仕組み自身の住所(`legacy/spec-tools/lib` / `formal`)と、文の途中に出てくる引用は捕らない
 *      —— 前者は製品の根ではなく、後者は散文である(W2 が `legacy/spec-tools/lib` を対象外にした線)
 *   ④ **`.mjs` の直書き**と、**CLI が道具の場所から根を探す形**(`detectRepoRoot(import.meta.dirname)` /
 *      道具の場所からの相対で宣言された根の中を指す形)を捕る。`cli/` の外と作業ディレクトリからの探し方は捕らない
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPathSpelling } from '../../../lib/generality/verifiers/w3-path-spelling.js';
import { FRAMEWORK_CLI_DIR, FRAMEWORK_LIB_DIR } from '../../../lib/generality/scan.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/** このリポジトリのルート(`legacy/spec-tools/__tests__/unit/generality` から 5 段上)。 */
const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../..');

const created: string[] = [];
afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 仕組みのソース 1 本だけを持つ一時ツリーを作る(既定は検証器・生成器の置き場)。 */
function frameworkWith(source: string, where: string = FRAMEWORK_LIB_DIR, fileName = 'probe.ts'): string {
  const root = mkdtempSync(path.join(tmpdir(), 'w3-'));
  created.push(root);
  const dir = path.join(root, where, 'probe');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, fileName), source);
  return root;
}

/** CLI の置き場から宣言された仕様の木の中を指す相対リテラル(段数を決め打ちしない)。 */
const SPECS_FROM_CLI = `${path.posix.relative(FRAMEWORK_CLI_DIR, TEST_ROOTS.specs)}/domain`;

describe('W3 仕組みは製品の根の綴りでパスを組み立てない', () => {
  it('このリポジトリの仕組み側コードには 1 件も無い', () => {
    expect(verifyPathSpelling({ repoRoot: REPO_ROOT, roots: TEST_ROOTS })).toEqual([]);
  });

  it('根で始まるリテラルは捕る(どの根の綴りかを反例に出す)', () => {
    const root = frameworkWith(`export const OUT = '${TEST_ROOTS.specs}/backend/config.md';\n`);

    const findings = verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.counterexample?.['root']).toBe('specs');
  });

  it('入れ子の根は具体的なほうを示す(生成物の置き場は実装の木の中にある)', () => {
    const root = frameworkWith(`export const OUT = '${TEST_ROOTS.generated}/roles.ts';\n`);

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })[0]?.counterexample?.['root']).toBe(
      'generated',
    );
  });

  it('仕組み自身の住所は捕らない(製品の根ではない)', () => {
    const root = frameworkWith(`export const SELF = '${FRAMEWORK_LIB_DIR}/model/framework-dirs.ts';\n`);

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })).toEqual([]);
  });

  it('文の途中に出てくる引用は捕らない(散文であってパスの組み立てではない)', () => {
    const root = frameworkWith(`export const NOTE = '実装(\`${TEST_ROOTS.specs}/backend/config.md\`)を読む';\n`);

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })).toEqual([]);
  });

  it('コメントは捕らない(体系が自分を説明する文。W2 と同じ線)', () => {
    const root = frameworkWith(`// ${TEST_ROOTS.specs}/backend/config.md を読む\nexport const X = 1;\n`);

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })).toEqual([]);
  });

  it('CLI の置き場も見る(宣言を読む入口に綴りが 1 本残る形を捕る)', () => {
    const root = frameworkWith(
      `export const D = path.join(REPO_ROOT, '${TEST_ROOTS.migrations}');\n`,
      FRAMEWORK_CLI_DIR,
    );

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })).toHaveLength(1);
  });

  it('1 語の根を path.join に渡す形は捕る((B) の判定。(A) では構造上すり抜ける)', () => {
    const root = frameworkWith(`export const A = path.join(repoRoot, '${TEST_ROOTS.app ?? ''}');\n`);

    const findings = verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['root']).toBe('app');
  });

  it('第 1 引数が綴りの join は W3 では捕らない(W3 は製品の根の綴りの検査。層の並びの綴りは後段の綴りの表が見る = platform-spellings.test.ts)', () => {
    const root = frameworkWith(`export const L = join('src', '${TEST_ROOTS.app ?? ''}', '_actions');\n`);

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })).toEqual([]);
  });

  it('解決済みの根を伸ばす joinPath は捕らない(別の口である)', () => {
    const root = frameworkWith(
      `export const J = joinPath(appSrc, '${TEST_ROOTS.app ?? ''}', '_actions');\n`,
    );

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })).toEqual([]);
  });

  it('配列の join は捕らない(第 1 引数が区切り文字のリテラル)', () => {
    const root = frameworkWith(`export const S = parts.join('/');\n`);

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })).toEqual([]);
  });

  it('`.mjs` の直書きも捕る(宣言を読む入口の道具も同じ線で見る)', () => {
    const root = frameworkWith(`export const S = { host: '${TEST_ROOTS.specs}' };\n`, FRAMEWORK_CLI_DIR, 'probe.mjs');

    const findings = verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.location.file).toMatch(/probe\.mjs$/);
    expect(findings[0]?.counterexample?.['root']).toBe('specs');
  });

  it('`.cjs` も走査に入る', () => {
    const root = frameworkWith(`module.exports = path.join(repoRoot, '${TEST_ROOTS.migrations}');\n`, FRAMEWORK_CLI_DIR, 'probe.cjs');

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })).toHaveLength(1);
  });

  it('CLI が道具の場所から根を探す形を捕る(detectRepoRoot(import.meta.dirname))', () => {
    const root = frameworkWith(`const REPO_ROOT = detectRepoRoot(import.meta.dirname);\n`, FRAMEWORK_CLI_DIR);

    const findings = verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('道具の場所');
    expect(findings[0]?.counterexample?.['form']).toBe('detectRepoRoot(import.meta.dirname)');
  });

  it('CLI が道具の場所からの相対で宣言された根の中を指す形を捕る(段数に依らない)', () => {
    const root = frameworkWith(
      `const dir = path.resolve(import.meta.dirname, '${SPECS_FROM_CLI}');\n`,
      FRAMEWORK_CLI_DIR,
    );

    const findings = verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample?.['root']).toBe('specs');
  });

  it('道具の場所から探す形でも cli/ の外は捕らない(仕組み自身の場所を探す層は相手ではない)', () => {
    const root = frameworkWith(`const T = detectRepoRoot(import.meta.dirname);\n`);

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })).toEqual([]);
  });

  it('作業ディレクトリから探す形と、道具の隣・道具のパッケージの中を指す相対は捕らない', () => {
    const root = frameworkWith(
      [
        'const A = requireRepoRoot(process.cwd());',
        "const B = path.resolve(import.meta.dirname, '..');",
        "const C = path.join(import.meta.dirname, 'fixtures.json');",
        '',
      ].join('\n'),
      FRAMEWORK_CLI_DIR,
    );

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })).toEqual([]);
  });

  it('CLI が道具の場所からの相対でリポジトリルートを指す形を捕る(`../../../` のような根そのもの。段数と末尾の `/` に依らない)', () => {
    const toRoot = path.posix.relative(FRAMEWORK_CLI_DIR, '.');
    for (const literal of [toRoot, `${toRoot}/`, `${toRoot}/..`]) {
      const root = frameworkWith(`const REPO_ROOT = path.resolve(import.meta.dirname, '${literal}');\n`, FRAMEWORK_CLI_DIR);

      const findings = verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS });

      expect(findings, literal).toHaveLength(1);
      expect(findings[0]?.counterexample?.['root']).toBe('リポジトリルート');
    }
  });

  it('追えない形(相対を分けた引数・変数経由)は捕らない(doc コメントに明記した射程)', () => {
    const root = frameworkWith(
      [
        "const A = path.resolve(import.meta.dirname, '..', '..', '..');",
        "const hop = '../../../';",
        'const B = path.resolve(import.meta.dirname, hop);',
        '',
      ].join('\n'),
      FRAMEWORK_CLI_DIR,
    );

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })).toEqual([]);
  });

  it('道具の場所から探す形もコメントの中なら捕らない', () => {
    const root = frameworkWith(`// detectRepoRoot(import.meta.dirname) をやめた\nexport const X = 1;\n`, FRAMEWORK_CLI_DIR);

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })).toEqual([]);
  });

  it('仕組みのソースが無い木では何も見ない(壊れない)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'w3-empty-'));
    created.push(root);

    expect(verifyPathSpelling({ repoRoot: root, roots: TEST_ROOTS })).toEqual([]);
  });
});
