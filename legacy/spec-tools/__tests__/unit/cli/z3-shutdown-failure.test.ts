/**
 * Z3 の後始末(`shutdownZ3`)が失敗したときの、3 本の CLI の入口(`verify-docs.ts` / `generate-docs.ts` / `generate-book.ts`)の見せ方。
 *
 * 後始末は出力の**後**に行い、失敗は 1 行(`<CLI>: Z3 の後始末に失敗: …`)にして標準エラーへ出し、終了コードを 1 にする —— 検証・生成の
 * 出力は 1 行も欠けず、「検証が赤」と「後始末が赤」を見分けられる。検証が既に赤(終了コード 1)ならそのまま 1。
 *
 * 本物の CLI の本体を同じプロセスで読み込み(`process.exit` は記録に差し替える)、後始末だけを失敗する偽物にする。
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exitCodeAfterShutdown } from '../../../lib/guard/z3-finish.js';
import { cleanupTemps, copiedSample as copiedLibrary, declareToolWatchTest, temp } from '../../helpers/book-entry-fixture.js';

/** 道具の木の見張りテストの宣言を足した題材の写し(開発用の木の道具で別の題材を検証するので)。 */
const copiedSample = (label: string): string => declareToolWatchTest(copiedLibrary(label));

const failingShutdown = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock('../../../lib/guard/z3.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../lib/guard/z3.js')>();
  return {
    ...original,
    // 本物の後始末も実行する(worker を残さない)うえで、失敗を足す。
    shutdownZ3: async (): Promise<void> => {
      await original.shutdownZ3();
      await failingShutdown();
    },
  };
});

afterAll(cleanupTemps);

const SLOW = 300_000;

describe('exitCodeAfterShutdown', () => {
  it('成功すれば元の終了コードのまま、何も出さない', async () => {
    const lines: string[] = [];

    await expect(exitCodeAfterShutdown(0, () => Promise.resolve(), (line) => lines.push(line), 'verify')).resolves.toBe(0);
    await expect(exitCodeAfterShutdown(1, () => Promise.resolve(), (line) => lines.push(line), 'verify')).resolves.toBe(1);

    expect(lines).toEqual([]);
  });

  it('失敗すれば 1 行にして終了コード 1(元が 1 でも 1)。Error でない値も文面になる', async () => {
    const lines: string[] = [];

    await expect(exitCodeAfterShutdown(0, () => Promise.reject(new Error('止まらない')), (line) => lines.push(line), 'verify')).resolves.toBe(1);
    await expect(exitCodeAfterShutdown(1, () => Promise.reject('生の値'), (line) => lines.push(line), 'generate')).resolves.toBe(1);

    expect(lines).toEqual(['verify: Z3 の後始末に失敗: 止まらない', 'generate: Z3 の後始末に失敗: 生の値']);
  });
});

describe('3 本の入口は、後始末の失敗を出力の後に 1 行で見せ、終了コードを 1 にする', () => {
  const originalArgv = process.argv;
  let exits: (string | number | null | undefined)[];
  let out: string[];
  let err: string[];

  beforeEach(() => {
    exits = [];
    out = [];
    err = [];
    failingShutdown.mockReset();
    failingShutdown.mockRejectedValue(new Error('worker が止まらなかった'));
    vi.resetModules();
    vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      exits.push(code);
    }) as never);
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void err.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void err.push(args.join(' ')));
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  /** 入口を読み込んで実行する(top-level の実行が終わるまで待つ)。 */
  async function runEntry(entry: 'verify-docs' | 'generate-docs' | 'generate-book', args: readonly string[]): Promise<void> {
    process.argv = ['node', `${entry}.ts`, ...args];
    if (entry === 'verify-docs') await import('../../../cli/verify-docs.js');
    else if (entry === 'generate-docs') await import('../../../cli/generate-docs.js');
    else await import('../../../cli/generate-book.js');
  }

  it('verify: 検証のサマリが出たうえで終了コード 1・文面に「後始末」', async () => {
    const root = copiedSample('z3-verify');

    await runEntry('verify-docs', ['--root', root]);

    expect(out.join('\n')).toMatch(/すべての検証を通過しました|検証結果: /);
    expect(err).toContain('verify: Z3 の後始末に失敗: worker が止まらなかった');
    expect(err.filter((line) => line.includes('後始末'))).toHaveLength(1);
    expect(exits).toEqual([1]);
    expect(failingShutdown).toHaveBeenCalledTimes(1);
  }, SLOW);

  it('generate: 生成の結果が出たうえで終了コード 1・文面に「後始末」', async () => {
    const root = copiedSample('z3-generate');

    await runEntry('generate-docs', ['--root', root]);

    expect(out.join('\n')).toContain('generate しました');
    expect(err).toContain('generate: Z3 の後始末に失敗: worker が止まらなかった');
    expect(exits).toEqual([1]);
  }, SLOW);

  it('generate-book: 生成の結果が出たうえで終了コード 1・文面に「後始末」', async () => {
    const root = copiedSample('z3-book');
    const outDir = temp('z3-book-out');

    await runEntry('generate-book', ['--root', root, '--out', outDir]);

    expect(out.join('\n')).toContain('✓ 生成');
    expect(err).toContain('generate-book: Z3 の後始末に失敗: worker が止まらなかった');
    expect(exits).toEqual([1]);
  }, SLOW);

  it('後始末が成功すれば、同じ入口は検証の結果の終了コードのまま(後始末の行は出ない)', async () => {
    failingShutdown.mockResolvedValue(undefined);
    const root = copiedSample('z3-ok');

    await runEntry('verify-docs', ['--root', root]);

    expect(err.filter((line) => line.includes('後始末'))).toEqual([]);
    expect(exits).toEqual([0]);
  }, SLOW);
});
