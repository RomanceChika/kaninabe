import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TARGET_NAMES } from '../../../cli/default-targets.js';
import { DEFAULT_TARGETS, defaultTargetsFor, selectTargets } from '../../../cli/select-targets.js';
import { NEXTJS_TARGET } from '../../../lib/targets/nextjs/target.js';
import { SUPABASE_TARGET } from '../../../lib/targets/supabase/target.js';
import { VERCEL_TARGET } from '../../../lib/targets/vercel/target.js';
import { TEST_TARGETS } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/**
 * 組み立ての根(CLI)が後段を選ぶ口(SQL の層を読まない。ハンドブックだけを出す入口も通る)。選ぶのはこの口だけで、
 * 契約(`selectTargetSet`)を満たす後段だけを選択として返す。違反は理由を出して終了コード 1 で終える。
 */

afterEach(() => vi.restoreAllMocks());

describe('selectTargets', () => {
  it('このリポジトリが選ぶ後段(Supabase = プラットフォーム・Vercel = ホスト・Next.js = アプリの枠)が既定。名前は default-targets.ts の 1 か所が持つ', () => {
    expect(DEFAULT_TARGETS).toEqual([SUPABASE_TARGET, VERCEL_TARGET, NEXTJS_TARGET]);
    expect(DEFAULT_TARGETS.map((target) => [target.role, target.id])).toEqual(Object.entries(DEFAULT_TARGET_NAMES).map(([role, name]) => [role, name]));
    expect(DEFAULT_TARGETS).toEqual(TEST_TARGETS);
    expect(selectTargets('book', TEST_ROOTS).targets).toBe(DEFAULT_TARGETS);
  });

  it('実装の木を宣言しない製品の既定の後段は、アプリの枠の後段を含まない(選択の契約: 宣言していなければ 0)', () => {
    expect(defaultTargetsFor({ app: null }).map((target) => target.id)).toEqual(['supabase', 'vercel']);
    expect(defaultTargetsFor({ app: 'app' })).toBe(DEFAULT_TARGETS);
    expect(selectTargets('book', { app: null, generated: 'gen' }).layout).toEqual({});
  });

  it('アプリの枠の後段が選ばれていない構成は、空の配置(どの役割も解決できない)を持つ', () => {
    expect(selectTargets('book', { app: null, generated: 'gen' }, [SUPABASE_TARGET]).layout).toEqual({});
    expect(selectTargets('book', TEST_ROOTS).layout).toBe(NEXTJS_TARGET.layout);
  });

  it('後段を差し替えた選択は、そのプラットフォームの設定を持つ(コアは後段の名前を知らない)', () => {
    expect(selectTargets('book', { app: null, generated: 'gen' }, [SUPABASE_TARGET]).targets).toEqual([SUPABASE_TARGET]);
  });

  it('契約の違反は理由を出して終了コード 1 で終える', () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args.join(' ')));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    expect(() => selectTargets('book', TEST_ROOTS, [VERCEL_TARGET])).toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('book: 選んだ後段が契約を満たしていません');
  });
});
