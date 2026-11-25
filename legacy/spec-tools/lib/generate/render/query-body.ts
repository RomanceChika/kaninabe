/**
 * query_spec 個別ファイルの `query-body` マーカーに、宣言の可読形を生成するジェネレーター。
 *
 * query_spec の YAML(for / via / source / scope_used / params / filters / includes /
 * projection / test_cases)を表に写すだけで、情報を足さない。params / projection の型は
 * entity_spec の定義の引き写しである(型の正はあくまで entity_spec)。
 */

import type { SpecModel } from '../../model/types.js';
import type { QueryInclude, QuerySpec } from '../../model/query/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { cell, EMPTY_CELL, markdownTable } from '../../gen-kit/state-machine-table.js';
import { fieldRefTable, kvTable, testCaseTable } from './spec-body.js';
import { specPath } from '../../model/product/paths.js';

/** 実行時入力が無いときの表記(書き忘れではなく宣言が空であることを示す)。 */
const NO_PARAMS = '実行時入力はない（このクエリは実行者のセッションだけで決まる）。';

/**
 * query_spec の本文ブロックを生成するジェネレーター。
 * 出力は各 query_spec ファイルの `query-body` マーカー 1 か所ずつ。
 */
export const queryBodyGenerator: DocGenerator = {
  id: 'query-body',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const queries = ctx.queries;
    if (queries === undefined || !queries.available) return [];
    return queries.queries.map((query) => ({
      file: specPath(ctx.roots, `backend/queries/${query.relPath}`),
      marker: 'query-body',
      content: renderQuery(model, query),
    }));
  },
};

/**
 * query_spec 1 本の本文(宣言表・params・filters・includes・projection・テストケース)を組み立てる。
 *
 * @param model ドメイン仕様全体(params / projection の型の引き当て先)
 * @param query 対象の query_spec
 * @returns Markdown 断片(末尾に改行を含まない)
 */
export function renderQuery(model: SpecModel, query: QuerySpec): string {
  const sections = [
    '### 宣言',
    '',
    declarationTable(query),
    '',
    '### params（実行時入力）',
    '',
    query.params.length === 0 ? NO_PARAMS : paramsTable(model, query),
    '',
    '### filters（絞り込み）',
    '',
    filterList(query.filters.map((filter) => filter.source)),
    ...includesSection(query),
    '',
    '### projection（返すフィールド）',
    '',
    projectionTable(model, query.source, query.projection),
    '',
    '### テストケース',
    '',
    testCaseTable(query.testCases),
  ];
  return sections.join('\n');
}

/** 宣言表(source / for / via / scope_used / returns / sort / bounded_by)。 */
function declarationTable(query: QuerySpec): string {
  const rows: [string, string][] = [
    ['source', query.source],
    ['実行ロール（for）', query.forRoles.join(', ')],
    ['可視性の供給元（via）', query.via === undefined ? '—（for 自身の reads）' : query.via.role],
    ['スコープ（scope_used）', scopeText(query.scopeUsed)],
    ['返し方', returnsText(query)],
    ['並び順（sort）', query.sort.map((key) => key.raw).join(', ')],
  ];
  if (query.paging?.kind === 'none') rows.push(['有界性の根拠（bounded_by）', boundedByText(query)]);
  return kvTable(rows);
}

/** bounded_by の表記(paging: none の宣言に添える「なぜ有界か」)。 */
function boundedByText(query: QuerySpec): string {
  const boundedBy = query.boundedBy;
  if (boundedBy === undefined) return '—（未宣言。Q8 がエラーで指す）';
  if (boundedBy.kind === 'window') return 'window（via のスコープ条件が実行者 1 人分に絞るため有界）';
  return `parent: ${boundedBy.aggregate}（${boundedBy.reason}）`;
}

/** スコープの表記(access_spec の表と同じ書き方)。 */
function scopeText(scope: QuerySpec['scopeUsed']): string {
  return scope.kind === 'context' ? `context(${scope.entity})` : scope.kind;
}

/** 返し方の表記(returns と paging を 1 セルにまとめる。query-list と同じ形)。 */
function returnsText(query: QuerySpec): string {
  const paging = query.paging;
  if (paging === undefined) return query.returns;
  const detail = paging.kind === 'limit' ? `limit(${paging.max})` : paging.kind;
  return `${query.returns} / ${detail}`;
}

/** params のマトリクス(型・制約は ref の指す entity_spec のフィールド定義の引き写し)。 */
function paramsTable(model: SpecModel, query: QuerySpec): string {
  const refs = query.params.map((param) => ({
    entity: param.ref.entity,
    field: param.ref.field,
    raw: `${param.name}（ref: ${param.ref.raw}）`,
  }));
  return fieldRefTable(model, refs);
}

/** filters の式の箇条書き(式はコードとして読ませる)。0 本なら —。 */
function filterList(sources: readonly string[]): string {
  if (sources.length === 0) return EMPTY_CELL;
  return sources.map((source) => `- \`${source}\``).join('\n');
}

/** includes の節(併読が無ければ節ごと出さない)。 */
function includesSection(query: QuerySpec): string[] {
  if (query.includes.length === 0) return [];
  const table = markdownTable(
    ['entity', 'scope_used', 'via', 'filters', 'projection', 'sort', 'limit'],
    query.includes.map((include) => includeRow(include)),
  );
  return ['', '### includes（併読）', '', table];
}

/** 併読 1 件を表の 1 行にする。 */
function includeRow(include: QueryInclude): string[] {
  return [
    cell(include.entity),
    cell(scopeText(include.scopeUsed)),
    include.via === undefined ? '—（for 自身の reads）' : cell(include.via.role),
    include.filters.length === 0
      ? EMPTY_CELL
      : include.filters.map((filter) => `\`${cell(filter.source)}\``).join('、'),
    cell(include.projection.map((field) => field.name).join(', ')),
    cell(include.sort.map((key) => key.raw).join(', ')),
    include.limit === undefined ? '—（全件）' : String(include.limit),
  ];
}

/** projection のマトリクス(型・説明は entity_spec の引き写し)。 */
function projectionTable(
  model: SpecModel,
  entity: string,
  projection: QuerySpec['projection'],
): string {
  const refs = projection.map((field) => ({ entity, field: field.name, raw: field.name }));
  return fieldRefTable(model, refs);
}
