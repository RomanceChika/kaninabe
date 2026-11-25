import { describe, expect, it } from 'vitest';
import { checkChapter, formatCheckReport, lineHunks, type ChapterCheck } from '../../../lib/generate/book-entry-check.js';

describe('lineHunks: 行の差分を塊にする', () => {
  it('同じなら塊は無い', () => {
    expect(lineHunks(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(lineHunks([], [])).toEqual([]);
  });

  it('途中の置き換えは 1 つの塊(入口の側の開始行つき)。前後の共通部分は塊に入れない', () => {
    expect(lineHunks(['a', 'x', 'y', 'd'], ['a', 'p', 'd'])).toEqual([{ entryLine: 2, entry: ['x', 'y'], full: ['p'] }]);
  });

  it('入口にだけ・全部入りにだけある行は、片側が空の塊', () => {
    expect(lineHunks(['a', 'b', 'c'], ['a', 'c'])).toEqual([{ entryLine: 2, entry: ['b'], full: [] }]);
    expect(lineHunks(['a', 'c'], ['a', 'b', 'c'])).toEqual([{ entryLine: 2, entry: [], full: ['b'] }]);
  });

  it('離れた 2 か所の違いは 2 つの塊(間の共通の行で割れる)', () => {
    const hunks = lineHunks(['a', '1', 'm', '2', 'z'], ['a', 'x', 'm', 'y', 'z']);
    expect(hunks).toEqual([
      { entryLine: 2, entry: ['1'], full: ['x'] },
      { entryLine: 4, entry: ['2'], full: ['y'] },
    ]);
  });

  it('表が大きすぎる差分は、先頭と末尾を除いた残りを 1 つの塊にする(重い計算をしない)', () => {
    const entry = ['head', ...Array.from({ length: 5000 }, (_, i) => `e${i}`), 'tail'];
    const full = ['head', ...Array.from({ length: 5000 }, (_, i) => `f${i}`), 'tail'];

    const hunks = lineHunks(entry, full);

    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.entryLine).toBe(2);
    expect(hunks[0]?.entry).toHaveLength(5000);
  });
});

describe('checkChapter: 章 1 本の比べ方(HTML の章)', () => {
  const FILE = 'docs/book/a.html';
  /** 検証の結果に依る要素(印 `data-dep="verify"`)だけが違う対。 */
  const page = (dep: string, body = '本文'): string => `<!doctype html>\n<h1>章</h1><ul><li><span data-dep="verify">${dep}</span></li></ul><p>${body}</p>`;
  const ENTRY = page('まだ通していない分は未集計');
  const FULL = page('まだ通していない分 0 件');

  it('比べる相手が無ければ missing', () => {
    expect(checkChapter(FILE, ENTRY, null)).toEqual({ file: FILE, status: 'missing' });
  });

  it('バイト同一なら identical', () => {
    expect(checkChapter(FILE, FULL, FULL)).toEqual({ file: FILE, status: 'identical' });
  });

  it('検証に依る要素(印つき)だけが違うなら verification-only(許す差の範囲は印で固定)', () => {
    expect(checkChapter(FILE, ENTRY, FULL)).toEqual({ file: FILE, status: 'verification-only', fragments: { entry: 1, full: 1 } });
  });

  it('印の付いていない同じ行の別の数(画面の枚数)の違いは許さない(語句の正規化も行ごとの除外もしない)', () => {
    const entry = '<!doctype html>\n<p>画面 23 枚。<span data-dep="verify">受け入れ N</span></p>';
    const full = (screens: number): string => `<!doctype html>\n<p>画面 ${screens} 枚。<span data-dep="verify">受け入れ 18</span></p>`;

    expect(checkChapter(FILE, entry, full(23)).status).toBe('verification-only');
    const changed = checkChapter(FILE, entry, full(24));
    expect(changed.status).toBe('differs');
    expect(changed.status === 'differs' ? changed.hunks[0]?.full.join('') : undefined).toContain('画面 24 枚');
  });

  it('印の付いていない検証の語の違いは許さない(印の外は 1 バイトも違ってはいけない)', () => {
    expect(checkChapter(FILE, '<!doctype html>\n<p>まだ通していない分は未集計</p>', '<!doctype html>\n<p>まだ通していない分 0 件</p>').status).toBe('differs');
  });

  it('切り出した後にも違いがあれば differs(塊つき)', () => {
    const result = checkChapter(FILE, page('まだ通していない分は未集計', '別の本文'), FULL);

    expect(result).toEqual({
      file: FILE,
      status: 'differs',
      hunks: [{ entryLine: 6, entry: ['<p>別の本文</p>'], full: ['<p>本文</p>'] }],
      fragments: { entry: 1, full: 1 },
    });
  });
});

describe('formatCheckReport: 報告の行と合否', () => {
  it('同一と検証・変異に依る部分だけの違いは合格。件数を言う', () => {
    const checks: ChapterCheck[] = [
      { file: 'a.html', status: 'identical' },
      { file: 'b.html', status: 'verification-only', fragments: { entry: 3, full: 2 } },
    ];

    const report = formatCheckReport(checks);

    expect(report.ok).toBe(true);
    expect(report.lines).toEqual([
      '入口の出力と全部入りの生成物の比較: 2 本(同一 1 / 検証・変異に依る部分だけ違う 1 / 食い違い 0 / 比べる相手が無い 0)',
      '  切り出した断片: b.html(入口 3 / 全部入り 2)',
    ]);
  });

  it('切り出した断片が無い章は断片の行を出さない', () => {
    const report = formatCheckReport([{ file: 'b.html', status: 'verification-only', fragments: { entry: 0, full: 0 } }]);

    expect(report.lines).toHaveLength(1);
  });

  it('食い違いは不合格で、章・塊の数・入口と全部入りの行の頭を名指す(長い行は切る)', () => {
    const long = 'あ'.repeat(300);
    const report = formatCheckReport([
      { file: 'a.html', status: 'differs', hunks: [{ entryLine: 7, entry: [long, '2'], full: ['x'] }, { entryLine: 9, entry: ['y'], full: [] }], fragments: { entry: 0, full: 0 } },
    ]);

    expect(report.ok).toBe(false);
    expect(report.lines[0]).toContain('食い違い 1');
    expect(report.lines[1]).toBe('  食い違い: a.html(検証・変異に依る部分を除いても 1 バイト違う塊 2 件)');
    expect(report.lines[2]).toBe('    切り出した後の入口の 7 行目〜: 入口 2 行 / 全部入り 1 行');
    expect(report.lines[3]).toBe(`      入口 | ${'あ'.repeat(160)}…`);
    expect(report.lines).toContain('      全部 | x');
  });

  it('塊は 3 つまでしか挙げない', () => {
    const hunks = Array.from({ length: 5 }, (_, i) => ({ entryLine: i + 1, entry: [`e${i}`], full: [`f${i}`] }));

    const report = formatCheckReport([{ file: 'a.html', status: 'differs', hunks, fragments: { entry: 0, full: 0 } }]);

    expect(report.lines.filter((line) => line.startsWith('    切り出した後の入口の'))).toHaveLength(3);
  });

  it('比べる相手が無い章は不合格で、npm run generate を先に回すと言う', () => {
    const report = formatCheckReport([{ file: 'docs/book/a.md', status: 'missing' }]);

    expect(report.ok).toBe(false);
    expect(report.lines[1]).toContain('比べる相手が無い: docs/book/a.md');
    expect(report.lines[1]).toContain('npm run generate');
  });

  it('章が 1 本も無いときは不合格(空振りの合格にしない)', () => {
    const report = formatCheckReport([]);

    expect(report.ok).toBe(false);
    expect(report.lines[1]).toContain('比べる章がありません');
  });
});
