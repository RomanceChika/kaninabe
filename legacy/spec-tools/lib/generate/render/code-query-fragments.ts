/**
 * query_spec の projection・includes・sort・paging → PostgREST の select 文字列・order・limit の
 * 生成物(`app/src/domain/generated/query-fragments.ts`)の生成器。
 *
 * BACKLOG「Q 系の突合強化 — paging・projection の宣言 ⇔ 実装」の決定: 突合(SELECT 文字列の
 * 静的解析。誤検出が多く見送り済み)ではなく**生成で閉じる**。query_spec 1 本ごとに
 * select / order / limit を機械的に導き、写像(infrastructure のクエリ関数)は生成物をそのまま
 * 問い合わせに渡すだけにする。手書きが残るのは「どのスコープ条件を当てるか」(`query-windows.ts` が別に
 * 持つ)と「結果の写像(行 → 画面の型)」だけになる。
 *
 * ## 閉世界であること
 *
 * 生成物のキー集合は query_spec の集合と常に一致する(この生成器が `ctx.queries` を丸ごと
 * 歩くため。`query-windows.ts` と同じ性質)。
 *
 * ## すべての生成物が写像から使われるとは限らない
 *
 * 併読の埋め込みを「必ず 1 件」として型づけるための `!inner`(スコープ条件とは無関係な、実装側の型の
 * 都合)は query_spec に現れない判断であり、この生成器は再現しない(理由は
 * `query-select-columns.ts` の doc comment)。該当するクエリ(`participant_self_list`)は
 * この生成物にエントリを持つが、写像は今も手書きの select を使う
 * (`app/src/infrastructure/entry_participant/queries.ts`)。
 */

import type { GuardServices } from '../../guard/ast.js';
import type { SpecModel } from '../../model/types.js';
import type { QuerySpec } from '../../model/query/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import { renderLimit, renderOrder, renderSelect } from './query-select-columns.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';

/** select/order/limit の生成物の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'query-fragments.ts');

/**
 * 全 query_spec から select/order/limit の生成物を生成するジェネレーター。
 * 出力は `app/src/domain/generated/query-fragments.ts`(全クエリで 1 ファイル・全体生成)。
 */
export const queryFragmentsGenerator: DocGenerator = {
  id: 'code-query-fragments',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const queries = ctx.queries?.queries ?? [];
    if (queries.length === 0) return [];

    const table: Record<string, LiteralValue> = {};
    for (const query of [...queries].sort((a, b) => a.name.localeCompare(b.name))) {
      table[query.name] = fragmentLiteral(query, model, ctx.guards);
    }

    return [
      {
        file: outputFile(ctx.roots),
        content: renderFile(table, [
          specPath(ctx.roots, 'domain/roles.md'),
          ...queries.map((query) => query.location.file),
        ]),
        wholeFile: true,
      },
    ];
  },
};

/** query_spec 1 本ぶんの select/order/limit をリテラルに写す(キー順は型の宣言順と揃える)。 */
function fragmentLiteral(query: QuerySpec, model: SpecModel, guards: GuardServices): LiteralValue {
  const order: LiteralValue[] = renderOrder(query, model).map((key) => {
    const entry: Record<string, LiteralValue> = { column: key.column, ascending: key.ascending };
    if (key.referencedTable !== undefined) entry.referencedTable = key.referencedTable;
    if (key.nullsFirst !== undefined) entry.nullsFirst = key.nullsFirst;
    return entry;
  });
  const literal: Record<string, LiteralValue> = {
    select: renderSelect(query, model, guards),
    order,
  };
  const limit = renderLimit(query.paging);
  if (limit !== undefined) literal.limit = limit;
  return literal;
}

/** 生成物のファイル全体を組み立てる。 */
function renderFile(table: Readonly<Record<string, LiteralValue>>, specFiles: readonly string[]): string {
  return [
    generatedHeader(specFiles),
    '',
    docComment([
      'クエリ 1 本分の select 文字列・並び替え・件数上限。',
      '`query_spec` の `projection` / `includes` / `sort` / `paging` の機械的な写しである。',
    ]),
    'export interface QueryOrderKey {',
    '  readonly column: string;',
    '  /** 併読先の並びなら、その埋め込みのテーブル名。 */',
    '  readonly referencedTable?: string;',
    '  readonly ascending: boolean;',
    '  /** null の位置(`sort` の `nulls_first` / `nulls_last`)。無ければ Postgres の既定。 */',
    '  readonly nullsFirst?: boolean;',
    '}',
    '',
    'export interface QuerySelectFragment {',
    '  /**',
    '   * PostgREST の select 文字列(`projection` + `includes`)。',
    '   *',
    '   * `via` の binding が起点から 1 段先の列を指すときは、その段の内部結合(`!inner`)が',
    '   * 混ざる(返すためではなく絞るため。結合先の列は呼び出し側に返らない)。',
    '   */',
    '  readonly select: string;',
    '  /** `sort`(source + includes)の写し。`.order()` をこの順に適用する。 */',
    '  readonly order: readonly QueryOrderKey[];',
    '  /** `paging: limit(n)` の写し。`none` / `cursor` / `returns: one` では無い。 */',
    '  readonly limit?: number;',
    '}',
    '',
    docComment([
      'クエリ名 → select 文字列・並び替え・件数上限(`query_spec` の projection / includes /',
      'sort / paging の写し)。',
      '',
      '**写像(infrastructure のクエリ関数)はこの表を適用するだけで、列・並び・上限を手で',
      '書かない。** 適用口は `applyOrder` / `applyLimit`(`infrastructure/supabase/',
      'query-window.ts`)。ただし例外が 1 つある(`participant_self_list`)——理由はこの',
      'ファイル先頭の doc comment。',
    ]),
    `export const queryFragments = ${renderLiteral(table)} as const satisfies Readonly<
  Record<string, QuerySelectFragment>
>;`,
    '',
  ].join('\n');
}
