/**
 * 標識(手書きの判断)の折りたたみと、仕様の木からの相対パス。
 *
 * 標識は人が書いた判断の場所で、どの章でも同じ形(本数と出典を見出しにし、中は原文の引用)で出す。集約の章も
 * 通知・ジョブ・画面の章も、ここを呼ぶ。製品の語は持たない。
 */

import { specPath } from '../../../model/product/paths.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { collectSigns } from '../../prose.js';
import { signpostQuotes } from './chapters.js';
import { fold } from './face-html.js';

/** 仕様ファイルの位置(仕様の木からの相対。木の外ならそのまま)。 */
export function specRelative(file: string, ctx: GenerateContext): string {
  const root = `${specPath(ctx.roots)}/`;
  return file.startsWith(root) ? file.slice(root.length) : file;
}

/**
 * 標識の折りたたみ(本数と出典を見出しにし、中は原文の引用)。標識が無ければ何も出さない。
 *
 * @param file 仕様ファイル(リポジトリルート相対)
 * @param chapterFile 引用を置く章ページ(出典への相対リンクの起点)
 */
export function signFold(file: string | undefined, ctx: GenerateContext, chapterFile: string): string[] {
  if (file === undefined) return [];
  const count = collectSigns(ctx.specSources?.get(file) ?? '').length;
  return fold(
    { kind: 'sign', title: `標識 ${count} 本`, hint: specRelative(file, ctx) },
    count === 0 ? [] : signpostQuotes(file, ctx, chapterFile),
  );
}
