import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectLayout, selectPlatformProfile } from '../../../cli/select-target-values.js';
import { selectTargets } from '../../../cli/select-targets.js';
import { TEST_LAYOUT, TEST_PLATFORM } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import type { ProductLayout, RoleDecl } from '../../../lib/model/product/layout.js';

/**
 * ハンドブックの入口が通す「プラットフォームの設定と置き場の配置の値だけを返す口」。後段を選ぶ口(全後段を読む)を通さずに済ませるための別の口なので、
 * **2 つの口が別々の値を選んで食い違わない**ことをここで固定する。
 */

describe('selectPlatformProfile', () => {
  it('このリポジトリが選ぶ設定(Supabase)を返し、後段を選ぶ口の既定の後段が持つ設定と同じ値である', () => {
    expect(selectPlatformProfile()).toBe(selectTargets('book', TEST_ROOTS).platform);
    expect(selectPlatformProfile()).toEqual(TEST_PLATFORM);
  });

  it('置き場の配置(Next.js)も同じ名前を引き、後段を選ぶ口の選択が持つ配置と同じ値である(ハンドブックの入口と全部入りが食い違わない)', () => {
    expect(selectLayout('book', TEST_ROOTS)).toBe(selectTargets('book', TEST_ROOTS).layout);
    expect(selectLayout('book', TEST_ROOTS)).toBe(TEST_LAYOUT);
  });

  it('実装の木を宣言しない製品は空の配置(後段を選ぶ口の契約と同じ線。2 つの口が食い違わない)', () => {
    const noApp = { ...TEST_ROOTS, app: null };
    expect(selectLayout('book', noApp)).toEqual({});
    expect(selectLayout('book', noApp)).toEqual(selectTargets('book', noApp).layout);
  });
});

describe('selectLayout: 配置を選ぶ入口も、選択の契約(配置そのものの契約と roots.generated の包含)を通す', () => {
  afterEach(() => vi.restoreAllMocks());

  /** process.exit を例外にして、使い方の誤りとしての終了(コード 1)と標準エラーへの理由を見る。 */
  function expectExit(run: () => unknown): string {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => void lines.push(line));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    expect(run).toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
    return lines.join('\n');
  }

  it('配置そのものの契約を満たさない配置(逆引きが無い・下限 1 の役割が無い)は、使い方の誤りとして終了する', () => {
    const entry = TEST_LAYOUT['http-entry'] as RoleDecl;
    const { classify: _classify, ...withoutClassify } = entry;
    const noClassify: ProductLayout = { ...TEST_LAYOUT, 'http-entry': withoutClassify };
    expect(expectExit(() => selectLayout('check:formal', TEST_ROOTS, noClassify))).toContain('check:formal: 選んだ置き場の配置が契約を満たしていません');
    const noSource: Record<string, RoleDecl | undefined> = { ...TEST_LAYOUT };
    delete noSource['source-root'];
    expect(expectExit(() => selectLayout('book', TEST_ROOTS, noSource))).toContain('多重度の下限が 1 の役割なのに、配置に宣言がありません');
  });

  it('roots.generated が配置の source-root の外にあれば、使い方の誤りとして終了する(パスを正規化して比べる)', () => {
    expect(selectLayout('book', { ...TEST_ROOTS, generated: './app/src//domain/generated/' })).toBe(TEST_LAYOUT);
    expect(expectExit(() => selectLayout('book', { ...TEST_ROOTS, generated: 'elsewhere/generated' }))).toContain('の外にあります');
  });
});
