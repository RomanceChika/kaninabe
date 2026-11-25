/**
 * 下段の折りたたみ 1 つ(前書き・表・後書き)の材料。
 *
 * **行と文を 1 か所で持つ**ための型。表の行は `cell` を通した文字列(識別子はバッククォートで囲む)で、
 * 前書きと後書きは Markdown の記法を最小限(`` `識別子` `` と `**太字**`、後書きの `- ` で始まる箇条)だけ含む文である。
 */

import { markdownTable } from '../../../gen-kit/state-machine-table.js';
import { fold, type FoldProps } from './face-html.js';

/** 折りたたみ 1 つ(表が 1 枚)。 */
export interface FoldedTable {
  readonly fold: FoldProps;
  /** 表の前に置く文(導入・読み方)。 */
  readonly before: readonly string[];
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** 表の後ろに置く文(凡例・注記)。`- ` で始まる行は箇条。 */
  readonly after: readonly string[];
  /** 表の後ろに置く注(`<p class="bf-note">` の段落。Markdown では HTML の段落、HTML の本では注の段落)。 */
  readonly notes?: readonly string[];
}

/** 折りたたみを Markdown の断片にする。 */
export function markdownFoldedTable(entry: FoldedTable): string[] {
  return fold(entry.fold, [
    ...entry.before,
    markdownTable(
      [...entry.headers],
      entry.rows.map((row) => [...row]),
    ),
    ...entry.after,
    ...(entry.notes ?? []).map((note) => `<p class="bf-note">${note}</p>`),
  ]);
}
