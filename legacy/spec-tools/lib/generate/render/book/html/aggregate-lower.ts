/**
 * 集約の章の下段 = **導出**(機械が上段から出したもの)の HTML 版。すべて折りたたみ(`<details>`)に入れる。
 *
 * 並びと中身(表の行・見出し・件数)は 材料(`face-lower-parts.ts` の `lowerParts`)から出す。表は `folded-table.ts` が組み、
 * マトリクスは凡例と脚注をつけて、経路と隣の章は箇条にする。
 * **全遷移の図(mermaid)は HTML では出さない**: 上段の流れの図(`flow-diagram.ts`)が、どこからでも出る遷移を除く全遷移を名前つきの線で描いており、
 * 誰が・どこから・どこへ・条件は遷移表が持つので、同じ図を下段に重ねない。
 */

import path from 'node:path';

import { headingSlug } from '../../html.js';
import { aggregateTitle, dataPage } from '../chapters.js';
import { lowerParts, type LowerPart } from '../face-lower-parts.js';
import { domainHref, link, type DomainEnv } from './aggregate-env.js';
import { table } from './chapter-parts.js';
import { fold, inline, mono, pts } from './face-parts.js';
import { foldedTable } from './folded-table.js';
import { el, join, type Child, type Html } from './markup.js';

/** 脚注 1 項目(下に並ぶ項目があれば入れ子の箇条)。 */
function noteItem(note: { readonly text: string; readonly sub: readonly string[] }): Html {
  return el('li', null, inline(note.text), note.sub.length === 0 ? null : pts(note.sub.map((sub) => inline(sub))));
}

/** 状態 × イベントの表の凡例(印 1 つに 1 行。Markdown の凡例の 1 行は括弧と区切りの記号が多く、文体の規則に合わない)。 */
function matrixLegend(): Html {
  return pts([
    join([mono('✓→{to}'), ' は、遷移が定義されている']),
    join([mono('✗(fN)'), ' は、明示的な禁止。理由は脚注の fN']),
    join([mono('✗(o)'), ' は、', mono('otherwise_forbidden'), ' による包括の禁止']),
    join([mono('✗(?)'), ' は、理由が書かれていない禁止。V3 の違反']),
  ], true);
}

/** 部品 1 つを折りたたみにする。 */
function partHtml(env: DomainEnv, part: LowerPart): Child {
  switch (part.kind) {
    case 'table':
      return foldedTable(part.entry);
    case 'matrix':
      return fold(part.fold, [
        table(
          part.view.headers.map((header) => inline(header)),
          part.view.rows.map((row) => row.map((value) => inline(value))),
        ),
        matrixLegend(),
        part.view.notes.length === 0 ? null : [el('p', null, '脚注:'), el('ul', { class: 'bf-pts' }, part.view.notes.map(noteItem))],
      ]);
    case 'diagram':
      return null;
    case 'queries':
      return fold(part.fold, [
        pts(part.items.map((item) => join([mono(item.name), item.joined ? '(併読)' : '', ` — 読むロール: ${item.roles.join(', ')} / 返し方: ${item.returns}`]))),
      ]);
    case 'neighbors':
      return fold(part.fold, [
        pts(
          part.items.map((item) => {
            if (item.kind === 'table') {
              const href = `${path.posix.relative(path.posix.dirname(env.pageFile), dataPage(env.ctx.roots)).replace(/\.md$/, '.html')}#${headingSlug(item.table)}`;
              return join(['テーブル仕様 ', mono(item.table), ' — 原本: ', link(href, `データの置き場 の `, mono(item.table))]);
            }
            const target = item.other.entity;
            return join([
              target?.label === undefined ? mono(target?.entity ?? '') : join([`${target.label}(`, mono(target.entity), ')']),
              ' — 原本: ',
              link(domainHref(env.layout, item.other.name), aggregateTitle(item.other.name, target?.label)),
            ]);
          }),
        ),
      ]);
  }
}

/** 下段の折りたたみ(導出)。 */
export function lowerSection(env: DomainEnv): Child[] {
  return lowerParts(env.model, env.facts, env.ctx).map((part) => partHtml(env, part));
}
