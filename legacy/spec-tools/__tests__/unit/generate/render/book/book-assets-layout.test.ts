/**
 * ハンドブックの CSS 資材の写し元(画面の部品の既定のスタイルの置き場。ヘッダに出る)は置き場の配置から引く(部品化 ③-c2b)。
 *
 * 以前は `screenPartPath(…) ?? ''` で、決められなければ空のパスをヘッダに黙って書いていた。**実装の木があるのに決められなければ前提の失敗**(配置の定義の検査を名指す)で止まり、
 * 実装の木を持たない製品は写し元が無い。部品(フォーム)の導出は重いので、**フォームがある**ことだけを差し替えて、写し元の引き方を見る
 * (部品の導出そのものは `screen-form-*.test.ts` が見る)。
 */

import { describe, expect, it, vi } from 'vitest';
import { GeneratorPreconditionError } from '../../../../../lib/kernel/generator-precondition.js';
import { EMPTY_LAYOUT } from '../../../../../lib/model/product/layout.js';
import { bookAssetsGenerator } from '../../../../../lib/generate/render/book/book-assets.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';

vi.mock('../../../../../lib/generate/render/screen-form-plan.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../lib/generate/render/screen-form-plan.js')>()),
  buildScreenForms: () => [{}],
}));

/** ui.css が出る(= 写し元のヘッダを書く)文脈。 */
function ctxWith(layout: typeof TEST_LAYOUT, app: string | null) {
  return { ...bookCtx(), layout, roots: { ...TEST_ROOTS, app }, book: { uiCss: '.card { padding: 1px; }' } };
}

/** 生成された ui.css のヘッダ(写し元の行)。 */
function header(layout: typeof TEST_LAYOUT, app: string | null): string {
  const ui = bookAssetsGenerator.generate(bookModel(), ctxWith(layout, app)).find((section) => section.file.endsWith('assets/ui.css'));
  return ui?.content ?? '';
}

describe('book-assets: 既定のスタイルの写し元の置き場', () => {
  it('配置の画面の部品の役割から引く(Next.js の綴りの値・架空の配置の値)', () => {
    expect(header(TEST_LAYOUT, 'app')).toContain(' *   - app/src/app/_screens/generated/default.module.css');
    const foreign = header(FOREIGN_LAYOUT, 'app');
    expect(foreign).toContain(' *   - app/server_code/ui/parts/default.module.css');
    expect(foreign).not.toContain('_screens');
  });

  it('実装の木があるのに配置が決められなければ、空のパスを黙って書かず前提の失敗で止まる(配置の定義の検査を名指す)', () => {
    try {
      header(EMPTY_LAYOUT, 'app');
      throw new Error('止まるはず');
    } catch (error) {
      expect(error).toBeInstanceOf(GeneratorPreconditionError);
      const findings = error instanceof GeneratorPreconditionError ? error.findings : [];
      expect(findings[0]?.verifier).toBe('配置の定義の検査');
      expect(findings[0]?.message).toContain('ハンドブックの CSS 資材の写し元(画面の部品の既定のスタイル)');
      expect(findings[0]?.message).toContain('役割 screen-part');
    }
  });

  it('実装の木を持たない製品は、画面の部品の既定のスタイルの写し元が無い(前提の失敗にもしない)', () => {
    expect(header(EMPTY_LAYOUT, null)).not.toContain('default.module.css');
  });
});
