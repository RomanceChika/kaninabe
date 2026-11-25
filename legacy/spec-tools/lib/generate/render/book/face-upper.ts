/**
 * 章の上段 = **公理**(人が意味を判定するもの)。読み方の印は必読。
 *
 * 流れの段(図 2 枚 + 段ごとのラベル行)・補足枠・この章の公理・従属する概念の公理・
 * 写した公理・今回変わった分・受け入れを、この順に出す。文章は人が書く `summary` だけで、
 * 機械が出す部分はラベル行・箇条・表・図である(book-human-face.md §7-7)。
 */

import type { SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { type FaceFacts } from './face-facts.js';
import { blockOf } from './chapter-files.js';
import { bookLayout } from './face-scope.js';

/** 親の集約の公理の側の標識を、この章が出す仕様ファイル(`invariants` / `access`)。 */
export function ownSignFiles(model: SpecModel, facts: FaceFacts, ctx: GenerateContext, chapterFile: string): string[] {
  const layout = bookLayout(model, ctx);
  return [facts.specs.invariants?.location.file, facts.specs.access?.location.file].filter(
    (file): file is string => file !== undefined && blockOf(file, model, ctx.roots, layout)?.chapter === chapterFile,
  );
}

/** 公理の側の差分 1 件の見出し(要素の種類ごとの呼び名)。 */
export const CHANGE_SUBJECT = {
  'invariant.statement': '不変条件',
  'state.label': '状態の表示名',
  'transition.meaning': 'イベントの呼び名',
  'state.summary': '段の場面の文',
  'machine.summary': '節の要約の文',
  'entity.summary': '章頭の 1 文',
  'computes.example': '計算の例',
} as const;

