/**
 * 読み取りクエリ一覧(specs/backend/queries/README.md の `query-list` ブロック)の生成器。
 *
 * query_spec は「誰が(for)・どの関係で(via)・どのエンティティを・どのスコープで読むか」を
 * クエリ単位で宣言する。1 件ずつ読まないと全体像が見えないので、一覧表を生成して
 * 「読み取り経路がいくつあり、どれがどのスコープを使っているか」を 1 か所で見えるようにする。
 *
 * query_spec が 1 件も無い状態(現状)でも壊れず、「まだ無い」ことを明示した表記を出す。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { QuerySpec } from '../../model/query/types.js';
import { cell, markdownTable } from '../../gen-kit/state-machine-table.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 差し込み先。一覧はディレクトリガイドに置く。 */
function queriesReadme(roots: ProductRoots): string {
  return specPath(roots, 'backend/queries/README.md');
}

/** 置き場はあるが 0 件のときの表記(「集め忘れ」と「まだ無い」を読み手が区別できるようにする)。 */
const EMPTY =
  'まだ query_spec はありません(読み取り経路を仕様化すると、ここに一覧が生成されます)。';

/** そもそも specs/backend/queries を読めなかったときの表記。 */
const UNAVAILABLE =
  'specs/backend/queries を読み込めなかったため、一覧を生成していません(ディレクトリの有無を確認すること)。';

/** 返し方の表記(returns と paging を 1 セルにまとめる)。 */
function returnsText(query: QuerySpec): string {
  const paging = query.paging;
  if (paging === undefined) return query.returns;
  const detail = paging.kind === 'limit' ? `limit(${paging.max})` : paging.kind;
  return `${query.returns} / ${detail}`;
}

/** スコープの表記(access_spec の表と同じ書き方に揃える)。 */
function scopeText(query: QuerySpec): string {
  const scope = query.scopeUsed;
  return scope.kind === 'context' ? `context(${scope.entity})` : scope.kind;
}

/**
 * 可視性の供給元の表記。
 *
 * source の `via` と、併読ごとの `via` を 1 セルに畳む(併読側は `{entity}: {role}` と書く)。
 * 1 本のクエリの中で供給元が分かれていること自体がレビューの着目点なので、
 * source 側だけを載せると「催しはメンバーとして、申込みは発表者として読む」形が表から消える。
 */
function viaText(query: QuerySpec): string {
  const parts = query.via === undefined ? [] : [query.via.role];
  for (const include of query.includes) {
    if (include.via !== undefined) parts.push(`${include.entity}: ${include.via.role}`);
  }
  return parts.join(', ');
}

/**
 * 読み込み済みの query_spec から一覧表を生成するジェネレーター。
 * 出力は queries/README.md の `query-list` マーカー 1 か所。
 */
export const queryListGenerator: DocGenerator = {
  id: 'query-list',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const model = ctx.queries;
    if (model === undefined || !model.available) {
      return [{ file: queriesReadme(ctx.roots), marker: 'query-list', content: UNAVAILABLE }];
    }
    const rows = model.queries.map((query) => [
      cell(query.name),
      cell(query.source),
      cell(query.forRoles.join(', ')),
      cell(viaText(query)),
      cell(scopeText(query)),
      cell(returnsText(query)),
      cell(`\`${query.relPath}\``),
    ]);
    const content =
      rows.length === 0
        ? EMPTY
        : markdownTable(
            ['クエリ', 'source', '実行ロール(for)', '可視性の供給元(via)', 'スコープ', '返し方', '仕様ファイル'],
            rows,
          );
    return [{ file: queriesReadme(ctx.roots), marker: 'query-list', content }];
  },
};
