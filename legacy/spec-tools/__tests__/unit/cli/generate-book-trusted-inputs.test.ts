/**
 * ハンドブックだけを出す本物の CLI(`cli/generate-book.ts`)で、**コミットされた入力(画面プレビューの断片)を信頼しない**ことを別プロセスで見る。
 *
 * プレビューは HTML の本の出力の口(`html/markup.ts` の `previewFragment`)がそのまま置く(エスケープの例外)ので、置く前に許可表で検査する。
 * 合わない断片があれば**生成を止める**(何も書かない。点検 13 回目 C13-8)。許可表に合う断片は、章に載る。
 * 使い捨ての製品の写しに対して実行する(題材の fixture は触らない)。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTemps, copiedSample, editFile, filesOf, runBook, SLOW, temp } from '../../helpers/book-entry-fixture.js';

afterAll(cleanupTemps);

/** プレビューの置き場を宣言した写しに、断片を置く(画面名 → 断片)。 */
function withPreviews(label: string, previews: Readonly<Record<string, string>>): string {
  const root = copiedSample(label);
  const previewsRoot = ['docs', 'book', 'assets', 'previews'].join('/');
  editFile(root, 'product.md', (text) => text.replace('  app: app\n', `  app: app\n  previews: ${previewsRoot}\n`));
  const dir = path.join(root, previewsRoot);
  mkdirSync(dir, { recursive: true });
  for (const [screen, html] of Object.entries(previews)) writeFileSync(path.join(dir, `${screen}.html`), html);
  return root;
}

describe('プレビューの断片は許可表を通してから登録する', () => {
  const hostile: Readonly<Record<string, string>> = {
    item_list: '<main><img src=x onerror=alert(1)></main>',
    item_detail: '<main><script>alert(1)</script></main>',
    desk: '<main><div v-html="x">a</div></main>',
    desk_holds: '<main><a href="javascript:alert(1)">a</a></main>',
    my_library: '<main><iframe src="/x"></iframe></main>',
  };

  it('危険な断片があれば生成が止まり、何も書かれない(理由は断片を名指す)', () => {
    const root = withPreviews('preview-hostile', hostile);
    const out = temp('preview-hostile-out');

    const run = runBook(root, '--out', out);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('プレビューの断片 ');
    expect(run.stderr).toContain('許可表を通りません');
    expect(filesOf(out)).toEqual([]);
  }, SLOW);

  it('許可表に合う断片(フォーム部品を含む)は、章にそのまま載る', () => {
    const form = '<main><form><label>名前<input type="text" name="title" required></label><button type="submit">送る</button></form></main>';
    const root = withPreviews('preview-clean', { item_list: form, item_detail: '<main><b>見本</b></main>' });
    const out = temp('preview-clean-out');

    const run = runBook(root, '--out', out);

    expect(run.status).toBe(0);
    const chapters = filesOf(out).filter((file) => file.endsWith('.html')).map((file) => readFileSync(path.join(out, file), 'utf-8')).join('\n');
    expect(chapters).toContain(form);
    expect(chapters).toContain('<main><b>見本</b></main>');
  }, SLOW);

  it('同じ名前の属性が 2 回ある断片で生成が止まる(大文字小文字違いも)', () => {
    const root = withPreviews('preview-duplicate', {
      item_list: '<main><span class="a" class="b">x</span></main>',
      item_detail: '<main><b id="x" ID="y">z</b></main>',
      desk: '<main><input name="a" value="1" VALUE="2"></main>',
    });
    const out = temp('preview-duplicate-out');

    const run = runBook(root, '--out', out);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('が重複しています');
    expect(filesOf(out)).toEqual([]);
  }, SLOW);

  it('危険な断片を直せば、同じ入力で断片が置かれる(置かない理由は断片だけ)', () => {
    const root = withPreviews('preview-fixed', { ...hostile, item_list: '<main>直した</main>', item_detail: '<main>直した</main>', desk: '<main>直した</main>', desk_holds: '<main>直した</main>', my_library: '<main>直した</main>' });
    const out = temp('preview-fixed-out');

    const run = runBook(root, '--out', out);

    expect(run.status).toBe(0);
    expect(filesOf(out).length).toBeGreaterThan(0);
    expect(readFileSync(path.join(out, 'docs/book/screens.html'), 'utf-8')).toContain('直した');
  }, SLOW);
});
