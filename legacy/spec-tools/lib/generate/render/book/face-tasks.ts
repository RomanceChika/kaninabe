/**
 * タスクの章(`docs/book/usecases.html`)の、人向けの表示の頭。
 *
 * 集約の章と同じ部品(`html/face-parts.ts`)を使う: パンくず・表示モードの切替・読む量の 4 枚。
 * タスクの章は 1 章で全タスクを持つので、数は**章のブロック**(タスクの仕様ファイル)を足したもの
 * (`block-reading.ts` の `chapterReading`。集約の章のような従属の畳み込みは無い)。結果表は折りたたみ(`kind: 'table'`)で
 * 畳む(`lower-table.ts` の `FoldedTable`)。数え方の正は集約の章と同じ(`semantics/reading-class.ts`)。
 *
 * 純粋関数だけ。
 */

import { type ReadingSum } from './block-reading.js';

/** 必読の中身の、読み手ごとの注記(共有の語。`html/usecases-chapter.ts` が読む)。 */
export const READER_NOTES = { business: '業務の判断をする人が読む', developer: '保存点の置き方などの構造の警告を含む' } as const;

/** 必読の中身の最後の 1 行(太字の前半と、続きの文)。 */
export const AXIOM_NOTE_BOLD = 'いま数える公理は不変条件の言明だけ';
export function axiomNoteTail(sum: ReadingSum): string {
  return `。この章の公理は ${sum.axioms} 本。タスクの予算は数に入れていない`;
}

/** 「今回変わった」の注記。 */
export const CHANGED_NOTE = 'タスクの予算や受け入れ宣言は、数えていない';

/** 「参照」の中身(結果表の通り数)。 */
export function deriveLines(cases: number): string[] {
  return [`結果表の通り ${cases} 通り。畳んだまま読まなくてよい`, '数は保存点ごとの全列挙の合計'];
}

