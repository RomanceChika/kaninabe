/**
 * 「UX 原則」の章(HTML の本。render/book/html/ux-principles-chapter.ts)のユニットテスト。
 *
 * 生成は情報を足さない(台帳と各画面の `ux:` の写し)。ここで固定するのは:
 *   - 台帳が無ければ何も生成しない
 *   - 原則の表(見張る検査・閾値・advisory の言い回し)
 *   - 画面ごとの受け入れの表(理由つき・対象の言い回し・件数)と、受け入れが 0 件のときの文
 *   - 章が章立て(design グループ)に載り、精読不要の宣言を持たないこと(判断ポイント = 受け入れの件数)
 *   - 台帳の行が受け入れの件数を判断ポイントに数えること
 */

import { describe, expect, it } from 'vitest';
import { bookChapters } from '../../../../../lib/generate/render/book/chapters.js';
import type { UxPrincipleDecl, UxPrinciplesModel } from '../../../../../lib/model/ux-principles/types.js';
import { bookHtmlFiles, pageText } from '../../../../helpers/book-html.js';
import { specModel, stubGuards } from '../../../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../../helpers/platform.js';
import { screenSpec } from '../../../../helpers/screen-builder.js';
import { NO_GATES } from '../../../../helpers/generate-context.js';

const FILE = 'docs/specs/frontend/ux-principles.md';

/** 原則 1 行。 */
function principle(id: string, enforcedBy: string, extra: Pick<UxPrincipleDecl, 'budget'> = {}): UxPrincipleDecl {
  return { id, statement: `${id} の文`, derives: ['screen_spec の actions'], enforcedBy, ...extra, location: { file: FILE } };
}

/** 台帳モデル。 */
function ledger(): UxPrinciplesModel {
  return {
    available: true,
    spec: {
      id: 'ux-principles',
      principles: [principle('U4', 'U4', { budget: { limit: 7 } }), principle('U6', 'advisory')],
      location: { file: FILE },
    },
  };
}

/** 生成の文脈。 */
function ctx(screens: readonly ReturnType<typeof screenSpec>[], uxPrinciples: UxPrinciplesModel = ledger()) {
  return {
    guards: stubGuards(),
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    uxPrinciples,
    screens: { available: true, screens, chromes: [], unexposed: [], unreachableStates: [], unseenStates: [] },
  };
}

/** UX 原則の章のページ(HTML の文書。出さない環境では undefined)。 */
function page(context: Parameters<typeof bookHtmlFiles>[1]): string | undefined {
  return bookHtmlFiles(specModel([]), context).get('docs/book/ux-principles.html');
}

describe('UX 原則の章(HTML)', () => {
  it('台帳が無ければ何も生成しない', () => {
    expect(page({ guards: stubGuards(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES })).toBeUndefined();
    expect(page(ctx([], { available: false, spec: null }))).toBeUndefined();
  });

  it('原則の表に、見張る検査・閾値・advisory の言い回しが出る', () => {
    const html = page(ctx([]));

    expect(html).toBeDefined();
    const content = pageText(html ?? '');
    expect(content).toContain('U4 | U4 の文 | U4 | 7 | screen_spec の actions');
    expect(content).toContain('U6 | U6 の文 | 検査していない(規約とレビュー) | —');
  });

  it('画面ごとの受け入れが、理由つきで画面名の昇順に出る(対象が空なら「画面そのもの」)', () => {
    const screens = [
      screenSpec({ name: 'b_screen', ux: [{ principle: 'U3', reason: '完了画面だから' }] }),
      screenSpec({ name: 'a_screen', ux: [{ principle: 'U4', subject: 'thing.open', reason: '別々のカードに並ぶ' }] }),
      screenSpec({ name: 'c_screen' }),
    ];
    const content = pageText(page(ctx(screens)) ?? '');

    expect(content).toContain('受け入れは 2 件(2 画面)');
    expect(content).toContain('a_screen | U4 | thing.open | 別々のカードに並ぶ');
    expect(content).toContain('b_screen | U3 | (画面そのもの) | 完了画面だから');
    expect(content.indexOf('a_screen')).toBeLessThan(content.indexOf('b_screen'));
    expect(content).not.toContain('c_screen');
  });

  it('受け入れが 0 件ならそう書く', () => {
    const content = pageText(page(ctx([screenSpec({ name: 'a' })])) ?? '');

    expect(content).toContain('受け入れは 1 件も無い');
  });

  it('原則が 0 行なら、行を足すよう案内する', () => {
    const empty: UxPrinciplesModel = { available: true, spec: { id: 'ux-principles', principles: [], location: { file: FILE } } };
    const content = pageText(page(ctx([], empty)) ?? '');

    expect(content).toContain('まだ原則の宣言が無い');
  });

  it('章立ての design グループに載り、精読不要の宣言は持たない(判断ポイントは受け入れの件数)', () => {
    const chapter = bookChapters(specModel([]), ctx([])).find((candidate) => candidate.file === 'docs/book/ux-principles.md');

    expect(chapter).toMatchObject({ title: 'UX 原則', group: 'design' });
    expect(chapter?.reviewFree).toBeUndefined();
  });

  it('章の頭の 1 行に判断ポイント = 受け入れの件数が出る', () => {
    const screens = [
      screenSpec({ name: 'a_screen', ux: [{ principle: 'U4', subject: 'thing.open', reason: '別々のカードに並ぶ' }] }),
      screenSpec({ name: 'b_screen', ux: [{ principle: 'U3', reason: '完了画面だから' }] }),
    ];
    const withSources = { ...ctx(screens), specSources: new Map<string, string>() };
    const content = pageText(page(withSources) ?? '');

    expect(content).toContain('判断ポイント 2 件');
  });
});
