/**
 * 章の下段の「誰に見えるか」(導出)。**行の見え方**と**隠す欄**を、別の折りたたみに分ける。
 *
 * `reads` が決めるのは行の可視性(どの行が見えるか)だけで、欄の公開は別の層(`fields_hidden`)が決める。
 * 1 枚の表に「全件」と「隠すフィールド」を並べると、全件が見える相手に全部の欄が見えるように読めてしまう
 * (全件の行にも隠す欄がある)。そこで、表は読むだけの 3 列にし、隠す欄は見出しを分けて置く。
 */

import type { AggregateSpecs, SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { cell, withLabel } from '../../../gen-kit/state-machine-table.js';
import { bypassRole, dependentQueries, readKey, roleLabels, scopeJa, WIDE_READ_MARK } from './access-view.js';
import { type FoldedTable } from './lower-table.js';

/** 行の見え方の表の見出し。 */
export const READ_HEADERS = ['ロール', '見える範囲', 'この宣言に乗っている query'] as const;

/** 隠す欄の表の見出し。 */
export const HIDDEN_HEADERS = ['欄', '隠す相手'] as const;

/** 行の見え方の表の行(ロール | 見える範囲 | この宣言に乗っている query)。見えるロールが 1 つも無ければ null。 */
export function readRows(model: SpecModel, specs: AggregateSpecs, ctx: GenerateContext): readonly (readonly string[])[] | null {
  const access = specs.access;
  if (access === undefined) return null;
  const labels = roleLabels(model);
  const queries = dependentQueries(ctx.queries);
  const rows = access.reads
    .filter((rule) => rule.by !== bypassRole(model))
    .map((rule) => [
      cell(withLabel(rule.by, labels.get(rule.by))),
      cell(scopeJa(rule.scope)),
      cell((queries.get(readKey(access.entity, rule.by)) ?? []).join(', ')),
    ]);
  return rows.length === 0 ? null : rows;
}

/** 隠す欄の表の行(欄 | 隠す相手)。欄を隠す宣言が無ければ null。 */
export function hiddenRows(model: SpecModel, specs: AggregateSpecs): readonly (readonly string[])[] | null {
  const rules = specs.access?.fieldsHidden ?? [];
  if (rules.length === 0) return null;
  const labels = roleLabels(model);
  const rows = rules.map((rule) => [
    `\`${cell(rule.field)}\``,
    cell(rule.from.map((role) => withLabel(role, labels.get(role))).join('、')),
  ]);
  return rows;
}

/**
 * 「誰に見えるか」の折りたたみ 2 つ(行の見え方・隠す欄)の材料。中身が無いものは null。
 * Markdown の折りたたみと HTML の折りたたみが同じ見出し・行・注を使う。
 *
 * @param suffix 折りたたみの見出しの末尾(畳んだ従属の分は集約の名前で見分ける。親の分は空)
 */
export function visibilityEntries(model: SpecModel, specs: AggregateSpecs, ctx: GenerateContext, suffix: string): (FoldedTable | null)[] {
  const reads = readRows(model, specs, ctx);
  const hidden = hiddenRows(model, specs);
  return [
    reads === null
      ? null
      : {
          fold: {
            kind: 'table',
            title: `誰に見えるか${suffix}`,
            hint: `${WIDE_READ_MARK} は全件が見える行の宣言。欄の公開は別の層で、隠す欄が持つ`,
          },
          before: [],
          headers: [...READ_HEADERS],
          rows: reads,
          after: [],
          notes: [`読むの宣言は、行の見え方だけを決める。欄の公開は別の層が決め、${hidden === null ? 'この集約に隠す欄の宣言は無い' : '隠す欄は次の折りたたみにある'}。`],
        },
    hidden === null
      ? null
      : {
          fold: { kind: 'table', title: `隠す欄${suffix}`, count: `${hidden.length} 欄`, hint: '行が見えても、この欄はこの相手に出さない' },
          before: [],
          headers: [...HIDDEN_HEADERS],
          rows: hidden,
          after: [],
        },
  ];
}

