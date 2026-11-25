/**
 * ハンドブックの章立てモデル(render/book/chapters.ts)のテスト。
 *
 * 章の並び・仕様ファイル → 章の割り付け・相対リンクの解決(docs/ の中で閉じる)・
 * 標識の引用・章ごとの集計(ラベル合算)を検める。割り付けと集計は
 * レビューの手引きと各章の標識引用の両方が乗る土台なので、ここで固定する。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  aggregateTitle,
  bookChapters,
  

  relativeHref,
  signpostQuotes,
} from '../../../../../lib/generate/render/book/chapters.js';
import { blockOf } from '../../../../../lib/generate/render/book/chapter-files.js';
import { chapterLoads } from '../../../../../lib/generate/render/book/chapter-loads.js';
import { GEN_CTX } from '../../../../helpers/generate-context.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../../helpers/platform.js';
import { sourceRootPath } from '../../../../../lib/model/product/layout.js';

describe('bookChapters: 章の並び', () => {
  it('集約の章(モデル順)→ 画面 → 可視性 → デザインの順に並ぶ', () => {
    const chapters = bookChapters(bookModel(), bookCtx());

    expect(chapters.map((chapter) => chapter.file)).toEqual([
      'docs/book/domain/workshop.md',
      'docs/book/domain/member.md',
      'docs/book/screens.md',
      'docs/book/visibility.md',
      'docs/book/actions.md',
      'docs/book/sweep.md',
      'docs/book/design.md',
    ]);
  });

  it('テーブル仕様の置き場を読めている環境では「データの置き場」の章を立てる(デザインの次)', () => {
    const chapters = bookChapters(bookModel(), { ...bookCtx(), dataTables: { available: true, tables: [] } });
    const files = chapters.map((chapter) => chapter.file);

    expect(files.indexOf('docs/book/data.md')).toBe(files.indexOf('docs/book/design.md') + 1);
    expect(bookChapters(bookModel(), bookCtx()).map((chapter) => chapter.file)).not.toContain('docs/book/data.md');
  });

  it('「書き方の例」は、印が実際に置かれているリポジトリでだけ章に並ぶ', () => {
    // 判定の材料は宣言ではなく**走査**である —— 生成対象のリポジトリの実装の木・migration の置き場・
    // 仕様の木に印(`#region example:`)があるか(束 ⑲-3)。実リポジトリ全体を歩くと遅く、並列の負荷で
    // テストの制限時間を超えるので、**印を 1 つだけ持つ小さな木**を一時に組んで渡す(遅い原因を消す)。
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'book-chapters-'));
    try {
      const marked = path.join(repoRoot, sourceRootPath(TEST_LAYOUT, TEST_ROOTS) ?? '', 'marked.ts');
      mkdirSync(path.dirname(marked), { recursive: true });
      writeFileSync(marked, ['// #region example:sample', 'const x = 1;', '// #endregion', ''].join('\n'));

      const chapters = bookChapters(bookModel(), { ...bookCtx(), repoRoot });

      expect(chapters.map((chapter) => chapter.file)).toContain('docs/book/examples.md');
      expect(bookChapters(bookModel(), bookCtx()).map((chapter) => chapter.file)).not.toContain(
        'docs/book/examples.md',
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('screen / design が読めていない環境では、その章を立てない(可視性は常にある)', () => {
    const chapters = bookChapters(bookModel(), GEN_CTX);

    expect(chapters.map((chapter) => chapter.file)).toEqual([
      'docs/book/domain/workshop.md',
      'docs/book/domain/member.md',
      'docs/book/visibility.md',
    ]);
  });
});

describe('aggregateTitle: 集約の章題', () => {
  it('label があれば内部名に丸括弧で併記し、無ければ内部名だけにする', () => {
    expect(aggregateTitle('workshop', '催し')).toBe('集約 workshop(催し)');
    expect(aggregateTitle('program', undefined)).toBe('集約 program');
  });

  it('章立ての表題は entity_spec の label を引く(表紙のリンク文言と章の見出しが同じ写像)', () => {
    const titles = bookChapters(bookModel(), bookCtx()).map((chapter) => chapter.title);

    // book-fixture の集約は label を宣言していないので、従来どおり内部名だけになる。
    expect(titles.slice(0, 2)).toEqual(['集約 workshop', '集約 member']);
  });
});

describe('blockOf: 仕様ファイル → 章の割り付け', () => {
  const model = bookModel();
  const chapterFileOf = (file: string, m: typeof model, roots: typeof TEST_ROOTS): string | null => blockOf(file, m, roots)?.chapter ?? null;

  it('ドメイン仕様と action_spec は集約の章、query は可視性、screen/chrome は画面、design はデザイン', () => {
    expect(chapterFileOf('docs/specs/domain/workshop/states.md', model, TEST_ROOTS)).toBe('docs/book/domain/workshop.md');
    expect(chapterFileOf('docs/specs/backend/actions/workshop/publish.md', model, TEST_ROOTS)).toBe(
      'docs/book/domain/workshop.md',
    );
    expect(chapterFileOf('docs/specs/backend/queries/workshop/workshop_list.md', model, TEST_ROOTS)).toBe(
      'docs/book/visibility.md',
    );
    expect(chapterFileOf('docs/specs/frontend/screens/workshop/workshop_detail.md', model, TEST_ROOTS)).toBe(
      'docs/book/screens.md',
    );
    expect(chapterFileOf('docs/specs/frontend/chrome/main.md', model, TEST_ROOTS)).toBe('docs/book/screens.md');
    expect(chapterFileOf('docs/specs/frontend/design/tokens.md', model, TEST_ROOTS)).toBe('docs/book/design.md');
  });

  it('未知のパスと、どの集約にも引き当てられない action ディレクトリは null', () => {
    expect(chapterFileOf('docs/rules/README.md', model, TEST_ROOTS)).toBeNull();
    expect(chapterFileOf('docs/specs/backend/actions/unknown_entity/create.md', model, TEST_ROOTS)).toBeNull();
  });
});

describe('relativeHref: docs/ の中で閉じる相対リンク', () => {
  it('入れ子の章ページからは ../ を重ねて specs へ辿る(リポジトリルートへは出ない)', () => {
    expect(relativeHref('docs/book/domain/workshop.md', 'docs/specs/domain/workshop/access.md')).toBe(
      '../../specs/domain/workshop/access.md',
    );
    expect(relativeHref('docs/book/review-guide.md', 'docs/rules/README.md')).toBe('../rules/README.md');
  });
});

describe('signpostQuotes: 標識の引用', () => {
  it('標識を出典リンクつきの引用ブロックにする(原文のまま)', () => {
    const blocks = signpostQuotes('docs/specs/domain/workshop/access.md', bookCtx(), 'docs/book/domain/workshop.md');

    // 引用の頭の 1 行がブロックの標識の本数を持つ(章の頭の数・手引きの数と同じ集計の写し)。
    expect(blocks[0]).toContain('**標識 1 本** — [domain/workshop/access.md](../../specs/domain/workshop/access.md)');
    expect(blocks[1]).toBe('> 下書きも意図的に全公開とする。');
  });

  it('標識が無いファイル(ソース未提供含む)は空配列(見出しだけの残骸を出さない)', () => {
    expect(signpostQuotes('docs/specs/domain/member/entity.md', bookCtx(), 'docs/book/domain/member.md')).toEqual([]);
  });
});

describe('chapterLoads: 章ごとの判断ポイント集計', () => {
  it('宣言はラベルで合算され、標識の本数も章に載る', () => {
    const loads = chapterLoads(bookModel(), bookCtx());
    const workshop = loads.find((load) => load.chapter.file === 'docs/book/domain/workshop.md');

    expect(workshop).toBeDefined();
    // states: 遷移 2 + guard 1 / access: reads 2(うち all 1)+ writes 1 / invariants: formal 1 + DSL外 1
    expect(workshop?.declBreakdown).toContain('遷移 2');
    expect(workshop?.declBreakdown).toContain('うち scope:all 1');
    expect(workshop?.declBreakdown).toContain('DSL外(テスト義務) 1');
    // 標識 = access.md 1 本 + actions/workshop/publish.md 1 本
    expect(workshop?.signCount).toBe(2);
  });

  it('宣言も標識も無い章は 0 で返る(「流し読みで良い」の判定材料)', () => {
    const loads = chapterLoads(bookModel(), bookCtx());
    const member = loads.find((load) => load.chapter.file === 'docs/book/domain/member.md');

    expect(member?.declCount).toBe(0);
    expect(member?.signCount).toBe(0);
    expect(member?.declBreakdown).toBe('0');
  });
});
