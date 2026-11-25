import { describe, expect, it } from 'vitest';
import { detectRepoRoot, FRAMEWORK_CODE_EXTENSIONS, FRAMEWORK_LINT_CONFIG_DIR, FRAMEWORK_RUNTIME_DIR, FRAMEWORK_SPEC_TOOLS_DIR } from '../../../lib/io/paths.js';
import { isDirectory, listEntries } from '../../../lib/io/paths.js';
import { readText } from '../../../lib/generality/literals.js';
import { join } from 'node:path';

/**
 * **説明する相手を失った JSDoc(孤児)を残さない。**
 *
 * 束 ①-c-c で 300 行の上限に合わせてファイルを割ったとき、`literals.ts` の末尾に
 * 「生成物の目印」を説明する JSDoc が**宣言ごと動かずに**残り、説明対象は別ファイルへ
 * 移って JSDoc 無しになった。この形は**どの検査も見ていなかった** ——
 * `no-unused-vars` は宣言を見る規則なので、**宣言を持たないコメント**は構造的に検査の範囲外である
 * (`jsdoc/require-jsdoc` は逆向きで「宣言に JSDoc があるか」しか問わない)。
 *
 * 判定は**保守的**である: JSDoc(`/** … *​/`)のあとに、空行・行コメント・普通のブロック
 * コメントを飛ばして**宣言が 1 つも来ない**(ファイルの終わり、または閉じ括弧)ときだけ落とす。
 *
 * **捕らない形(実測つきで残す穴)**: JSDoc の直後に**別の JSDoc** が来る形
 * (= 前の JSDoc の相手が消えたのに、次の宣言が自分の JSDoc を持っている)。これを落とすと
 * 誤検出が多すぎる —— 実測で docs 7 件 / framework 11 件 / app 30 件超が当たり、その大半は
 * **import のあとに置かれたファイル見出しの JSDoc**(正しい形)だった。塞ぐなら「ファイル見出し」を
 * 綴りではなく形で見分ける手が要るので、そのときに別の束で足す。
 *
 * 母集合は**宣言から組む**(綴りを増やさない): この検査器自身の木(`legacy/spec-tools`)と、
 * 仕組み側パッケージの 2 つの根である。製品の木(`app`)は `jsdoc/require-jsdoc` を掛けており、
 * この形も実測 0 件なので、ここでは母集合に入れない(入れるなら製品の根の宣言から組む)。
 */

/** 走査する根(リポジトリルート相対)。`legacy/spec-tools` はこの検査器自身の木である。 */
const SCAN_ROOTS: readonly string[] = [FRAMEWORK_SPEC_TOOLS_DIR, FRAMEWORK_RUNTIME_DIR, FRAMEWORK_LINT_CONFIG_DIR];

/** 走査しない木(依存とビルド成果物。配布物は `dist` であり、正はソースである)。 */
const SKIP_DIRS: readonly string[] = ['node_modules', 'dist', '.next'];

/** 孤児 1 件(ファイルと、JSDoc が始まる行番号)。 */
interface Orphan {
  readonly file: string;
  readonly line: number;
}

/** その行が JSDoc の開始か。 */
function opensJsdoc(line: string): boolean {
  return line.trimStart().startsWith('/**');
}

/**
 * JSDoc ブロックの閉じの行番号(0 始まりの添字)を返す。
 *
 * @param lines ファイルの行
 * @param open 開始行の添字
 * @returns 閉じの行の添字(閉じが無ければ最後の行)
 */
function closeOfJsdoc(lines: readonly string[], open: number): number {
  // **開きのあとだけを見る。** `split('/**')` で割ると、`generated/**` のように本文が `/**` を
  // 含む 1 行 JSDoc で 2 つ目の断片を見てしまい、閉じを取り落とす(実測: この検査を入れた
  // 直後に誤検出 2 件が出た)。
  const line = lines[open] ?? '';
  const after = line.slice(line.indexOf('/**') + '/**'.length);
  if (after.includes('*/')) return open;
  for (let i = open + 1; i < lines.length; i += 1) {
    if ((lines[i] ?? '').includes('*/')) return i;
  }
  return lines.length - 1;
}

/**
 * JSDoc の次に来る**コードの行**を返す(空行・行コメント・普通のブロックコメントは飛ばす)。
 *
 * @param lines ファイルの行
 * @param from 探し始める添字
 * @returns コードの行(無ければ空文字)
 */
function nextCodeLine(lines: readonly string[], from: number): string {
  let i = from;
  while (i < lines.length) {
    const text = (lines[i] ?? '').trim();
    if (text === '' || text.startsWith('//')) {
      i += 1;
      continue;
    }
    if (text.startsWith('/*') && !text.startsWith('/**')) {
      while (i < lines.length && !(lines[i] ?? '').includes('*/')) i += 1;
      i += 1;
      continue;
    }
    return text;
  }
  return '';
}

/**
 * 1 ファイルの孤児 JSDoc を拾う。
 *
 * @param file 表示用のパス
 * @param source ソース全文
 * @returns 孤児の一覧
 */
export function orphanJsdoc(file: string, source: string): readonly Orphan[] {
  const lines = source.split('\n');
  const found: Orphan[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!opensJsdoc(lines[i] ?? '')) {
      i += 1;
      continue;
    }
    const close = closeOfJsdoc(lines, i);
    const next = nextCodeLine(lines, close + 1);
    if (next === '' || ['}', ')', ']'].includes(next.slice(0, 1))) {
      found.push({ file, line: i + 1 });
    }
    i = close + 1;
  }
  return found;
}

/** 走査対象のファイルを集める。 */
function collect(repoRoot: string, relative: string, into: string[]): void {
  const absolute = join(repoRoot, relative);
  if (!isDirectory(absolute)) {
    if (FRAMEWORK_CODE_EXTENSIONS.some((extension) => relative.endsWith(extension))) into.push(relative);
    return;
  }
  for (const entry of listEntries(absolute)) {
    if (SKIP_DIRS.includes(entry)) continue;
    collect(repoRoot, `${relative}/${entry}`, into);
  }
}

describe('説明する相手を失った JSDoc(孤児)を残さない', () => {
  it('ファイルの終わり・閉じ括弧の前に、宣言を持たない JSDoc が 1 件も無い', () => {
    const repoRoot = detectRepoRoot(import.meta.dirname);
    const files: string[] = [];
    for (const root of SCAN_ROOTS) collect(repoRoot, root, files);

    expect(files.length, '走査対象が 0 件(母集合の組み立てが壊れている)').toBeGreaterThan(100);
    const found = files.flatMap((file) => orphanJsdoc(file, readText(join(repoRoot, file))));
    expect(found, JSON.stringify(found)).toEqual([]);
  });

  it('わざと壊す確認: 宣言を持たない JSDoc は拾う(ファイルの終わり)', () => {
    const source = ['export const A = 1;', '', '/**', ' * 相手が消えた説明。', ' */', ''].join('\n');
    expect(orphanJsdoc('x.ts', source)).toEqual([{ file: 'x.ts', line: 3 }]);
  });

  it('わざと壊す確認: 閉じ括弧の前に取り残された JSDoc も拾う', () => {
    const source = ['function f() {', '  /** 相手が消えた説明。 */', '}', ''].join('\n');
    expect(orphanJsdoc('x.ts', source)).toEqual([{ file: 'x.ts', line: 2 }]);
  });

  it('宣言が続く JSDoc は拾わない(1 行の形・行コメントを挟む形も)', () => {
    const attached = ['/** 説明。 */', 'export const A = 1;', ''].join('\n');
    expect(orphanJsdoc('x.ts', attached)).toEqual([]);
    const withNote = ['/**', ' * 説明。', ' */', '// 補足(これは執行者ではない)。', 'export const A = 1;', ''].join('\n');
    expect(orphanJsdoc('x.ts', withNote)).toEqual([]);
  });
});
