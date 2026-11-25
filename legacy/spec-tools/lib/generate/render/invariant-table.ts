/**
 * 各集約の invariants.md にある `invariant-table` マーカーに、不変条件表を生成するジェネレーター。
 *
 * formal(domain-spec-writing.md §invariant_spec)は uniqueness / cardinality /
 * state_dependency / check の閉じた集合。集計等 DSL の守備範囲外の不変条件は formal を
 * 省略できる(その場合 enforcedBy に application/trigger の宣言が必須。V10 が検証)ので、
 * その旨を表に明記する。
 */

import type { InvariantDef, InvariantFormal, SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';

const TABLE_HEADER = ['ID', '内容', '形式定義', '執行点'] as const;

/** formal が無い不変条件の「形式定義」列に表示する文言。 */
const NO_FORMAL_LABEL = 'DSL外(コード+テスト義務)';

/** 各集約の invariants.md の invariant-table セクションを生成するジェネレーター。 */
export const invariantTableGenerator: DocGenerator = {
  id: 'invariant-table',

  generate(model: SpecModel, _ctx: GenerateContext): GeneratedSection[] {
    const sections: GeneratedSection[] = [];
    for (const aggregate of model.aggregates.values()) {
      const invariants = aggregate.invariants;
      if (invariants === undefined) continue;
      sections.push({
        file: invariants.location.file,
        marker: 'invariant-table',
        content: renderTable(TABLE_HEADER, invariants.invariants.map(renderInvariantRow)),
      });
    }
    return sections;
  },
};

/** 不変条件 1 件を表の 1 行に変換する。 */
function renderInvariantRow(invariant: InvariantDef): string[] {
  return [
    invariant.id,
    invariant.statement,
    formalToString(invariant.formal),
    invariant.enforcedBy.map((e) => `${e.kind}: ${e.ref}`).join(', '),
  ];
}

/** formal を種類ごとの要点だけを残した文字列表現に変換する。 */
function formalToString(formal: InvariantFormal | undefined): string {
  if (formal === undefined) return NO_FORMAL_LABEL;
  switch (formal.kind) {
    case 'check':
      return `\`check(${formal.expr})\``;
    case 'uniqueness':
      return withWhere(`unique(${formal.keys.join(', ')})`, formal.where);
    case 'exclusion':
      return withWhere(
        `no overlap(${formal.keys.join(', ')}; [${formal.range[0]}, ${formal.range[1]}))`,
        formal.where,
      );
    case 'cardinality':
      return withWhere(`count(${formal.keys.join(', ')}) <= ${formal.max}`, formal.where);
    case 'state_dependency':
      return `if ${formal.if} then ${formal.then}`;
  }
}

/** where 限定条件があれば " where ..." を付け足す。 */
function withWhere(base: string, where: string | undefined): string {
  return where === undefined ? base : `${base} where ${where}`;
}

/**
 * 単純な GFM テーブルを組み立てる。
 * @param header 列見出し
 * @param rows 各行のセル値(header と同じ列数)
 */
function renderTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const headerLine = `| ${header.join(' | ')} |`;
  const separatorLine = `| ${header.map(() => '---').join(' | ')} |`;
  const bodyLines = rows.map((row) => `| ${row.join(' | ')} |`);
  return [headerLine, separatorLine, ...bodyLines].join('\n');
}
