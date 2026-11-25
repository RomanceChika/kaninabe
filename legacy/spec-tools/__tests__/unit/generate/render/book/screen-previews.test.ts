/**
 * SSR プレビューの重ね表示の切り出し(render/book/screen-previews.ts)のテスト。
 *
 * 対象の要求: 「閉じた `<dialog>` は本体から外し、`open` を付けて重ね表示として返す(id は testid から読む)」。
 * 断片に許可表に無いタグ・属性が混ざる場合の拒否は preview-check.test.ts と出力の口の許可表が見る。
 */

import { describe, expect, it } from 'vitest';

import { splitDialogs } from '../../../../../lib/generate/render/book/screen-previews.js';

describe('splitDialogs', () => {
  const dialog =
    '<dialog data-testid="workshop_manage.overlay.cancel_confirm.body.center" class="dialog">やめる</dialog>';

  it('dialog を本体から外し、open を付けて id つきで返す', () => {
    const parts = splitDialogs(`<main>本文</main>${dialog}<footer>脚</footer>`);

    expect(parts.base).toBe('<main>本文</main><footer>脚</footer>');
    expect(parts.overlays).toEqual([
      { id: 'cancel_confirm', html: dialog.replace('<dialog', '<dialog open') },
    ]);
  });

  it('複数の dialog を出現順に切り出す', () => {
    const second = '<dialog data-testid="s.overlay.b.body.center">b</dialog>';
    const parts = splitDialogs(`${dialog}<p>間</p>${second}`);

    expect(parts.base).toBe('<p>間</p>');
    expect(parts.overlays.map((overlay) => overlay.id)).toEqual(['cancel_confirm', 'b']);
  });

  it('testid が overlay の規則に合わない dialog は重ね表示にしない(本体からは外す)', () => {
    const parts = splitDialogs('<dialog data-testid="s.body.center">x</dialog>');

    expect(parts.overlays).toEqual([]);
    expect(parts.base).toBe('');
  });

  it('閉じていない dialog があってもそこで止まる(残りは本体のまま)', () => {
    const parts = splitDialogs('<main>a</main><dialog data-testid="s.overlay.b.c">');

    expect(parts.overlays).toEqual([]);
    expect(parts.base).toBe('<main>a</main><dialog data-testid="s.overlay.b.c">');
  });
});
