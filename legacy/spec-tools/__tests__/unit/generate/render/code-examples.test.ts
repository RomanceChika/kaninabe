/**
 * 「書き方の例」章の切り出しエンジン(lib/generate/render/code-examples.ts)のテスト。
 *
 * 大半は純粋な文字列操作(extractRegion / extractSection / regionNamesIn)である。
 * 唯一 I/O を通すのが**印の母集合の走査**(scanExampleSourceFiles)で、これは
 * 「索引をどこにも書かない」ことそのものが仕様なので、実ファイルの木を作って測るしかない。
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  countLines,
  exampleScanRoots,
  extractRegion,
  extractSection,
  generatedMarkersOverlapping,
  hasExamplesChapter,
  MAX_EXAMPLE_LINES,
  readRepoFile,
  regionNamesIn,
  scanExampleSourceFiles,
} from '../../../../lib/generate/render/code-examples.js';
import { resolveExamples } from '../../../../lib/generate/render/book/examples-page-render.js';
import type { ExampleCategory, ExcerptSpec } from '../../../../lib/generate/render/book/examples-page-types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';

describe('extractRegion: コードの印から中身を切り出す', () => {
  it('// #region example:name 〜 // #endregion の中身を取り出す(印の行自体は含まない)', () => {
    const source = ['before', '// #region example:foo', 'const a = 1;', 'const b = 2;', '// #endregion', 'after'].join(
      '\n',
    );
    expect(extractRegion(source, 'foo')).toBe('const a = 1;\nconst b = 2;');
  });

  it('-- #region example:name 〜 -- #endregion(SQL)も同じ形で取り出す', () => {
    const source = ['-- #region example:bar', 'select 1;', '-- #endregion'].join('\n');
    expect(extractRegion(source, 'bar')).toBe('select 1;');
  });

  it('名前が無ければ null(未解決の印としてページ側がエラーにする)', () => {
    const source = ['// #region example:foo', 'x', '// #endregion'].join('\n');
    expect(extractRegion(source, 'other')).toBeNull();
  });

  it('開始はあるが閉じていなければ null(壊れた印を通さない)', () => {
    const source = ['// #region example:foo', 'x'].join('\n');
    expect(extractRegion(source, 'foo')).toBeNull();
  });

  it('中身の前後の空行は落とす', () => {
    const source = ['// #region example:foo', '', 'x', '', '// #endregion'].join('\n');
    expect(extractRegion(source, 'foo')).toBe('x');
  });
});

describe('regionNamesIn: ファイルに置かれた印の名前を全部拾う', () => {
  it('宣言順に名前を返す(0本なら空配列)', () => {
    const source = ['// #region example:a', 'x', '// #endregion', '// #region example:b', 'y', '// #endregion'].join(
      '\n',
    );
    expect(regionNamesIn(source)).toEqual(['a', 'b']);
    expect(regionNamesIn('no marks here')).toEqual([]);
  });
});

describe('extractSection: 見出しアンカーで仕様 md の節を切る', () => {
  it('見出し行から、次の同じか浅いレベルの見出しの直前までを取り出す', () => {
    const markdown = ['# タイトル', '', '### 宣言', '', '内容1', '内容2', '', '### 次の節', '無視される'].join('\n');
    expect(extractSection(markdown, '宣言')).toBe('### 宣言\n\n内容1\n内容2');
  });

  it('次に浅い見出し(## 等)が来たらそこで切る', () => {
    const markdown = ['### 宣言', '内容', '## 上位の見出し', '別の話'].join('\n');
    expect(extractSection(markdown, '宣言')).toBe('### 宣言\n内容');
  });

  it('後続の見出しが無ければ EOF まで', () => {
    const markdown = ['### 宣言', '内容1', '内容2'].join('\n');
    expect(extractSection(markdown, '宣言')).toBe('### 宣言\n内容1\n内容2');
  });

  it('見出しが無ければ null', () => {
    expect(extractSection('# タイトルだけ', '宣言')).toBeNull();
  });

  it('AUTO-GENERATED の境界コメント行は節の中に紛れ込んでも除く', () => {
    const markdown = ['### テストケース', '| a | b |', '<!-- /AUTO-GENERATED:action-body -->'].join('\n');
    expect(extractSection(markdown, 'テストケース')).toBe('### テストケース\n| a | b |');
  });
});

describe('generatedMarkersOverlapping: 節が重なる生成ブロックの印を返す', () => {
  const open = (name: string): string => `<!-- AUTO-GENERATED:${name} -->`;
  const close = (name: string): string => `<!-- /AUTO-GENERATED:${name} -->`;

  it('見出しが生成ブロックの中にあれば、そのブロックの印', () => {
    const source = ['# 題', open('a-body'), '### 表', '| x |', close('a-body'), '手書き'].join('\n');

    expect(generatedMarkersOverlapping(source, '表')).toEqual(['a-body']);
  });

  it('手書きの見出しの節がブロックを含むときも数える(中身が生成器の出力に左右される)', () => {
    const source = ['## 手書き', open('a-body'), '| x |', close('a-body'), '## 次'].join('\n');

    expect(generatedMarkersOverlapping(source, '手書き')).toEqual(['a-body']);
  });

  it('節の外のブロックは数えない(前にあるものも、次の同じ深さの見出しより後にあるものも)', () => {
    const source = [open('before'), close('before'), '## 節', '本文', '## 次', open('after'), close('after')].join('\n');

    expect(generatedMarkersOverlapping(source, '節')).toEqual([]);
  });

  it('節の中の 2 つのブロックは出現順に返し、同じ印の重複は 1 つにまとめる', () => {
    const source = ['## 節', open('x'), close('x'), open('y'), close('y'), open('x'), close('x')].join('\n');

    expect(generatedMarkersOverlapping(source, '節')).toEqual(['x', 'y']);
  });

  it('閉じていないブロックと、開かれていない終了は数えない', () => {
    const source = ['## 節', close('stray'), open('unclosed'), '本文'].join('\n');

    expect(generatedMarkersOverlapping(source, '節')).toEqual([]);
  });

  it('見出しが無ければ空', () => {
    expect(generatedMarkersOverlapping([open('a'), close('a')].join('\n'), '無い見出し')).toEqual([]);
  });
});

describe('readRepoFile: 抜粋元を読む(読めないものは例外にせず null)', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));

  it('実ファイルは読める・無いファイルは null', () => {
    expect(readRepoFile(REPO_ROOT, 'product.md')).not.toBeNull();
    expect(readRepoFile(REPO_ROOT, 'no/such/file.ts')).toBeNull();
  });

  it('抜粋元が空文字(配置が決められなかった)やディレクトリを指す相対パスは、EISDIR で落とさず null', () => {
    expect(readRepoFile(REPO_ROOT, '')).toBeNull();
    expect(readRepoFile(REPO_ROOT, 'docs')).toBeNull();
    expect(readRepoFile(REPO_ROOT, 'docs/')).toBeNull();
  });
});

describe('resolveExamples: 抜粋元が空文字なら鮮度エラーとして名指す(前提の失敗。例外の素のメッセージで落とさない)', () => {
  const category = (excerpt: ExcerptSpec): ExampleCategory => ({
    title: 'T',
    intro: '',
    examples: [{ title: 'E', intro: '', steps: [{ label: 'L', excerpt }] }],
  });
  const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));

  it('code / spec / sign のどの抜粋でも、置き場を決められない旨と指し先を出す', () => {
    for (const [excerpt, locator] of [
      [{ kind: 'code', file: '', region: 'r1', lang: 'ts' }, '印 r1'],
      [{ kind: 'spec', file: '', heading: 'H1' }, '見出し H1'],
      [{ kind: 'sign', file: '', includes: 'S1' }, '標識「S1」'],
    ] as const) {
      expect(() => resolveExamples([category(excerpt)], REPO_ROOT, []), locator).toThrow(`抜粋元の置き場を置き場の配置から決められない: ${locator}`);
    }
  });

  it('空でない無いファイルは従来どおり「ファイルが無い」', () => {
    expect(() => resolveExamples([category({ kind: 'code', file: 'no/such.ts', region: 'r', lang: 'ts' })], REPO_ROOT, [])).toThrow('ファイルが無い: no/such.ts');
  });
});

describe('countLines / MAX_EXAMPLE_LINES: 1 例の上限判定に使う材料', () => {
  it('空文字は 0 行、それ以外は改行数 + 1 行', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\nb\nc')).toBe(3);
  });

  it('上限は 40 行(例を小さく保つための強制)', () => {
    expect(MAX_EXAMPLE_LINES).toBe(40);
  });
});

/**
 * **索引をどこにも書かない**(束 ⑲-3)ことの実測。
 *
 * 起点は**fixture 1 つ**(`fixtures/samples/rooms`)である —— `docs/rules/` を 1 枚も持たない
 * 「仕様だけのリポジトリ」であり、束 ⑲-1 までは索引が規約文書の中にあったせいで、この形の
 * リポジトリは「書き方の例」の章を**構造的に持てなかった**(独立レビュー 4-A)。
 * ここで測るのは 2 つ: (1) 印が無ければ章を持たない (2) `docs/rules/` が無いままでも、
 * 印を 1 つ置けば母集合が導かれ、章を持てる。
 */
describe('scanExampleSourceFiles: 印の母集合を走査で導く(索引を持たない)', () => {
  /** fixture(仕様だけのツリー。docs/rules を持たない)。 */
  const FIXTURE = fileURLToPath(new URL('../../../fixtures/samples/rooms/docs', import.meta.url));

  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'example-scan-'));
    cpSync(FIXTURE, path.join(root, 'docs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** 走査対象の木に 1 ファイル置く。 */
  const put = (relative: string, body: string): void => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  };

  it('走査する木は層の名前だけである(アプリの語彙を 1 つも持たない)', () => {
    expect([...exampleScanRoots(TEST_ROOTS, TEST_LAYOUT)]).toEqual(['app/src', 'supabase/migrations', 'docs/specs']);
  });

  it('印が 1 つも無ければ母集合は空で、章も持たない(docs/rules の有無に依らない)', () => {
    expect(scanExampleSourceFiles(root, TEST_ROOTS, TEST_LAYOUT)).toEqual([]);
    expect(hasExamplesChapter({ actions: {}, repoRoot: root, roots: TEST_ROOTS, layout: TEST_LAYOUT })).toBe(false);
  });

  it('docs/rules が 1 枚も無いリポジトリでも、印を置けば母集合が導かれて章を持てる', () => {
    put('app/src/operation/_template/update.ts', ['// #region example:operation-update', 'const x = 1;', '// #endregion'].join('\n'));
    expect(scanExampleSourceFiles(root, TEST_ROOTS, TEST_LAYOUT)).toEqual(['app/src/operation/_template/update.ts']);
    expect(hasExamplesChapter({ actions: {}, repoRoot: root, roots: TEST_ROOTS, layout: TEST_LAYOUT })).toBe(true);
  });

  it('3 つの木を横断し、並びは木の宣言順ではなく辞書順に固定する(環境で揺れない)', () => {
    put('supabase/migrations/20260101000000_thing.sql', ['-- #region example:rpc', 'select 1;', '-- #endregion'].join('\n'));
    put('app/src/operation/_template/update.ts', ['// #region example:a', 'x', '// #endregion'].join('\n'));
    // 仕様 md は印を持たない規約だが、置かれたら母集合に入る(「未参照の印」で鳴らすため)。
    put('docs/specs/backend/note.md', '<!-- x -->\n// #region example:oops\n// #endregion');
    expect(scanExampleSourceFiles(root, TEST_ROOTS, TEST_LAYOUT)).toEqual([
      'app/src/operation/_template/update.ts',
      'docs/specs/backend/note.md',
      'supabase/migrations/20260101000000_thing.sql',
    ]);
  });

  it('印を持たないファイルは母集合に入らない(拡張子ではなく印が条件)', () => {
    put('app/src/operation/plain.ts', 'export const x = 1;\n');
    expect(scanExampleSourceFiles(root, TEST_ROOTS, TEST_LAYOUT)).toEqual([]);
  });
});
