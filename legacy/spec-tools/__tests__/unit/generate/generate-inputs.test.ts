import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadSpecModel } from '../../../lib/model/loader.js';
import { loadProductRoots } from '../../../lib/model/product/loader.js';
import { specPath } from '../../../lib/model/product/paths.js';
import type { ProductUses, SpecKind } from '../../../lib/model/product/uses.js';
import { BOOK_GENERATORS } from '../../../lib/compose/book-generators.js';
import type { FileSection } from '../../../lib/generate/apply-sections.js';
import { planEntryInputs, unreadPlaces, withoutStoppedChapters } from '../../../lib/generate/book-entry-plan.js';
import { completeGenerateContext } from '../../../lib/generate/generate-context.js';
import { inputStatesOf, readEntryInputs, readGenerateInputs, readGenerateInputsWithLoads } from '../../../lib/generate/generate-inputs.js';
import { cleanupTemps, copiedSample } from '../../helpers/book-entry-fixture.js';
import { TEST_LAYOUT, TEST_PLATFORM } from '../../helpers/platform.js';

/**
 * 読み込みの結果を**捨てずに**持ち、生成器へのモデルの投影と入力の状態を分けて返す(外部レビュー の P2:
 * 選択済みの入力の欠落を「材料の種類が無い」に変えない)。使い捨ての製品の写しを実際のローダーで読む。
 */

afterAll(cleanupTemps);

/** 写しを読んで、種類ごとの入力の状態と文脈の投影を返す。`uses` を省けば製品の宣言どおり。 */
function read(root: string, uses?: ProductUses) {
  const declared = loadProductRoots(root);
  if (declared.model.roots === null || declared.uses === null) throw new Error('題材の宣言を読めません');
  const result = readGenerateInputsWithLoads(root, declared.model.roots, TEST_LAYOUT);
  const states = new Map(inputStatesOf(result.loads, uses ?? declared.uses).map(({ kind, input }) => [kind, input]));
  return { ...result, states, roots: declared.model.roots, uses: declared.uses };
}

describe('readGenerateInputsWithLoads: 選択・診断・落とした数を保ち、モデルの投影と分ける', () => {
  it('何も壊れていない題材: 採った種類は読込済みで、採っていない種類は未選択(ファイルの有無から推定しない)', () => {
    const { states, uses } = read(copiedSample('inputs-clean'));
    for (const kind of uses) expect(states.get(kind)?.state, kind).toBe('loaded');
    for (const kind of ['config', 'external', 'ux_principles'] as const) expect(states.get(kind)?.state, kind).toBe('unselected');
  });

  it('jobs を採ったまま jobs.md を消す: 阻害(置き場に無い)。文脈の投影は「jobs が無い」のまま(全部入りの出力はこの投影が決める)', () => {
    const root = copiedSample('inputs-missing');
    rmSync(path.join(root, 'docs/specs/backend/jobs.md'));
    const { states, context } = read(root);
    expect(states.get('jobs')).toEqual({ state: 'blocked', reason: 'missing', findings: [] });
    expect(context.jobs?.available).toBe(false);
  });

  it('jobs を採っておらず jobs.md も無い: 未選択(同じ「無い」でも阻害と区別される)', () => {
    const root = copiedSample('inputs-unselected');
    rmSync(path.join(root, 'docs/specs/backend/jobs.md'));
    const { states } = read(root, ['actions', 'queries']);
    expect(states.get('jobs')?.state).toBe('unselected');
  });

  it('読めない jobs.md: 阻害(読めない・壊れている)。読み込みの診断は捨てずに状態に残る', () => {
    const root = copiedSample('inputs-broken');
    writeFileSync(path.join(root, 'docs/specs/backend/jobs.md'), 'frontmatter が無い\n');
    const jobs = read(root).states.get('jobs');
    expect(jobs?.state === 'blocked' ? jobs.reason : null).toBe('load-failed');
    expect(jobs?.findings.some((finding) => finding.severity === 'error')).toBe(true);
  });

  it('仕様を 1 枚落とした種類(query_spec)は阻害(読めなかった仕様がある)。落とした数と診断は読み込みの結果に残る', () => {
    const root = copiedSample('inputs-dropped');
    writeFileSync(path.join(root, 'docs/specs/backend/queries/item/item_list.md'), 'frontmatter が無い\n');
    const { states, loads } = read(root);
    const queries = states.get('queries');
    expect(queries?.state === 'blocked' ? queries.reason : null).toBe('invalid');
    expect(loads.queries.dropped).toBe(1);
    expect(loads.queries.findings.length).toBeGreaterThan(0);
  });

  it('読めて 0 件(置き場に仕様が 1 枚も無い usecases)は読込済み。0 件を「採っていない」「読めない」に変えない', () => {
    const root = copiedSample('inputs-zero');
    rmSync(path.join(root, 'docs/specs/frontend/usecases/borrow_self.md'));
    rmSync(path.join(root, 'docs/specs/frontend/usecases/hold_and_collect.md'));
    const { states, context } = read(root);
    expect(states.get('usecases')?.state).toBe('loaded');
    expect(context.usecases?.available).toBe(true);
    expect(context.usecases?.usecases).toEqual([]);
  });

  it('全部入りの口 readGenerateInputs は、同じ共有の口の投影そのもの(別の読み込みを持たない)', () => {
    const root = copiedSample('inputs-same');
    const declared = loadProductRoots(root).model.roots;
    if (declared === null) throw new Error('題材の宣言を読めません');
    const full = readGenerateInputs(root, declared, TEST_LAYOUT);
    const shared = readGenerateInputsWithLoads(root, declared, TEST_LAYOUT).context;
    const kinds: readonly (keyof typeof full)[] = ['queries', 'screens', 'design', 'dataTables', 'notifications', 'jobs', 'config', 'auth', 'guarantees', 'uxPrinciples', 'surface', 'external', 'usecases', 'terms', 'actions'];
    for (const key of kinds) expect(full[key], key).toEqual(shared[key]);
  });

  it('全種類に、読み込みの結果がある(閉じた一覧が 1 つも抜けない)', () => {
    const { loads } = read(copiedSample('inputs-all'));
    const kinds: readonly SpecKind[] = ['actions', 'queries', 'data_tables', 'notifications', 'jobs', 'config', 'auth', 'guarantees', 'external', 'surface', 'screens', 'usecases', 'ux_principles', 'design_tokens'];
    expect(Object.keys(loads).sort()).toEqual([...kinds].sort());
  });
});

describe('readEntryInputs: ハンドブックだけを出す入口の投影(採った種類だけを読む。全部入りの口は変えない)', () => {
  /** 製品が採ると宣言した種類から `jobs` を外した `uses`(有効な jobs.md は置き場に残す)。 */
  function withoutJobs(label: string) {
    const root = copiedSample(label);
    const declared = loadProductRoots(root);
    if (declared.model.roots === null || declared.uses === null) throw new Error('題材の宣言を読めません');
    return { root, roots: declared.model.roots, uses: declared.uses.filter((kind) => kind !== 'jobs') };
  }

  it('採っていない種類は、置き場に有効な仕様が残っていても読まない(「置き場が無い」の結果)。全部入りの口は同じ置き場を読む(契約は変えない)', () => {
    const { root, roots, uses } = withoutJobs('entry-unselected');
    expect(readGenerateInputs(root, roots, TEST_LAYOUT).jobs?.available).toBe(true);
    const entry = readEntryInputs(root, roots, uses, TEST_LAYOUT);
    expect(entry.context.jobs).toEqual({ available: false, catalog: null });
    expect(entry.loads.jobs.model.available).toBe(false);
    expect(new Map(inputStatesOf(entry.loads, uses).map(({ kind, input }) => [kind, input.state])).get('jobs')).toBe('unselected');
  });

  it('材料に混ざらない: 有効な jobs.md を残しても消しても、入口の投影は同じ(種類横断の章が読む全部の欄が一致する)', () => {
    const kept = withoutJobs('entry-kept');
    const gone = withoutJobs('entry-gone');
    rmSync(path.join(gone.root, 'docs/specs/backend/jobs.md'));
    const a = readEntryInputs(kept.root, kept.roots, kept.uses, TEST_LAYOUT).context;
    const b = readEntryInputs(gone.root, gone.roots, gone.uses, TEST_LAYOUT).context;
    const { guards: _guardsA, repoRoot: _rootA, ...restA } = a;
    const { guards: _guardsB, repoRoot: _rootB, ...restB } = b;
    expect(restA).toEqual(restB);
  });

  it('採った種類の読み方は全部入りの口と同じ(採っている種類の投影は 1 つも違わない。壊れていても同じ診断・同じ落とした数)', () => {
    const root = copiedSample('entry-selected');
    writeFileSync(path.join(root, 'docs/specs/backend/queries/item/item_list.md'), 'frontmatter が無い\n');
    const declared = loadProductRoots(root);
    if (declared.model.roots === null || declared.uses === null) throw new Error('題材の宣言を読めません');
    const full = readGenerateInputsWithLoads(root, declared.model.roots, TEST_LAYOUT);
    const entry = readEntryInputs(root, declared.model.roots, declared.uses, TEST_LAYOUT);
    for (const kind of declared.uses) {
      expect(entry.loads[kind].model, kind).toEqual(full.loads[kind].model);
      expect(entry.loads[kind].dropped, kind).toBe(full.loads[kind].dropped);
      expect(entry.loads[kind].findings.map((finding) => finding.message), kind).toEqual(full.loads[kind].findings.map((finding) => finding.message));
    }
    expect(entry.loads.queries.dropped).toBe(1);
  });

  it('採っていない種類がすべて(uses が空)でも、投影は全部「置き場が無い」になり、採った種類の欄だけが残る', () => {
    const root = copiedSample('entry-none');
    const declared = loadProductRoots(root);
    if (declared.model.roots === null) throw new Error('題材の宣言を読めません');
    const entry = readEntryInputs(root, declared.model.roots, [], TEST_LAYOUT);
    expect(entry.context.jobs?.available).toBe(false);
    expect(entry.context.screens?.available).toBe(false);
    expect(entry.context.queries?.available).toBe(false);
    expect(entry.context.actions).toBeUndefined();
  });
});

describe('readEntryInputs: 採っていない種類は予約の名前の置き場を読みに行かない(ファイルの I/O なしで「置き場が無い」の値を作る)', () => {
  /** 前に採っていない種類の読み先にしていた名前(いまは使わない)。ここに有効な仕様が置かれても、読まれてはならない。 */
  const FORMER_RESERVED = '.kind-not-adopted';

  /** 何も採らない製品の写し(全種類が未選択)に、元の予約の名前で有効な仕様を置く(`planted`)か置かない。 */
  function noneAdopted(label: string, plant?: (root: string, place: string) => void) {
    const root = copiedSample(label);
    const declared = loadProductRoots(root);
    if (declared.model.roots === null) throw new Error('題材の宣言を読めません');
    const roots = declared.model.roots;
    const place = path.join(root, specPath(roots, FORMER_RESERVED));
    plant?.(root, place);
    const uses: ProductUses = [];
    const read = readEntryInputs(root, roots, uses, TEST_LAYOUT);
    const plan = planEntryInputs(inputStatesOf(read.loads, uses), roots);
    const model = loadSpecModel(path.join(root, specPath(roots, 'domain'))).model;
    if (model === null) throw new Error('ドメイン仕様を読めません');
    const ctx = completeGenerateContext(root, roots, TEST_PLATFORM, TEST_LAYOUT, model, read.context, null, null, undefined, undefined, unreadPlaces(plan, roots));
    // 本の全ファイル(生成器が出す全セクション。止める章は落とす)。
    const sections = new Map<string, readonly FileSection[]>();
    for (const generator of BOOK_GENERATORS) {
      for (const section of generator.generate(model, ctx)) sections.set(section.file, [...(sections.get(section.file) ?? []), section]);
    }
    const book = new Map([...withoutStoppedChapters(sections, plan, roots)].map(([file, list]) => [file, list.map((section) => section.content).join('')] as const));
    const { guards: _guards, repoRoot: _repoRoot, ...projection } = read.context;
    return { projection, loads: read.loads, book };
  }

  /** 有効な仕様をファイルとして置く(ファイルの種類のローダーが読みうる形)。 */
  const plantFile = (root: string, place: string): void => {
    cpSync(path.join(root, 'docs/specs/backend/jobs.md'), place);
  };
  /** 有効な仕様をディレクトリとして置く(ディレクトリの種類のローダーが読みうる形)。 */
  const plantDirectory = (root: string, place: string): void => {
    mkdirSync(place, { recursive: true });
    cpSync(path.join(root, 'docs/specs/backend/queries'), place, { recursive: true });
    cpSync(path.join(root, 'docs/specs/frontend/screens'), path.join(place, 'screens'), { recursive: true });
    cpSync(path.join(root, 'docs/specs/frontend/usecases'), path.join(place, 'usecases'), { recursive: true });
  };

  it('予約の名前に有効な仕様(ファイル / ディレクトリ)があっても、投影・読み込みの結果・本の全ファイルが、無いときと 1 バイトも違わない', () => {
    const clean = noneAdopted('reserved-clean');
    expect(clean.book.size, '比較の対象(本のファイル)が空でない').toBeGreaterThan(5);
    for (const [label, plant] of [['file', plantFile], ['directory', plantDirectory]] as const) {
      const planted = noneAdopted(`reserved-${label}`, plant);
      expect(planted.projection, label).toEqual(clean.projection);
      expect(planted.loads, label).toEqual(clean.loads);
      expect([...planted.book.keys()], label).toEqual([...clean.book.keys()]);
      for (const [file, content] of clean.book) expect(planted.book.get(file), `${label}: ${file}`).toBe(content);
    }
  });
});

describe('readGenerateInputsWithLoads: 仕組みの保証台帳は製品の保証台帳の有無・採る種類に依らず読む', () => {
  const FRAMEWORK_ROOT = path.resolve(import.meta.dirname, '../../../../..');

  function readWith(root: string, frameworkRoot?: string) {
    const declared = loadProductRoots(root);
    if (declared.model.roots === null) throw new Error('題材の宣言を読めません');
    return readGenerateInputsWithLoads(root, declared.model.roots, TEST_LAYOUT, frameworkRoot === undefined ? {} : { frameworkRoot });
  }

  it('根を渡すと、製品の保証台帳を消した題材でも仕組みの台帳を読む(自分の木ではない)', () => {
    const root = copiedSample('inputs-framework-ledger');
    rmSync(path.join(root, 'docs/specs/backend/guarantees.md'));

    const { context } = readWith(root, FRAMEWORK_ROOT);

    expect(context.guarantees?.available).toBe(false);
    expect(context.frameworkLedger?.load.state).toBe('loaded');
    expect(context.frameworkLedger?.ownTree).toBe(false);
  });

  it('生成の対象の木が根と同じなら ownTree(台帳に書いてよい)', () => {
    const { context } = readWith(FRAMEWORK_ROOT, FRAMEWORK_ROOT);

    expect(context.frameworkLedger?.ownTree).toBe(true);
  });

  it('根の下に台帳が無ければ阻害で渡す(投げない)。根を渡さなければ何も足さない', () => {
    const root = copiedSample('inputs-framework-missing');

    expect(readWith(root, root).context.frameworkLedger?.load.state).toBe('blocked');
    expect('frameworkLedger' in readWith(root).context).toBe(false);
  });
});
