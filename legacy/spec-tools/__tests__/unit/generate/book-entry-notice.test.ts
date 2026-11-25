import { describe, expect, it } from 'vitest';
import type { EntryInputPlan } from '../../../lib/generate/book-entry-plan.js';
import {
  CHAPTER_READERS,
  chapterKeyOf,
  noticeLine,
  readerNotices,
  withReaderNotices,
  type ReaderNotice,
} from '../../../lib/generate/book-entry-notice.js';
import type { FileSection } from '../../../lib/generate/apply-sections.js';
import { NO_TERM_SCAN, type ProductRoots } from '../../../lib/model/product/types.js';
import { SPEC_KINDS, type SpecKind } from '../../../lib/model/product/uses.js';
import {
  changedHtmlSections,
  htmlSectionBodies,
  htmlSectionLabel,
  pageBody,
  PROBE_ALL_UP_TO,
  probeIndexes,
  type ShapeProbe,
} from '../../helpers/book-notice-probe.js';

const roots: ProductRoots = { name: 'x', specs: 'docs/specs', book: 'docs/book', generated: 'app/src/domain/generated', migrations: 'supabase/migrations', app: 'app', knowledge: null, previews: null, termScan: NO_TERM_SCAN };

/** 阻害の種類を持つ計画(章の止め方は問わない。注記の材料は阻害した種類と理由だけ)。 */
function planBlocking(...kinds: readonly SpecKind[]): EntryInputPlan {
  return { blocked: kinds.map((kind) => ({ kind, reason: 'invalid', stopped: [] })), unselected: [], notAdopted: [], stoppedChapters: [] };
}

describe('chapterKeyOf: 章のファイルを表の章の名前にする', () => {
  it('ハンドブックの根の中の相対。集約の章は domain/*。章でないもの(部品・根の外)は null', () => {
    expect(chapterKeyOf('docs/book/index.html', roots)).toBe('index.html');
    expect(chapterKeyOf('docs/book/visibility.html', roots)).toBe('visibility.html');
    expect(chapterKeyOf('docs/book/domain/item.html', roots)).toBe('domain/*');
    expect(chapterKeyOf('docs/book/spec/item.html', roots)).toBe('spec/*');
    expect(chapterKeyOf('docs/book/assets/summaries.json', roots)).toBeNull();
    expect(chapterKeyOf('docs/book/assets/search.json', roots)).toBeNull();
    expect(chapterKeyOf('docs/book/assets/results/hold.json', roots)).toBeNull();
    expect(chapterKeyOf('docs/specs/backend/jobs.md', roots)).toBeNull();
    expect(chapterKeyOf('docs/book/domain/deep/x.html', roots)).toBe('domain/deep/x.html');
  });
});

describe('readerNotices / noticeLine: 阻害した種類を読む章に、読めた分だけの節を名指す', () => {
  const files = ['docs/book/index.html', 'docs/book/domain/a.html', 'docs/book/domain/b.html', 'docs/book/sweep.html', 'docs/book/config.html', 'docs/book/assets/ui.css'];

  it('阻害が無ければ注記は無い', () => {
    expect(readerNotices(planBlocking(), files, roots)).toEqual([]);
  });

  it('阻害した種類を読む章だけに、読む節つきで出る(ファイルの昇順 → 種類の順)。章でないファイルと、読まない章には出ない', () => {
    const notices = readerNotices(planBlocking('queries', 'jobs'), files, roots);

    expect(notices.map((notice) => `${notice.file.replace('docs/book/', '')}/${notice.kind}`)).toEqual([
      'domain/a.html/queries',
      'domain/a.html/jobs',
      'domain/b.html/queries',
      'domain/b.html/jobs',
      'index.html/queries',
      'index.html/jobs',
      'sweep.html/queries',
      'sweep.html/jobs',
    ]);
    expect(notices.find((notice) => notice.file.endsWith('sweep.html') && notice.kind === 'queries')?.sections).toEqual(['状態', '読み取り経路']);
  });

  it('生成していない章(阻害した種類が持ち主の章を止めた分)には出ない。渡した章だけが対象', () => {
    expect(readerNotices(planBlocking('jobs'), ['docs/book/index.html'], roots).map((notice) => notice.file)).toEqual(['docs/book/index.html']);
  });

  it('1 行は、どの種類が・なぜ読めず・どの節が読めた分だけかを言い、入口の出力であることと本物の出し方も言う', () => {
    const notice: ReaderNotice = { file: 'docs/book/domain/a.html', kind: 'notifications', reason: 'missing', sections: ['冒頭', '上段 — 公理', '下段 — 導出'] };
    const line = noticeLine(notice);

    expect(line.startsWith('<li><strong>notifications が読めない(阻害)入口の出力です</strong>')).toBe(true);
    expect(line).toContain('notifications を採っているが章の材料へ渡せない(置き場に仕様が無い)');
    expect(line).toContain('冒頭の数の表示・「上段 — 公理」・「下段 — 導出」のうち notifications に依る部分は、読めた分だけ(読めなければ無い前提)で出しています');
    expect(line).toContain('<code>npm run generate</code>');
  });
});

describe('withReaderNotices: 章の最初の <h1> 要素の直下に足す', () => {
  const whole = (content: string): FileSection => ({ wholeFile: true, content });
  const notice = (file: string, kind: SpecKind = 'jobs'): ReaderNotice => ({ file, kind, reason: 'invalid', sections: ['章立て'] });
  const page = '<!doctype html><body><div class="vp-doc bf-doc"><h1 id="t">タイトル <span>3</span></h1><p>本文</p><h1>二つ目</h1></div></body>';

  it('最初の </h1> の直後に、引用の箇条書きとして足す(ほかは 1 バイトも変えない)。足さないファイルは同じ値のまま', () => {
    const byFile = new Map<string, readonly FileSection[]>([
      ['docs/book/a.html', [whole(page)]],
      ['docs/book/b.html', [whole('<h1>別の章</h1>')]],
    ]);

    const out = withReaderNotices(byFile, [notice('docs/book/a.html')]);

    const content = out.get('docs/book/a.html')?.[0]?.content ?? '';
    const close = '<h1 id="t">タイトル <span>3</span></h1>';
    expect(content.startsWith(`<!doctype html><body><div class="vp-doc bf-doc">${close}<blockquote class="bf-notice" data-entry-notice="blocked"><ul>`)).toBe(true);
    expect(content).toContain(`${noticeLine(notice('docs/book/a.html'))}</ul></blockquote><p>本文</p><h1>二つ目</h1>`);
    expect(out.get('docs/book/b.html')).toBe(byFile.get('docs/book/b.html'));
  });

  it('仕様由来の字は HTML の字として畳まれる(注記は出力の口で組む。タグとして混ざらない)', () => {
    const hostile: ReaderNotice = { file: 'docs/book/a.html', kind: 'jobs', reason: 'invalid', sections: ['<script>x</script>'] };
    const line = noticeLine(hostile);

    expect(line).not.toContain('<script>');
    expect(line).toContain('&#60;script&#62;x&#60;/script&#62;');
  });

  it('同じ章に複数あれば 1 つの引用に 1 項目ずつ並べる。<h1> の無いセクション・全体生成でないセクションはそのまま', () => {
    const noHeading = new Map<string, readonly FileSection[]>([['docs/book/a.html', [whole('見出しが無い')]]]);
    const marker = new Map<string, readonly FileSection[]>([['docs/book/a.html', [{ marker: 'm', content: '<h1>x</h1>' }]]]);
    const two = new Map<string, readonly FileSection[]>([['docs/book/a.html', [whole(page)]]]);

    expect(withReaderNotices(noHeading, [notice('docs/book/a.html')]).get('docs/book/a.html')).toEqual([whole('見出しが無い')]);
    expect(withReaderNotices(marker, [notice('docs/book/a.html')]).get('docs/book/a.html')).toEqual([{ marker: 'm', content: '<h1>x</h1>' }]);
    const content = withReaderNotices(two, [notice('docs/book/a.html', 'jobs'), notice('docs/book/a.html', 'queries')]).get('docs/book/a.html')?.[0]?.content ?? '';
    expect(content.match(/<blockquote class="bf-notice"/g)).toHaveLength(1);
    const items = content.match(/<li><strong>[^<]*<\/strong>/g) ?? [];
    expect(items).toEqual(['<li><strong>jobs が読めない(阻害)入口の出力です</strong>', '<li><strong>queries が読めない(阻害)入口の出力です</strong>']);
  });
});

describe('CHAPTER_READERS: 表の形', () => {
  it('(章, 種類) は重ならず、種類は閉じた一覧の中にあり、節は 1 つ以上', () => {
    const keys = CHAPTER_READERS.map((reader) => `${reader.chapter}/${reader.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const reader of CHAPTER_READERS) {
      expect(SPEC_KINDS, reader.kind).toContain(reader.kind);
      expect(reader.sections.length, `${reader.chapter}/${reader.kind}`).toBeGreaterThan(0);
    }
  });
});

describe('probeIndexes: 測る件を位置ではなく件の形で選ぶ', () => {
  const kinds = ['a', 'b', 'a', 'c', 'b', 'a', 'c', 'a'];
  const droppable = (shapes: ShapeProbe<object, string>['shapes'], count = kinds.length): ShapeProbe<object, string> => ({ count: () => count, shapes });
  const shapeOfKind: ShapeProbe<object, string>['shapes'][number] = (_inputs, index) => [kinds[index] ?? ''];
  const shapeParity: ShapeProbe<object, string>['shapes'][number] = (_inputs, index) => [String(index % 2)];

  it('軸ごとに、形の値の先頭の 1 件を代表にする(位置の先頭・真ん中・最後は選ばない)', () => {
    expect(probeIndexes(droppable([shapeOfKind]), {}, '', false)).toEqual([0, 1, 3]);
  });

  it('軸が 2 本なら、それぞれの代表の和集合(昇順・重ならない)', () => {
    expect(probeIndexes(droppable([shapeOfKind, shapeParity]), {}, '', false)).toEqual([0, 1, 3]);
    expect(probeIndexes(droppable([(_inputs, index) => [String(index === 6)]]), {}, '', false)).toEqual([0, 6]);
  });

  it('複合軸は成分の並びで比べる(成分の片方だけが違う件も別の形・成分の区切りの文字に依らない)', () => {
    const pairs = [['x', 'p'], ['x', 'p'], ['x', 'q'], ['y', 'p'], ['a/b', 'c'], ['a', 'b/c']];
    const compound: ShapeProbe<object, string>['shapes'][number] = (_inputs, index) => pairs[index] ?? [];

    expect(probeIndexes(droppable([compound], pairs.length), {}, '', false)).toEqual([0, 2, 3, 4, 5]);
  });

  it('件数が少なければ各件・全件の実測(full)では形に依らず全部', () => {
    expect(probeIndexes(droppable([shapeOfKind], PROBE_ALL_UP_TO), {}, '', false)).toEqual([0, 1, 2, 3, 4]);
    expect(probeIndexes(droppable([shapeOfKind]), {}, '', true)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

/** 実測(dev-repo)が章を節に割る道具のテスト用に、本文だけの小さなページを作る。 */
const page = (body: string, tail = '<nav class="bf-pager">前後</nav>'): string => `<!doctype html><html><body><aside>目次</aside><main><div class="vp-doc bf-doc">${body}${tail}</main></body></html>`;

describe('実測の道具(HTML のページを節に割る): pageBody / htmlSectionLabel / htmlSectionBodies / changedHtmlSections', () => {
  it('pageBody: ページの枠(目次・前後の章)を含めず、本文だけを取る。本文が無ければ空', () => {
    expect(pageBody(page('<h1>題</h1><p>本文</p>'))).toBe('<h1>題</h1><p>本文</p>');
    expect(pageBody('<html><body>枠だけ</body></html>')).toBe('');
  });

  it('htmlSectionLabel: 印の要素・タグ・件数を取り、実体参照を戻す。ユースケースの章は 1 つの一般形', () => {
    expect(htmlSectionLabel('sweep.html', '<span class="bf-mark bf-mark--axiom">必読</span>上段 — 公理 <span class="bf-mark bf-mark--axiom">必読</span>')).toBe('上段 — 公理');
    expect(htmlSectionLabel('config.html', '受け入れ(16)')).toBe('受け入れ');
    expect(htmlSectionLabel('config.html', '<code>a</code> &#38; &#60;b&#62;')).toBe('a & <b>');
    expect(htmlSectionLabel('usecases.html', '催しを立てる')).toBe('ユースケースごとの節');
  });

  it('htmlSectionBodies: h1 の直後から最初の h2 までが「冒頭」。h3 以下は属する節の中。同じ名前の節は出現の順に連ねる', () => {
    const bodies = htmlSectionBodies('x.html', page('<h1>題</h1><p>導入</p><h2>甲</h2><p>甲の本文</p><h3>小</h3><p>小の本文</p><h2>乙(3)</h2><p>乙</p><h2>甲</h2><p>甲 2</p>'));

    expect([...bodies.keys()]).toEqual(['冒頭', '甲', '乙']);
    expect(bodies.get('冒頭')).toEqual(['<p>導入</p>']);
    expect(bodies.get('甲')).toEqual(['<p>甲の本文</p><h3>小</h3><p>小の本文</p>', '<p>甲 2</p>']);
  });

  it('changedHtmlSections: 中身が違う節・片側にしか無い節だけを返す。ページの枠だけの違いは数えない', () => {
    const base = '<h1>題</h1><p>導入</p><h2>甲</h2><p>甲</p><h2>乙</h2><p>乙</p>';

    expect([...changedHtmlSections('x.html', page(base), page(base, '<nav class="bf-pager">別の前後</nav>'))]).toEqual([]);
    expect([...changedHtmlSections('x.html', page(base), page(base.replace('<p>甲</p>', '<p>甲が変わった</p>')))]).toEqual(['甲']);
    expect([...changedHtmlSections('x.html', page(base), page(base.replace('<h2>乙</h2><p>乙</p>', '')))]).toEqual(['乙']);
    expect([...changedHtmlSections('x.html', page(base), page(base.replace('<p>導入</p>', '<p>導入が変わった</p>')))]).toEqual(['冒頭']);
  });
});
