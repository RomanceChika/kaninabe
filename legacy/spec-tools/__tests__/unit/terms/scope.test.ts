/**
 * 用語の台帳の M8 / M9 が読む範囲の宣言のテスト。
 *
 * 規約網羅(term-ledger-writing.md §走査の範囲):
 *   - 範囲は製品の根の宣言(仕様・ブック・実装の木)と、製品が宣言した追加の範囲(`term_scan`)と、仕組み自身の住所から組む
 *   - 開発用リポジトリだけの置き場(設計メモ・引き継ぎ文書・案内・フック・CI・歴史の記録)は仕組みが綴りを持たない —— 宣言の無い製品では読まない
 *   - 実装の木を持たない製品では、その木を読む項が消える(仕様だけの製品は正当な形)
 *   - 読まないものは理由つきで宣言する(黙って外れるものを作らない)
 */

import { describe, expect, it } from 'vitest';
import { LITERAL_OUT_OF_SCOPE_FILES, TERM_OUT_OF_SCOPE, termScanScope } from '../../../lib/terms/scope.js';
import { NO_TERM_SCAN, type ProductRoots, type ProductTermScan } from '../../../lib/model/product/types.js';

const ROOTS: ProductRoots = {
  name: 'sample',
  specs: 'spec-tree',
  book: 'book-tree',
  generated: 'gen',
  migrations: 'mig',
  app: 'product-app',
  knowledge: null,
  previews: null,
  termScan: NO_TERM_SCAN,
};

/** 製品が宣言した追加の走査範囲(テスト用の仮の綴り。実在の置き場ではない)。 */
const DECLARED: ProductTermScan = {
  proseTrees: ['memo-tree', 'journal-tree'],
  proseFiles: ['guide.md'],
  scriptTrees: ['hook-tree', 'ci-tree'],
  history: ['log.md', 'queue.md', 'journal-tree/archive/'],
};

const DECLARING: ProductRoots = { ...ROOTS, termScan: DECLARED };

describe('termScanScope', () => {
  it('製品の宣言した根(仕様・ブック・実装)と、仕組み自身の住所から範囲を組む', () => {
    const scope = termScanScope(ROOTS);

    expect(scope.proseTrees).toContain('book-tree');
    expect(scope.specTrees).toEqual(['spec-tree']);
    expect(scope.codeTrees).toContain('product-app');
    expect(scope.proseFiles).toEqual([]);
  });

  it('規約・スキルは仕組み自身の住所から来る(製品の根を変えても動かない)', () => {
    const scope = termScanScope({ ...ROOTS, specs: 'elsewhere', book: 'elsewhere-book' });

    expect(scope.proseTrees).toEqual(expect.arrayContaining(['docs/rules', '.claude/skills']));
    expect(scope.codeTrees).toEqual(expect.arrayContaining(['framework']));
  });

  it('宣言の無い製品は、開発用リポジトリだけの置き場(設計メモ・引き継ぎ文書・案内・フック・CI)を読まない', () => {
    const scope = termScanScope(ROOTS);

    expect(scope.proseTrees).toEqual(['docs/rules', 'book-tree', '.claude/skills']);
    expect(scope.proseFiles).toEqual([]);
    expect(scope.hashCommentTrees).toEqual([]);
    expect(scope.proseOutOfScope).toEqual([]);
  });

  it('製品が宣言した木とファイルは、仕組み自身の木のあとに続けて読む', () => {
    const scope = termScanScope(DECLARING);

    expect(scope.proseTrees).toEqual(['docs/rules', 'book-tree', '.claude/skills', 'memo-tree', 'journal-tree']);
    expect(scope.proseFiles).toEqual(['guide.md']);
  });

  it('読まないのは製品が名指しした歴史の記録だけ(木ごと外すのは末尾が / の印のものだけ)', () => {
    const scope = termScanScope(DECLARING);

    expect(scope.proseOutOfScope).toEqual(['log.md', 'queue.md', 'journal-tree/archive/']);
    expect(scope.proseTrees).toContain('journal-tree');
  });

  it('シェルと YAML の # コメントを読む木は、製品が宣言したものだけ', () => {
    expect(termScanScope(DECLARING).hashCommentTrees).toEqual(['hook-tree', 'ci-tree']);
  });

  it('文字列リテラルを読まないのは、migration の SQL に出る文言を持つ生成器だけ', () => {
    expect(termScanScope(ROOTS).literalOutOfScope).toEqual(LITERAL_OUT_OF_SCOPE_FILES);
    expect(LITERAL_OUT_OF_SCOPE_FILES.every((file) => file.startsWith('legacy/spec-tools/lib/messages/messages-'))).toBe(true);
  });

  it('人が書く文(summary)を集める木は、仕様の木のドメイン仕様である', () => {
    expect(termScanScope(ROOTS).summaryTrees).toEqual(['spec-tree/domain']);
  });

  it('実装の木を持たない製品では、コードの木に実装の根が入らない', () => {
    const scope = termScanScope({ ...ROOTS, app: null });

    expect(scope.codeTrees).not.toContain('product-app');
    expect(scope.codeTrees.length).toBeGreaterThan(0);
  });
});

describe('TERM_OUT_OF_SCOPE: 読まないものの宣言', () => {
  it('どの項も、読まないものと理由の両方を持つ', () => {
    expect(TERM_OUT_OF_SCOPE.length).toBeGreaterThanOrEqual(6);
    for (const entry of TERM_OUT_OF_SCOPE) {
      expect(entry.what).not.toBe('');
      expect(entry.reason).not.toBe('');
    }
  });

  it('歴史の記録は製品が名指しで宣言する(仕組みは置き場の綴りを持たない)', () => {
    const history = TERM_OUT_OF_SCOPE.find((entry) => entry.what.startsWith('歴史の記録'));

    expect(history?.what).toContain('term_scan');
    expect(history?.reason).toContain('ファイルごと');
  });

  it('文字列リテラルの範囲外(migration の文言・テストの題以外・日本語を含まないもの)を理由つきで名指している', () => {
    const names = TERM_OUT_OF_SCOPE.map((entry) => entry.what).join(' / ');

    expect(names).toContain('migration の SQL に出る文言');
    expect(names).toContain('題以外');
    expect(names).toContain('日本語を含まない');
  });

  it('生成物・適用済み migration・歴史の記録を名指している', () => {
    const names = TERM_OUT_OF_SCOPE.map((entry) => entry.what).join(' / ');

    expect(names).toContain('生成物');
    expect(names).toContain('migration');
    expect(names).toContain('歴史の記録');
  });
});
