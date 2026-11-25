/**
 * guarantee-body / book-guarantees のユニットテスト。
 *
 * 生成は情報を足さない(宣言の展開のみ)。ここで固定するのは:
 *   - 差し込み先(guarantees.md の guarantee-body マーカー)と、保証の全数が表に出ること
 *   - planned だけを抜いた理由の表が出ること
 *   - ハンドブックの章が丸ごと生成され、状態が人間向けの言い回しになること
 */

import { describe, expect, it } from 'vitest';
import { guaranteeBodyGenerator } from '../../../../lib/generate/render/guarantee-body.js';
import { bookChapterSections, pageText } from '../../../helpers/book-html.js';
import { specModel, stubGuards } from '../../../helpers/model-builder.js';
import { guarantee, guaranteeModel } from '../../../helpers/guarantee-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 標準的な宣言(enforced 1 件 + planned 1 件)。 */
function standard() {
  return guaranteeModel([
    guarantee('rows_by_rls', { label: '見えてはいけない行は返らない', canaries: ['TC-GUAR-ROWS-001'] }),
    guarantee('api_surface_only', {
      label: '外から届く surface は api スキーマの生成物だけ',
      status: 'planned',
      plannedReason: '着手待ち',
    }),
  ]);
}

/** 生成の文脈。 */
const CTX = (guarantees: ReturnType<typeof guaranteeModel>) => ({ guards: stubGuards(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guarantees });

describe('guarantee-body', () => {
  it('保証の全数と、planned だけを抜いた理由の表が出て、差し込み先が guarantees.md になる', () => {
    const sections = guaranteeBodyGenerator.generate(specModel([]), CTX(standard()));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/specs/backend/guarantees.md');
    expect(sections[0]?.marker).toBe('guarantee-body');
    const content = sections[0]?.content ?? '';
    expect(content).toContain('| `rows_by_rls` | 見えてはいけない行は返らない |');
    expect(content).toContain('`TC-GUAR-ROWS-001`');
    expect(content).toContain('### まだ執行されていない保証(1 件');
    expect(content).toContain('| `api_surface_only` | 外から届く surface は api スキーマの生成物だけ | 着手待ち |');
  });

  it('planned が無ければ「無し」と出る', () => {
    const model = guaranteeModel([guarantee('rows_by_rls', { canaries: ['TC-GUAR-ROWS-001'] })]);
    const sections = guaranteeBodyGenerator.generate(specModel([]), CTX(model));

    expect(sections[0]?.content).toContain('無し(すべて enforced)。');
  });

  it('仕様が無ければ何も生成しない', () => {
    expect(guaranteeBodyGenerator.generate(specModel([]), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});

/** 保証の章(HTML の本)のセクション。 */
const bookGuarantees = (ctx: unknown) => bookChapterSections(specModel([]), ctx as Parameters<typeof bookChapterSections>[1], 'guarantees.html');

describe('book-guarantees(HTML の本の保証の章)', () => {
  it('章が丸ごと生成され、状態が人間向けの言い回しになる', () => {
    const sections = bookGuarantees(CTX(standard()));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/book/guarantees.html');
    expect(sections[0]?.wholeFile).toBe(true);
    const content = pageText(sections[0]?.content ?? '');
    expect(content).toContain('何が起こりえないか(保証)');
    expect(content).toContain('見えてはいけない行は返らない');
    expect(content).toContain('守られている(見張りテスト 1 本)');
    expect(content).toContain('これから(着手待ち)');
  });

  it('読めていない仕様は章を作らない', () => {
    expect(bookGuarantees({ roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});
