/**
 * 下段の折りたたみ(前書き・表・後書き)の HTML 版。
 *
 * 共有の `FoldedTable`(`lower-table.ts`。行と文を持つ)を、出力の口(`markup.ts`)で組む。文は `inline` で読む(`` `識別子` `` と `**太字**` だけ)。
 * 違う点: 文に埋め込まれた `.md` への Markdown リンク(`[題](x.md)`)は、HTML の本から生の Markdown へ繋がない決まりなので、題だけを字にする。
 * 後書きの `- ` で始まる行(結果表の❌の凡例)は 1 つの箇条にまとめる。
 */

import type { FoldedTable } from '../lower-table.js';
import { fold, inline, pts } from './face-parts.js';
import { el, type Child, type Html } from './markup.js';
import { table } from './chapter-parts.js';

/** `.md` への Markdown リンクを題だけの字にする。 */
export function withoutMarkdownLinks(value: string): string {
  return value.replace(/\[([^\]]+)\]\([^)]*\.md[^)]*\)/g, '$1');
}

/** 文の並びを段落にする(`- ` で始まる行が続くあいだは 1 つの箇条)。 */
export function noteBlocks(lines: readonly string[]): Child[] {
  const blocks: Child[] = [];
  let bullets: Html[] = [];
  const flush = (): void => {
    if (bullets.length > 0) blocks.push(pts(bullets));
    bullets = [];
  };
  for (const line of lines) {
    if (line.startsWith('- ')) {
      bullets.push(inline(withoutMarkdownLinks(line.slice(2))));
      continue;
    }
    flush();
    blocks.push(el('p', null, inline(withoutMarkdownLinks(line))));
  }
  flush();
  return blocks;
}

/** 折りたたみ 1 つ(表が 1 枚)。 */
export function foldedTable(entry: FoldedTable): Html | null {
  return fold(entry.fold, [
    noteBlocks(entry.before),
    table(
      entry.headers.map((header) => inline(header)),
      entry.rows.map((row) => row.map((value) => inline(value))),
    ),
    noteBlocks(entry.after),
    (entry.notes ?? []).map((note) => el('p', { class: 'bf-note' }, inline(note))),
  ]);
}
