/**
 * 章の頭の 1 行(この章の標識と判断ポイントの数)の HTML 版。
 *
 * 層の章の骨格を使わない章(外部連携・タスク・データの置き場)が、`chapter-loads.ts` の `chapterCountLine` と同じ
 * 事実と語を、同じ集計(`chapterLoads`)から出す。精読が要らないと宣言した章には出さない。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import { chapterLoads } from '../chapter-loads.js';
import { bold } from './face-parts.js';
import { el, url, type Html } from './markup.js';

/**
 * 章の頭の 1 行。
 *
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @returns 1 行(数が引けない章・精読が要らない章は null)
 */
export function countLine(model: SpecModel, ctx: GenerateContext, countKey: string): Html | null {
  const load = chapterLoads(model, ctx).find((candidate) => candidate.chapter.file === countKey);
  if (load === undefined || load.chapter.reviewFree !== undefined) return null;
  return el(
    'p',
    null,
    bold(`標識 ${load.signCount} 本・判断ポイント ${load.declCount} 件`),
    `(ブロック ${load.blocks.length} 個。単位が違うので足さない。ブロックごとの数は`,
    el('a', { href: url('./review-guide.html') }, 'レビューの手引き'),
    ')',
  );
}
