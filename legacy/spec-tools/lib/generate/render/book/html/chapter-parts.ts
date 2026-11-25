/**
 * 本の HTML の章が共有する部品(本文と目次の型・表・等幅の字・節)。
 *
 * どの章(集約の章・層の章・表紙)も同じ形の表と節を使う。語は持たない。文字列はすべて出力の口(`markup.ts`)を通す。
 */

import type { Segment } from '../text-segments.js';
import { inline } from './face-parts.js';
import { el, join, url, type Child, type Html } from './markup.js';
import type { PageHeading } from './page.js';

/** 本文と目次の見出し。 */
export interface ChapterBody {
  readonly body: Html;
  readonly headings: readonly PageHeading[];
}

/** 表(見出しの行と本文の行)。 */
export function table(headers: readonly Child[], rows: readonly (readonly Child[])[], className?: string): Html {
  return el(
    'div',
    { class: 'bf-table' },
    el(
      'table',
      className === undefined ? null : { class: className },
      el(
        'thead',
        null,
        el(
          'tr',
          null,
          headers.map((header) => el('th', { scope: 'col' }, header)),
        ),
      ),
      el(
        'tbody',
        null,
        rows.map((row) =>
          el(
            'tr',
            null,
            row.map((item) => el('td', null, item)),
          ),
        ),
      ),
    ),
  );
}

/** 等幅の字(仕様の識別子・式)。 */
export function code(value: string | undefined): Html | null {
  return value === undefined ? null : el('code', null, value);
}

/** 節(`h2`)。中身は見出しを目次に積んでから組む(目次の並びが本文と同じになるように)。 */
export function section(id: string, title: string, headings: PageHeading[], content: () => Child): Html {
  headings.push({ level: 2, id, title: el('span', null, title) });
  return el('section', { class: 'bf-sec' }, el('h2', { id }, title), content());
}

/**
 * 文の部品(字と別のページへの繋ぎ)を 1 つの文にする。字は `inline` で読み、繋ぎは行き先が引ければリンク、引けなければ題だけの字にする
 * (まだ HTML に移していない章へは、生の Markdown を指さない)。
 *
 * @param parts 部品の並び
 * @param hrefOf 行き先の鍵から HTML の本の中の URL を引く(引けなければ null)
 */
export function segments(parts: readonly Segment[], hrefOf: (to: string) => string | null): Html {
  return join(
    parts.map((part) => {
      if (typeof part === 'string') return inline(part);
      const href = hrefOf(part.to);
      return href === null ? part.label : el('a', { href: url(href) }, part.label);
    }),
  );
}
