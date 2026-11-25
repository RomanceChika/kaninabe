/**
 * 「書き方の例」章が仕様の抜粋を引くとき、**この回の生成結果を当てた本文**から引くための重ね。
 *
 * 章は仕様の本文の見出しを指して抜粋する。その見出しが生成ブロックの中にあるとき、ディスクの本文は
 * 前回の生成結果であり、同じ回の生成器が出す新しい見出しを持たない。ディスクだけを読むと、見出しを
 * 直した回に章が見出しを見失って生成が落ちる(直しても 1 回では揃わない)。
 *
 * そこで、抜粋の元になる生成ブロックを持つ生成器の出力を、ディスクの本文へ**メモリ上で**当てて返す。
 * 返すのは `ファイル(リポジトリルート相対)→ 本文` の表で、ディスクには何も書かない
 * (書き込みは `apply-sections.ts` の仕事)。
 */

import type { SpecModel } from '../../../model/types.js';
import type { DocGenerator, GenerateContext } from '../../../gen-kit/generator.js';
import { replaceSection } from '../../markers.js';
import { actionBodyGenerator } from '../action-body.js';
import { configBodyGenerator } from '../config-body.js';
import { guaranteeBodyGenerator } from '../guarantee-body.js';
import { invariantTableGenerator } from '../invariant-table.js';
import { jobBodyGenerator } from '../job-body.js';
import { notificationBodyGenerator } from '../notification-body.js';
import { queryBodyGenerator } from '../query-body.js';
import { screenBodyGenerator } from '../screen-body.js';
import { readRepoFile } from '../code-examples.js';

/**
 * 章が抜粋を引く生成ブロック(印の名前 → その本文を出す生成器)。
 *
 * 足すのは、章の目録(`examples-page-catalog*.ts`)が指す節が**生成ブロックと重なる**ときである
 * (節の見出しがブロックの中にある場合と、手書きの見出しの節がブロックを含む場合。どちらも、ディスクは前回の
 * 結果なので、この回の生成結果から引かないと 1 回で揃わない)。足し忘れは、目録の節を実ファイルに当てて
 * 重なるブロックの印を拾う見張り(`examples-excerpt-blocks.test.ts`)が落とす。
 */
export const EXCERPTED_BLOCKS: ReadonlyMap<string, DocGenerator> = new Map([
  ['action-body', actionBodyGenerator],
  ['config-body', configBodyGenerator],
  ['guarantee-body', guaranteeBodyGenerator],
  ['invariant-table', invariantTableGenerator],
  ['job-body', jobBodyGenerator],
  ['notification-body', notificationBodyGenerator],
  ['query-body', queryBodyGenerator],
  ['screen-body', screenBodyGenerator],
  ['chrome-body', screenBodyGenerator],
]);

/** 重ねる生成器(同じ生成器が複数の印を出すので、重複を除く)。 */
export const EXCERPTED_BLOCK_GENERATORS: readonly DocGenerator[] = [...new Set(EXCERPTED_BLOCKS.values())];

/**
 * この回の生成結果を当てた仕様の本文の表を作る。
 *
 * @param model 仕様モデル
 * @param ctx 生成の文脈(`repoRoot` が無ければ表は空)
 * @param generators 重ねる生成器(既定は章が抜粋を引くもの)
 * @returns ファイル(リポジトリルート相対)→ 生成結果を当てた本文。ファイルが無い・マーカーが無いものは含めない
 */
export function generatedFileTexts(
  model: SpecModel,
  ctx: GenerateContext,
  generators: readonly DocGenerator[] = EXCERPTED_BLOCK_GENERATORS,
): ReadonlyMap<string, string> {
  const texts = new Map<string, string>();
  if (ctx.repoRoot === undefined) return texts;
  for (const generator of generators) {
    for (const section of generator.generate(model, ctx)) {
      if (section.marker === undefined) continue;
      const current = texts.get(section.file) ?? readRepoFile(ctx.repoRoot, section.file);
      if (current === null) continue;
      const replaced = replaceSection(current, section.marker, section.content);
      if (replaced.found) texts.set(section.file, replaced.source);
    }
  }
  return texts;
}
