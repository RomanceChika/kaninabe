import { describe, expect, it } from 'vitest';
import { specPath } from '../../../lib/model/product/paths.js';
import { SPEC_KINDS, type SpecKind } from '../../../lib/model/product/uses.js';
import { NO_TERM_SCAN, type ProductRoots } from '../../../lib/model/product/types.js';
import type { BlockedReason } from '../../../lib/kernel/input-state.js';
import type { FileSection } from '../../../lib/generate/apply-sections.js';
import {
  CHAPTER_OWNERS,
  partitionPlacementProblems,
  planEntryInputs,
  staleChapters,
  unreadPlaces,
  withoutStoppedChapters,
} from '../../../lib/generate/book-entry-plan.js';
import type { KindInput } from '../../../lib/generate/generate-inputs.js';
import { bookFile } from '../../../lib/generate/render/book/chapters.js';

/** 計画の判定に使う、最小の製品の根(実装の木を宣言する)。 */
const roots: ProductRoots = rootsOf('app');

/** 全種類が読込済みの入力の状態から、指定した種類だけ差し替える。 */
function states(overrides: Partial<Record<SpecKind, KindInput['input']>>): readonly KindInput[] {
  return SPEC_KINDS.map((kind) => ({ kind, input: overrides[kind] ?? { state: 'loaded', value: true, findings: [] } }));
}

/** 阻害の入力。 */
const blocked = (reason: BlockedReason): KindInput['input'] => ({ state: 'blocked', reason, findings: [] });
/** 未選択の入力。 */
const unselected: KindInput['input'] = { state: 'unselected', findings: [] };

describe('CHAPTER_OWNERS: 章の持ち主の表', () => {
  it('種類は閉じた一覧の中にあり、章のファイル名(HTML)も重ならない', () => {
    for (const owner of CHAPTER_OWNERS) {
      expect(SPEC_KINDS, owner.chapter).toContain(owner.kind);
      expect(owner.chapter.endsWith('.html'), owner.chapter).toBe(true);
    }
    expect(new Set(CHAPTER_OWNERS.map((owner) => owner.chapter)).size).toBe(CHAPTER_OWNERS.length);
    expect(new Set(CHAPTER_OWNERS.map((owner) => owner.kind)).size, '1 つの種類の持ち主の章は 1 本').toBe(CHAPTER_OWNERS.length);
  });
});

describe('planEntryInputs: 入力の状態から止める章を決める', () => {
  it('読込済み(0 件の空も含む)は計画に載らない。実行する', () => {
    expect(planEntryInputs(states({}), roots)).toEqual({ blocked: [], unselected: [], notAdopted: [], stoppedChapters: [] });
  });

  it('阻害した種類は理由と止める章を持ち、その持ち主の章を出力から落とす。持ち主の章が無い種類は章を止めない', () => {
    const plan = planEntryInputs(states({ jobs: blocked('missing'), queries: blocked('invalid') }), roots);
    expect(plan.blocked).toEqual([
      { kind: 'queries', reason: 'invalid', stopped: [] },
      { kind: 'jobs', reason: 'missing', stopped: [bookFile(roots, 'jobs.html')] },
    ]);
    expect(plan.stoppedChapters).toEqual(['jobs.html']);
  });

  it('未選択は持ち主の章を出力から落とす(置き場に仕様が残っていても書かない)。持ち主の章のある種類は章を持ち、無い種類も採っていない種類として持つ', () => {
    const plan = planEntryInputs(states({ config: unselected, surface: unselected }), roots);
    expect(plan.unselected).toEqual([{ kind: 'config', chapter: bookFile(roots, 'config.html') }]);
    expect(plan.notAdopted).toEqual(['config', 'surface']);
    expect(plan.blocked).toEqual([]);
    expect(plan.stoppedChapters).toEqual(['config.html']);
  });

  it('阻害と未選択が混ざっても、止める章は両方の持ち主(重複なし)。読込済みの種類の章は止めない', () => {
    const plan = planEntryInputs(states({ jobs: blocked('missing'), config: unselected, auth: unselected }), roots);
    expect([...plan.stoppedChapters].sort()).toEqual(['auth.html', 'config.html', 'jobs.html']);
    expect(plan.stoppedChapters).not.toContain('actions.html');
  });

  it('阻害の理由は 4 通りとも保つ', () => {
    for (const reason of ['not-loaded', 'missing', 'load-failed', 'invalid'] as const) {
      expect(planEntryInputs(states({ auth: blocked(reason) }), roots).blocked[0]?.reason).toBe(reason);
    }
  });
});

describe('staleChapters: 出力先に残っている、この実行では生成していない章', () => {
  const plan = planEntryInputs(states({ jobs: blocked('missing'), config: unselected, data_tables: unselected }), roots);

  it('止めた章(阻害)は、出力先にあれば名指す。無ければ言わない', () => {
    expect(staleChapters(plan, () => false)).toEqual([]);
    expect(staleChapters(plan, (file) => file === bookFile(roots, 'jobs.html'))).toEqual([bookFile(roots, 'jobs.html')]);
  });

  it('採っていない種類の章も、今回は書かないので、出力先にあれば名指す。昇順・重複なし', () => {
    expect(staleChapters(plan, () => true)).toEqual([bookFile(roots, 'config.html'), bookFile(roots, 'data.html'), bookFile(roots, 'jobs.html')]);
    expect(staleChapters(plan, (file) => file === bookFile(roots, 'config.html'))).toEqual([bookFile(roots, 'config.html')]);
  });

  it('読込済みの種類の章は、出力先にあっても古いとは言わない(この実行で生成する)', () => {
    expect(staleChapters(planEntryInputs(states({}), roots), () => true)).toEqual([]);
  });
});

describe('withoutStoppedChapters: 止めた章のファイルを出力から落とす', () => {
  const section = (content: string): readonly FileSection[] => [{ content, wholeFile: true }];
  const search = `[\n${[
    { href: 'index.html', page: '表紙', heading: '表紙', text: 'a' },
    { href: 'jobs.html', page: 'ジョブ', heading: 'ジョブ', text: 'b' },
    { href: 'jobs.html#x', page: 'ジョブ', heading: '節', text: 'c' },
    { href: 'config.html#y', page: '設定', heading: '節', text: 'd' },
  ]
    .map((item) => JSON.stringify(item))
    .join(',\n')}\n]\n`;
  const byFile = new Map<string, readonly FileSection[]>([
    [bookFile(roots, 'index.html'), section('表紙')],
    [bookFile(roots, 'jobs.html'), section('ジョブ')],
    [bookFile(roots, 'config.html'), section('設定')],
    [bookFile(roots, 'assets/search.json'), section(search)],
  ]);

  it('阻害・未選択の種類の持ち主の章を落とす。ほかの章・部品は同じ並びで残る', () => {
    const plan = planEntryInputs(states({ jobs: blocked('missing'), config: unselected }), roots);
    expect([...withoutStoppedChapters(byFile, plan, roots).keys()]).toEqual([bookFile(roots, 'index.html'), bookFile(roots, 'assets/search.json')]);
  });

  it('検索の索引からも、止めた章の件(ページの頭・節)を落とす。止めていない章の件は残る', () => {
    const plan = planEntryInputs(states({ jobs: blocked('missing') }), roots);
    const kept = withoutStoppedChapters(byFile, plan, roots).get(bookFile(roots, 'assets/search.json'))?.[0]?.content ?? '';
    expect((JSON.parse(kept) as { href: string }[]).map((item) => item.href)).toEqual(['index.html', 'config.html#y']);
  });

  it('止める章が無ければ出力はそのまま', () => {
    expect(withoutStoppedChapters(byFile, planEntryInputs(states({}), roots), roots)).toEqual(byFile);
  });
});

describe('partitionPlacementProblems: 標識が章に出ていない問題のうち、阻害した種類のものを分ける', () => {
  const plan = planEntryInputs(states({ jobs: blocked('load-failed'), queries: blocked('invalid') }), roots);
  const jobsFile = specPath(roots, 'backend/jobs.md');
  const queryFile = specPath(roots, 'backend/queries/item/item_list.md');
  const authFile = specPath(roots, 'backend/auth.md');

  it('阻害した種類の置き場の下(カタログ 1 枚・ディレクトリの中)のファイルは分け、それ以外は生成を止める側に残す', () => {
    const problems = [jobsFile, queryFile, authFile, `${jobsFile}.bak`].map((file) => ({ file }));
    const split = partitionPlacementProblems(problems, plan, roots);
    expect(split.ofBlocked.map((problem) => problem.file)).toEqual([jobsFile, queryFile]);
    expect(split.hard.map((problem) => problem.file)).toEqual([authFile, `${jobsFile}.bak`]);
  });

  it('採っていない種類は分けない(置き場の仕様は生テキストを読まないので、ここには来ない。来たなら生成を止める側に残す)', () => {
    const unselectedPlan = planEntryInputs(states({ jobs: unselected, queries: unselected }), roots);
    const split = partitionPlacementProblems([jobsFile, queryFile, authFile].map((file) => ({ file })), unselectedPlan, roots);
    expect(split.ofBlocked).toEqual([]);
    expect(split.hard.map((problem) => problem.file)).toEqual([jobsFile, queryFile, authFile]);
  });

  it('阻害が無ければ全部を生成を止める側に残す(従来の generate と同じ)', () => {
    const split = partitionPlacementProblems([{ file: jobsFile }], planEntryInputs(states({}), roots), roots);
    expect(split).toEqual({ hard: [{ file: jobsFile }], ofBlocked: [] });
  });
});

describe('unreadPlaces: 仕様の生テキストを読まない置き場 = 採っていない種類の置き場', () => {
  it('採っていない種類の置き場(持ち主の章が無い種類・置き場の候補が複数の種類も)だけを返す。阻害した種類・読込済みは含めない', () => {
    const plan = planEntryInputs(states({ jobs: unselected, screens: unselected, surface: unselected, auth: blocked('missing') }), roots);
    expect(unreadPlaces(plan, roots)).toEqual([
      specPath(roots, 'backend/jobs.md'),
      specPath(roots, 'backend/surface.md'),
      specPath(roots, 'frontend/screens'),
      specPath(roots, 'frontend/chrome'),
    ]);
  });

  it('採っていない種類が無ければ空(全部読む)', () => {
    expect(unreadPlaces(planEntryInputs(states({ jobs: blocked('missing') }), roots), roots)).toEqual([]);
  });
});

/** 実装の木の有無だけを変えて使う、最小の製品の根。 */
function rootsOf(app: string): ProductRoots {
  return { name: 'sample', specs: 'docs/specs', book: 'docs/book', generated: 'app/src/domain/generated', migrations: 'supabase/migrations', app, knowledge: null, previews: null, termScan: NO_TERM_SCAN };
}
