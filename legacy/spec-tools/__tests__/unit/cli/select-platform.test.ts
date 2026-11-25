import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectPlatformTargets } from '../../../cli/select-platform.js';
import { barePlatformTarget, FOREIGN_PLATFORM, TEST_PLATFORM } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/** 実装の木を宣言しない製品の根(アプリの枠の後段を選ばない構成を許す)。 */
const NO_APP = { app: null, generated: 'gen' } as const;

/**
 * 組み立ての根(CLI)が後段を選んだうえで、プラットフォームの設定の契約を確かめる口。契約(`roles` の 3 つの値が互いに異なる)を
 * 満たす設定だけを返し、違反は使い方の誤りとして理由を出して終了コード 1 で終える。
 */

afterEach(() => vi.restoreAllMocks());

/** `process.exit` を投げる関数に差し替え、標準エラーを集める。 */
function captured() {
  const errors: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args.join(' ')));
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit');
  }) as never);
  return { errors, exit };
}

describe('selectPlatformTargets', () => {
  it('既定は本番(Supabase + Vercel + Next.js)の後段。契約を満たす設定はそのまま返す', () => {
    const selection = selectPlatformTargets('generate', TEST_ROOTS);
    expect(selection.platform).toEqual(TEST_PLATFORM);
    expect(selection.targets.map((target) => target.id)).toEqual(['supabase', 'vercel', 'nextjs']);
    expect(selectPlatformTargets('generate', NO_APP, [barePlatformTarget(FOREIGN_PLATFORM)]).platform).toBe(FOREIGN_PLATFORM);
  });

  it('契約の違反(ロール名の重複)は理由を出して終了コード 1 で終える', () => {
    const { errors, exit } = captured();
    const broken = { ...FOREIGN_PLATFORM, roles: { anonymous: 'r', authenticated_default: 'r', system: 'w' } };
    expect(() => selectPlatformTargets('verify', NO_APP, [barePlatformTarget(broken)])).toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('verify: プラットフォームの設定が契約を満たしていません');
    expect(errors.join('\n')).toContain('roles.anonymous と roles.authenticated_default');
  });

  it('後段の選択が契約を満たさなければ(プラットフォームの後段が無い)、設定の契約より先に止まる', () => {
    const { errors, exit } = captured();
    expect(() => selectPlatformTargets('generate', NO_APP, [])).toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('generate: 選んだ後段が契約を満たしていません');
    expect(errors.join('\n')).toContain('プラットフォームの後段(role: platform)はちょうど 1 つ要ります');
  });
});
