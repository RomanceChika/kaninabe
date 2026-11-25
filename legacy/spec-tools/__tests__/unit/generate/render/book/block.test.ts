/**
 * ブロック(章の節 × 仕様ファイル)の割り付け・集計・置き場の検査のテスト。
 *
 * 標識と判断ポイントを数える単位は `blockOf` 1 つで、章の合計・各章の頭の 1 行・手引きの数は
 * 同じ集計から出る。標識を持つのにどのブロックにも属さないファイルと、属していても章が引用を
 * 出していないファイルは `generate` のエラーになる(「未参照の印」と同じ形)。
 */

import { describe, expect, it } from 'vitest';

import { blockProblems, exemptionSummary, htmlPageOf, placementProblemsOf } from '../../../../../lib/generate/render/book/block-check.js';
import { blockLoads } from '../../../../../lib/generate/render/book/block-loads.js';
import { signMarkerTag } from '../../../../../lib/generate/render/book/html/layer-chapter.js';
import { blockOf, exemptionOf, signHostOf } from '../../../../../lib/generate/render/book/chapter-files.js';
import { chapterLoads } from '../../../../../lib/generate/render/book/chapter-loads.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

/** 標識を 1 本だけ持つ仕様ファイルの生テキスト。 */
const withSign = (docType: string, sign = '手書きの判断。'): string =>
  ['---', `doc_type: ${docType}`, '---', '', sign, ''].join('\n');

describe('signHostOf: 標識が付く仕様の種類(公理の注記か、受け入れの判断の記録かを決める)', () => {
  const model = bookModel();
  const host = (file: string) => signHostOf(file, model, TEST_ROOTS);

  it('ドメインの 4 ファイルとロールは公理を宣言する側、操作・表・タスク・カタログなどは導出の置き場', () => {
    expect(host('docs/specs/domain/workshop/entity.md')).toBe('entity');
    expect(host('docs/specs/domain/workshop/states.md')).toBe('states');
    expect(host('docs/specs/domain/workshop/access.md')).toBe('access');
    expect(host('docs/specs/domain/workshop/invariants.md')).toBe('invariants');
    expect(host('docs/specs/domain/roles.md')).toBe('roles');
    expect(host('docs/specs/backend/actions/workshop/publish.md')).toBe('action');
    expect(host('docs/specs/backend/data/tables/workshops.md')).toBe('table');
    expect(host('docs/specs/frontend/usecases/x.md')).toBe('usecase');
    expect(host('docs/specs/backend/queries/q.md')).toBe('query');
    expect(host('docs/specs/backend/surface.md')).toBe('surface');
    expect(host('docs/specs/backend/jobs.md')).toBe('catalog');
    // 通知はカタログのうち、読み手が業務のものなので、置き場を分ける(ほかのカタログは開発者)。
    expect(host('docs/specs/backend/notifications.md')).toBe('notice');
    expect(host('docs/specs/frontend/screens/s.md')).toBe('screen');
    expect(host('docs/specs/frontend/design/tokens.md')).toBe('design');
  });

  it('ブロックに割り付けられないファイルは null(標識の置き場の検査が止める側)', () => {
    expect(host('docs/specs/unknown/x.md')).toBeNull();
  });
});

describe('blockOf: 仕様ファイル → ブロック(章と節)', () => {
  const model = bookModel();
  const at = (file: string) => blockOf(file, model, TEST_ROOTS);

  it('集約のディレクトリの 4 ファイルはそれぞれの節、action_spec は操作の節になる', () => {
    expect(at('docs/specs/domain/workshop/entity.md')).toEqual({ chapter: 'docs/book/domain/workshop.md', section: '章の頭' });
    expect(at('docs/specs/domain/workshop/states.md')?.section).toBe('ライフサイクル(状態機械)');
    expect(at('docs/specs/domain/workshop/access.md')?.section).toBe('誰に見えるか');
    expect(at('docs/specs/domain/workshop/invariants.md')?.section).toBe('破ってはいけないこと(不変条件)');
    expect(at('docs/specs/backend/actions/workshop/publish.md')).toEqual({
      chapter: 'docs/book/domain/workshop.md',
      section: '操作 — 誰が、いつ、何をできるか',
    });
  });

  it('これまで章の無かったファイル(テーブル仕様・ロール・外から届く surface・ユースケース)にも割り付く', () => {
    expect(at('docs/specs/backend/data/tables/workshops.md')).toEqual({ chapter: 'docs/book/data.md', section: 'テーブル仕様' });
    expect(at('docs/specs/domain/roles.md')).toEqual({ chapter: 'docs/book/visibility.md', section: '誰がいるか(ロール)' });
    expect(at('docs/specs/backend/surface.md')).toEqual({ chapter: 'docs/book/visibility.md', section: '外から届く surface(SQL の公開面)' });
    expect(at('docs/specs/frontend/usecases/entry_self.md')).toEqual({
      chapter: 'docs/book/usecases.md',
      section: 'タスクごとの節',
    });
    expect(at('docs/specs/backend/queries/workshop/workshop_list.md')?.section).toBe('読み取り経路(query)');
  });

  it('カタログ・画面・デザインは章末の節になる', () => {
    expect(at('docs/specs/backend/notifications.md')).toEqual({ chapter: 'docs/book/notifications.md', section: '章末' });
    expect(at('docs/specs/frontend/chrome/main.md')).toEqual({ chapter: 'docs/book/screens.md', section: '章末' });
    expect(at('docs/specs/frontend/design/tokens.md')).toEqual({ chapter: 'docs/book/design.md', section: '章末' });
  });

  it('集約のディレクトリ直下の未知のファイル・引き当てられない action・未知のパスは null', () => {
    expect(at('docs/specs/domain/workshop/notes.md')).toBeNull();
    expect(at('docs/specs/domain/workshop/deep/entity.md')).toBeNull();
    expect(at('docs/specs/backend/actions/unknown_entity/create.md')).toBeNull();
    expect(at('docs/rules/README.md')).toBeNull();
  });
});

describe('exemptionOf: 標識を数える母集合から外すと宣言したファイル', () => {
  it('案内文書・雛形・用語の台帳だけが、理由つきで外れる(名前と doc_type で決まる)', () => {
    expect(exemptionOf('docs/specs/README.md', withSign('directory_guide'))).toContain('案内文書');
    expect(exemptionOf('docs/specs/backend/queries/template.query_spec.md', '')).toContain('雛形');
    expect(exemptionOf('docs/specs/anything.md', withSign('directory_guide'))).toContain('案内文書');
    expect(exemptionOf('docs/specs/terms.md', withSign('term_ledger'))).toContain('用語の台帳');
  });

  it('README という名前だけでは外れない(doc_type が無い案内は、標識があればエラーで見える)', () => {
    expect(exemptionOf('docs/specs/README.md', '')).toBeNull();
    expect(exemptionOf('docs/specs/README.md', withSign('state_spec'))).toBeNull();
  });

  it('外した種類ごとの枚数と標識の本数を、generate の出力 1 行にする', () => {
    const line = exemptionSummary(ctxWithRecovered());

    expect(line).toContain('案内文書 1 枚・標識 1 本');
    expect(line).toContain('雛形 1 枚・標識 1 本');
    expect(line).toContain('用語の台帳 0 枚・標識 0 本');
  });

  it('仕様のファイルは外れない', () => {
    expect(exemptionOf('docs/specs/domain/workshop/states.md', withSign('state_spec'))).toBeNull();
    expect(exemptionOf('docs/specs/backend/data/tables/workshops.md', withSign('data_table'))).toBeNull();
  });
});

/** 標識を持つファイルを足した文脈(テーブル仕様・ロール・面・ユースケース・案内・雛形)。 */
function ctxWithRecovered() {
  const base = bookCtx();
  return {
    ...base,
    dataTables: { available: true, tables: [] },
    specSources: new Map<string, string>([
      ...(base.specSources ?? []),
      ['docs/specs/backend/data/tables/workshops.md', withSign('data_table', '- 索引を 1 本に絞った。')],
      ['docs/specs/domain/roles.md', withSign('role_spec', '- 上位のロールは作らない。')],
      ['docs/specs/backend/surface.md', withSign('surface_spec')],
      ['docs/specs/frontend/usecases/entry_self.md', withSign('usecase_spec')],
      ['docs/specs/frontend/usecases/entry_self2.md', withSign('usecase_spec')],
      ['docs/specs/README.md', withSign('directory_guide', '案内の文。')],
      ['docs/specs/backend/template.job_spec.md', withSign('job_spec', '雛形の説明。')],
    ]),
  };
}

describe('blockLoads: 標識と判断ポイントの集計(母集合は 1 つ)', () => {
  it('台帳に載らず標識だけを持つファイル(テーブル仕様・ロール・面・ユースケース)も数える', () => {
    const loads = blockLoads(bookModel(), ctxWithRecovered());
    const sign = (file: string) => loads.find((load) => load.file === file)?.signCount;

    expect(sign('docs/specs/backend/data/tables/workshops.md')).toBe(1);
    expect(sign('docs/specs/domain/roles.md')).toBe(1);
    expect(sign('docs/specs/backend/surface.md')).toBe(1);
    expect(sign('docs/specs/frontend/usecases/entry_self.md')).toBe(1);
    // 判断ポイントは宣言から数えるので、台帳に載らないファイルは 0。
    expect(loads.find((load) => load.file === 'docs/specs/backend/surface.md')?.declCount).toBe(0);
  });

  it('母集合から外すと宣言したファイル(案内・雛形)は数えない', () => {
    const files = blockLoads(bookModel(), ctxWithRecovered()).map((load) => load.file);

    expect(files).not.toContain('docs/specs/README.md');
    expect(files).not.toContain('docs/specs/backend/template.job_spec.md');
  });

  it('章の合計はブロックの合計と一致する(同じ集計から出る)', () => {
    const ctx = ctxWithRecovered();
    const blocks = blockLoads(bookModel(), ctx);
    for (const load of chapterLoads(bookModel(), ctx)) {
      const own = blocks.filter((block) => block.chapter === load.chapter.file);
      expect(load.signCount).toBe(own.reduce((sum, block) => sum + block.signCount, 0));
      expect(load.declCount).toBe(own.reduce((sum, block) => sum + block.declCount, 0));
    }
    // 回収したファイルが章の合計に載る。
    const visibility = chapterLoads(bookModel(), ctx).find((load) => load.chapter.file === 'docs/book/visibility.md');
    expect(visibility?.signCount).toBe(2);
    const data = chapterLoads(bookModel(), ctx).find((load) => load.chapter.file === 'docs/book/data.md');
    expect(data?.signCount).toBe(1);
  });
});

describe('blockProblems: どのブロックにも属さない標識・章が出していない標識', () => {
  const model = bookModel();

  /** 割り付け先の章がブロックの引用を出している状態の章の本文。 */
  function placedChapters(ctx: ReturnType<typeof ctxWithRecovered>): Map<string, string> {
    const chapters = new Map<string, string>();
    for (const load of blockLoads(model, ctx)) {
      if (load.file === null || load.signCount === 0) continue;
      const page = htmlPageOf(load.chapter);
      chapters.set(page, `${chapters.get(page) ?? ''}\n${signMarkerTag(load.file, load.signCount)}`);
    }
    return chapters;
  }

  it('すべて割り付いて章も引用を出していれば 0 件(案内・雛形は数えない)', () => {
    const ctx = ctxWithRecovered();

    expect(blockProblems(model, ctx, placedChapters(ctx))).toEqual([]);
  });

  it('標識を持つのにどのブロックにも属さないファイルを名指しする', () => {
    const base = ctxWithRecovered();
    const ctx = {
      ...base,
      specSources: new Map([...(base.specSources ?? []), ['docs/specs/domain/workshop/notes.md', withSign('note')]]),
    };
    const problems = blockProblems(model, ctx, placedChapters(base));

    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe('docs/specs/domain/workshop/notes.md');
    expect(problems[0]?.message).toContain('どのブロックにも属していません');
  });

  it('標識を持たない未知のファイルは鳴らない(判断が落ちていない)', () => {
    const base = ctxWithRecovered();
    const ctx = {
      ...base,
      specSources: new Map([...(base.specSources ?? []), ['docs/specs/domain/workshop/notes.md', '---\ndoc_type: note\n---\n']]),
    };

    expect(blockProblems(model, ctx, placedChapters(base))).toEqual([]);
  });

  it('割り付け先の章が引用を出していなければ、章と節を示して鳴る', () => {
    const ctx = ctxWithRecovered();
    const chapters = placedChapters(ctx);
    chapters.delete('docs/book/data.html');
    const problems = blockProblems(model, ctx, chapters);

    expect(problems.map((problem) => problem.file)).toEqual(['docs/specs/backend/data/tables/workshops.md']);
    expect(problems[0]?.message).toContain('docs/book/data.html');
    expect(problems[0]?.message).toContain('テーブル仕様');
  });
});

describe('placementProblemsOf: 全セクションから章の本文だけを集めて検査する(CLI と通し実行の共通の入口)', () => {
  const model = bookModel();

  it('全体を生成するセクション(章)だけが引用の有無の目に入り、ブロック内の差し込みは数えない', () => {
    const ctx = ctxWithRecovered();
    const file = 'docs/book/data.html';
    const lead = signMarkerTag('docs/specs/backend/data/tables/workshops.md', 1);
    const section = (wholeFile: boolean, content: string) => ({ content, wholeFile });
    const fromWhole = placementProblemsOf(new Map([[file, [section(true, lead)]]]), model, ctx);
    const fromPartial = placementProblemsOf(new Map([[file, [section(false, lead)]]]), model, ctx);

    // 引用を出していない他の章の問題は両方に出る。差は data.html のテーブル仕様の標識だけ。
    const tableFile = 'docs/specs/backend/data/tables/workshops.md';
    expect(fromWhole.map((problem) => problem.file)).not.toContain(tableFile);
    expect(fromPartial.map((problem) => problem.file)).toContain(tableFile);
  });
});
