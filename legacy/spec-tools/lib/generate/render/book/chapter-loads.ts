/**
 * 章ごとの**標識**と**判断ポイント**の集計(レビューの手引きの入力と、各章の頭の 1 行)。
 *
 * `chapters.ts` が「どの章があるか」を決め、`block-loads.ts` が「どのブロックにどれだけあるか」を
 * 数える。ここはそのブロックを章ごとに束ねるだけなので、**章の合計・節ごとの数・手引きの数は
 * 同じ集計から出る**(食い違いようがない)。標識と判断ポイントは単位が違うので、並べて出して足さない。
 *
 * 規約どおりファイル I/O はしない純粋関数である。
 */

import type { SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { breakdownText, type LedgerPart } from '../semantic-review-counts.js';
import { bookChapters, type BookChapter } from './chapters.js';
import { blockLoads, type BlockLoad } from './block-loads.js';

/** 章ごとの集計 1 件(レビューの手引きの 1 行分)。 */
export interface ChapterLoad {
  readonly chapter: BookChapter;
  /** 判断ポイントの総数(章に属するブロックの合算)。 */
  readonly declCount: number;
  /** 標識の総本数(章に属するブロックの合算)。 */
  readonly signCount: number;
  /** 判断ポイントの内訳(章内の全ブロックをラベルで束ねた合算。例: `reads 4・うち scope:all 1`)。 */
  readonly declBreakdown: string;
  /** 章に属するブロック(標識か判断ポイントを持つものだけ。並びは節の並び → 仕様ファイル)。 */
  readonly blocks: readonly BlockLoad[];
}

/** 同じ生成の中で何度も呼ばれる(各章が頭の 1 行を出す)ので、文脈ごとに 1 回だけ数える。 */
const cache = new WeakMap<GenerateContext, { readonly model: SpecModel; readonly loads: ChapterLoad[] }>();

/**
 * 全章の標識と判断ポイントを集計する。
 * 内訳はブロック単位ではなくラベル単位で合算する(章の索引は「何をどれだけ見るか」が
 * 分かればよい。ブロックごとの内訳は手引きのブロック表が出す)。
 */
export function chapterLoads(model: SpecModel, ctx: GenerateContext): ChapterLoad[] {
  const cached = cache.get(ctx);
  if (cached !== undefined && cached.model === model) return cached.loads;
  const blocks = blockLoads(model, ctx);
  const loads = bookChapters(model, ctx).map((chapter) => {
    const own = blocks.filter((block) => block.chapter === chapter.file);
    const parts = new Map<string, number>();
    for (const block of own) {
      for (const part of block.parts) parts.set(part.label, (parts.get(part.label) ?? 0) + part.count);
    }
    const summed: LedgerPart[] = [...parts].map(([label, count]) => ({ label, count }));
    return {
      chapter,
      declCount: own.reduce((sum, block) => sum + block.declCount, 0),
      signCount: own.reduce((sum, block) => sum + block.signCount, 0),
      declBreakdown: breakdownText(summed),
      blocks: own.filter((block) => block.signCount > 0 || block.declCount > 0),
    };
  });
  cache.set(ctx, { model, loads });
  return loads;
}

