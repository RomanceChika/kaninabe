/**
 * ひな形の注釈(`@tc-each`)の抽出と展開の単体テスト。
 *
 * 見るのは 3 つである。
 *   - ひな形とループの `it` の名前が同じ形に寄ること(`{table}` と `${table}`)
 *   - 台帳のテスト名がひな形に当てはまる ID だけが注釈に展開されること
 *   - 当てはまらない宣言・別ファイルの宣言は展開されないこと(**当たれば何でも通る**形でない)
 */

import { describe, expect, it } from 'vitest';
import { extractAnnotations, normalizeTemplate } from '../../../lib/trace/extract-annotations.js';
import { expandEachTags, templateMatcher } from '../../../lib/trace/expand-each.js';
import type { TcRegistryEntry } from '../../../lib/testcase/types.js';
import { buildTcRegistry } from '../../../lib/testcase/registry.js';
import type { TestScanResult } from '../../../lib/testcase/types-scan.js';
import type { ScanWithFramework } from '../../../lib/testcase/types-scan-framework.js';

/** 突合のテストの形(ひな形 + ループ)。 */
const SOURCE = [
  "import { it } from 'vitest';",
  '',
  '// @tc-each {table} の列と制約が宣言どおりである',
  'for (const table of SPEC_TABLES) {',
  '  it(`${table} の列と制約が宣言どおりである`, () => {',
  '    expectDdlParity(table);',
  '  });',
  '}',
  '',
].join('\n');

/** 対象のファイル(リポジトリルート相対)。 */
const FILE = 'app/src/infrastructure/__tests__/schema/ddl-parity.test.ts';

/** 台帳のエントリ 1 件。 */
function entry(tcId: string, file: string, testName: string): TcRegistryEntry {
  return {
    tcId,
    specKind: 'data_table',
    specId: 'table-books',
    specIds: ['table-books'],
    implementation: { raw: `${file}::${testName}`, file, testName },
    location: { file: 'docs/specs/backend/data/tables/books.md' },
    specFile: 'docs/specs/backend/data/tables/books.md',
  };
}

/** 走査結果の最小形(ひな形だけを持つ)。 */
function scan(): TestScanResult {
  const extracted = extractAnnotations(SOURCE, FILE);
  return {
    available: true,
    testFiles: [FILE],
    annotations: [...extracted.annotations],
    eachTags: [...extracted.eachTags],
    actionFiles: [],
    operationFiles: [],
  };
}

describe('ひな形の抽出', () => {
  it('ひな形とループの it の名前を同じ形に寄せる', () => {
    const [each] = extractAnnotations(SOURCE, FILE).eachTags;
    expect(each?.template).toBe('{table} の列と制約が宣言どおりである');
    expect(each?.loopName).toBe('{} の列と制約が宣言どおりである');
    expect(normalizeTemplate(each?.template ?? '')).toBe(each?.loopName);
  });

  it('ひな形の行は片方だけの注釈にならない(@spec が無くても @tc-each は注釈の仲間である)', () => {
    expect(extractAnnotations(SOURCE, FILE).halfTags).toEqual([]);
  });

  it('直後にテスト宣言が無ければ loopName は null(A12 が止める材料)', () => {
    const [each] = extractAnnotations('// @tc-each {table} の何か\nconst a = 1;\n', FILE).eachTags;
    expect(each?.loopName).toBeNull();
  });
});

describe('ひな形の当て方', () => {
  it('穴は空でない文字にだけ当たる(固定部分だけの名前は当たらない)', () => {
    const matcher = templateMatcher('{table} の列と制約が宣言どおりである');
    expect(matcher.test('books の列と制約が宣言どおりである')).toBe(true);
    expect(matcher.test(' の列と制約が宣言どおりである')).toBe(false);
    expect(matcher.test('books の列と制約が宣言どおりでない')).toBe(false);
  });
});

describe('台帳への展開', () => {
  it('ひな形に当てはまる宣言が注釈になる', () => {
    const registry = buildTcRegistry([entry('TC-DDL-BOOKS-001', FILE, 'books の列と制約が宣言どおりである')]);
    const expanded = expandEachTags(scan(), registry);
    expect(expanded.annotations).toHaveLength(1);
    expect(expanded.annotations[0]?.tcId).toBe('TC-DDL-BOOKS-001');
    expect(expanded.annotations[0]?.testName).toBe('books の列と制約が宣言どおりである');
    expect(expanded.annotations[0]?.file).toBe(FILE);
  });

  it('ひな形に当てはまらない宣言は展開しない', () => {
    const registry = buildTcRegistry([entry('TC-OTHER-001', FILE, 'まったく別のテスト')]);
    expect(expandEachTags(scan(), registry).annotations).toEqual([]);
  });

  it('別のファイルを指す宣言は展開しない', () => {
    const registry = buildTcRegistry([
      entry('TC-DDL-BOOKS-001', 'app/src/other.test.ts', 'books の列と制約が宣言どおりである'),
    ]);
    expect(expandEachTags(scan(), registry).annotations).toEqual([]);
  });

  it('ひな形が 1 つも無ければ走査結果をそのまま返す', () => {
    const empty: TestScanResult = { ...scan(), eachTags: [] };
    expect(expandEachTags(empty, buildTcRegistry([]))).toBe(empty);
  });
});

describe('仕組みの根の走査のひな形', () => {
  const FW_FILE = 'legacy/spec-tools/__tests__/guarantees/ddl-parity.test.ts';
  const FW_SOURCE = SOURCE;

  /** 製品の走査は空で、ひな形は仕組みの走査だけが持つ。 */
  function frameworkOnly(): ScanWithFramework {
    const extracted = extractAnnotations(FW_SOURCE, FW_FILE);
    return {
      available: false,
      testFiles: [],
      annotations: [],
      actionFiles: [],
      operationFiles: [],
      framework: {
        state: { state: 'scanned' },
        testFiles: [FW_FILE],
        annotations: [...extracted.annotations],
        eachTags: [...extracted.eachTags],
      },
    };
  }

  it('仕組みの根のひな形は、仕組みの走査の注釈へ展開される(製品の注釈には混ざらない)', () => {
    const registry = buildTcRegistry([entry('TC-FW-DDL-001', FW_FILE, 'books の列と制約が宣言どおりである')]);

    const expanded = expandEachTags(frameworkOnly(), registry);

    expect(expanded.framework?.annotations.map((annotation) => annotation.tcId)).toEqual(['TC-FW-DDL-001']);
    expect(expanded.framework?.annotations[0]).toMatchObject({ file: FW_FILE, testName: 'books の列と制約が宣言どおりである' });
    expect(expanded.annotations).toEqual([]);
  });

  it('仕組みのひな形に当てはまる宣言が無ければ、走査結果をそのまま返す', () => {
    const scanned = frameworkOnly();

    expect(expandEachTags(scanned, buildTcRegistry([entry('TC-OTHER-001', FW_FILE, '別のテスト')]))).toBe(scanned);
  });
});
