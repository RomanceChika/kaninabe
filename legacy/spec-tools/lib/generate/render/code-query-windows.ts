/**
 * query_spec + roles.md の binding → スコープ条件の宣言表
 * (`app/src/domain/generated/query-windows.ts`)の生成器。
 *
 * 可視性は二層である(ARCH-BE-0016)。上界(見えてはいけないものが返らない)は RLS が担い、
 * **スコープ条件**(宣言どおりの集合が返る)は `via` のロールの `binding` から導かれる絞り込みが担う。
 * スコープ条件は「仕様からの写し」であって実装の判断ではない以上、**写す作業を人がやる理由が無い** —
 * この生成器が binding を PostgREST の列パスに写し、写像(infrastructure のクエリ関数)は
 * 生成物を適用するだけになる(2026-08-26 方針「実装の自由度は無くなるほど嬉しい」)。
 *
 * ## 何を出すか — actor を右辺に持つ条件と、併読を param で絞る条件
 *
 * actor を右辺に持つ条件(`== actor.id` の形)は
 * - `via` の binding の写し(**スコープ条件**。可視性を成立させている絞り込み)
 * - `filters` のうち actor を参照するもの(**スコープ条件ではない**。UX の取捨選択だが、実行者の ID を
 *   使う点は同じなので、手書きを 1 本残さないためここに載せる)
 * の 2 種類を出す。
 *
 * これとは別に、**併読(`includes`)の `filters` が `== param.{name}` の形のとき**
 * (`{併読先}.{列} == param.{name}`)、その列パスと `param` 名の対も
 * `paramConditions` として出す(2026-09-04 拡張)。「併読先も同じ親に属すか」のような絞り込みは
 * スコープ条件ではない(UX の取捨選択)が、埋め込みの列を手で `.eq()` するのは actor 参照と同じ理由で
 * 危うい — 生成物 1 箇所を適用するだけの形にして、書き忘れ・宣言との食い違いを構造的に無くす。
 *
 * **`source` 自身の `filters` の `== param.{name}` はここに出さない。** これは配線が受け取る
 * 実行時入力そのもの(`workshopId` のような関数の主引数)であり、型で 1 対 1 が既に見えている
 * (埋め込みへ暗黙に伝播する併読のような曖昧さが無い)。線引きの対象は「併読を param で絞る」
 * ケースだけである。
 *
 * ## 列パスの導き方(binding → PostgREST のパス)
 *
 * binding は `{entity}.{field} == actor.id` の形をしている。起点のエンティティ E から見て、
 * 1. `{entity}` が E 自身なら、列はそのまま `{field}`(例: entry_owner → `owner_id`)
 * 2. そうでなければ E の `context` で辿る。`{field}` が相手の主キー `id` なら、辿った先を
 *    見に行く必要は無く**手前の外部キー列に畳める**(例: invitation の account_owner は
 *    `member.id == actor.id` だが `context: {member: invitation.issued_by}` なので `issued_by`)
 * 3. 畳めないなら埋め込みのパスにする(binding の相手が親の表にあるとき、`{親の表}.{列}` を書く)
 * `includes` の条件は、併読先のテーブル名を接頭辞に付けたパスになる
 * (例: workshop_detail の piece は `pieces.entries.owner_id`)。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。列パスの導出そのものは query-window-columns.ts が持つ
 * (ここはその結果を宣言表に並べる)。
 */

import type { SpecModel } from '../../model/types.js';
import type { GuardServices } from '../../guard/ast.js';
import type { QueryInclude, QuerySpec } from '../../model/query/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { actorFilterColumn, bindingColumn, paramFilterCondition, tableOf } from '../../semantics/query-window-columns.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';

/** スコープ条件の宣言表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'query-windows.ts');

/** 併読を実行時入力で絞る条件 1 本(列パスと、どの `param` を見るか)。 */
interface QueryParamCondition {
  /** PostgREST の列パス(併読先のテーブル名を接頭辞に持つ)。 */
  readonly column: string;
  /** 参照する `params` の名前。 */
  readonly param: string;
}

/** 1 クエリ分の actor 条件と param 条件。 */
interface QueryActorConditions {
  /** 主テーブル(PostgREST の `from()` に渡す名前)。 */
  readonly table: string;
  /** `via` の binding の写し = スコープ条件。消すと宣言より広い集合が返る。 */
  readonly window: readonly string[];
  /** actor を参照する filters の写し。スコープ条件ではない(消しても見えてはいけないものは見えない)。 */
  readonly actorFilters: readonly string[];
  /** 併読の filters のうち `== param.{name}` の形の写し。スコープ条件ではない(UX の絞り込み)。 */
  readonly paramConditions: readonly QueryParamCondition[];
}

/**
 * 全 query_spec からスコープ条件の宣言表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/query-windows.ts`(全クエリで 1 ファイル・全体生成)。
 */
export const queryWindowsGenerator: DocGenerator = {
  id: 'code-query-windows',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const queries = ctx.queries?.queries ?? [];
    if (queries.length === 0) return [];

    const table: Record<string, LiteralValue> = {};
    for (const query of [...queries].sort((a, b) => a.name.localeCompare(b.name))) {
      table[query.name] = conditionsLiteral(deriveConditions(query, model, ctx.guards));
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

/** 宣言 1 件をリテラルに写す(キーの順序は型の宣言順と揃える)。 */
function conditionsLiteral(conditions: QueryActorConditions): LiteralValue {
  return {
    table: conditions.table,
    window: [...conditions.window],
    actorFilters: [...conditions.actorFilters],
    paramConditions: conditions.paramConditions.map((condition) => ({
      column: condition.column,
      param: condition.param,
    })),
  };
}

/** query_spec 1 本の actor 条件・param 条件を導く。 */
function deriveConditions(
  query: QuerySpec,
  model: SpecModel,
  guards: GuardServices,
): QueryActorConditions {
  const window: string[] = [];
  const actorFilters: string[] = [];
  const paramConditions: QueryParamCondition[] = [];

  if (query.via !== undefined) {
    const column = bindingColumn(model, guards, query.source, query.via.role);
    if (column !== null) window.push(column);
  }
  for (const filter of query.filters) {
    const column = actorFilterColumn(model, guards, query.source, filter.source);
    if (column !== null) actorFilters.push(column);
  }
  for (const include of query.includes) {
    collectIncludeConditions(include, model, guards, window, actorFilters, paramConditions);
  }

  return { table: tableOf(model, query.source), window, actorFilters, paramConditions };
}

/** 併読 1 件の actor 条件・param 条件を、併読先のテーブル名を接頭辞に付けて集める。 */
function collectIncludeConditions(
  include: QueryInclude,
  model: SpecModel,
  guards: GuardServices,
  window: string[],
  actorFilters: string[],
  paramConditions: QueryParamCondition[],
): void {
  const prefix = `${tableOf(model, include.entity)}.`;
  if (include.via !== undefined) {
    const column = bindingColumn(model, guards, include.entity, include.via.role);
    if (column !== null) window.push(`${prefix}${column}`);
  }
  for (const filter of include.filters) {
    const actorColumn = actorFilterColumn(model, guards, include.entity, filter.source);
    if (actorColumn !== null) {
      actorFilters.push(`${prefix}${actorColumn}`);
      continue;
    }
    const paramCondition = paramFilterCondition(model, guards, include.entity, filter.source);
    if (paramCondition !== null) {
      paramConditions.push({ column: `${prefix}${paramCondition.column}`, param: paramCondition.param });
    }
  }
}

/** スコープ条件の宣言表のファイル全体を組み立てる。 */
function renderFile(
  table: Readonly<Record<string, LiteralValue>>,
  specFiles: readonly string[],
): string {
  return [
    generatedHeader(specFiles),
    '',
    docComment([
      'クエリ 1 本分の「実行者の ID で絞る条件」と「併読を実行時入力で絞る条件」。',
      '列は PostgREST のパス表記。',
    ]),
    'export interface QueryParamCondition {',
    '  /** PostgREST の列パス（併読先のテーブル名を接頭辞に持つ）。 */',
    '  readonly column: string;',
    '  /** 参照する `params` の名前。 */',
    '  readonly param: string;',
    '}',
    '',
    'export interface QueryActorConditions {',
    '  /** 主テーブル（`from()` に渡す名前）。 */',
    '  readonly table: string;',
    '  /**',
    '   * `via` のロールの binding の写し = **スコープ条件**。',
    '   *',
    '   * 消すと宣言より広い集合が返る（上界＝RLS が許す最大の集合まで広がり、他人の行が混ざる）。',
    '   * スコープ条件の見張りテスト（統合テスト）はこの配列が空になる変異を検出するためにある。',
    '   */',
    '  readonly window: readonly string[];',
    '  /**',
    '   * `filters` のうち actor を参照するものの写し。**スコープ条件ではない**。',
    '   *',
    '   * 消しても見えてはいけないものは見えない（増えるのは UX 上いらない行だけ）。',
    '   * スコープ条件と同じ値（実行者の ID）で絞るため、手書きを 1 本も残さない目的でここに載せる。',
    '   */',
    '  readonly actorFilters: readonly string[];',
    '  /**',
    '   * 併読の `filters` のうち `== param.{name}` の形の写し。**スコープ条件ではない**（UX の絞り込み）。',
    '   *',
    '   * `source` 自身の `== param.{name}` はここに出ない（配線が受け取る主引数そのもので、',
    '   * 型で 1 対 1 が見えている）。適用口は `applyParamConditions`',
    '   * （infrastructure/supabase/query-window.ts）。',
    '   */',
    '  readonly paramConditions: readonly QueryParamCondition[];',
    '}',
    '',
    docComment([
      'クエリ名 → 実行者の ID で絞る条件・併読を実行時入力で絞る条件',
      '（`query_spec` の via / filters と roles.md の binding の写し）。',
      '',
      '**写像（infrastructure のクエリ関数）はこの表を適用するだけで、条件を手で書かない。**',
      '`applyActorConditions` / `applyParamConditions`（どちらも infrastructure/supabase/',
      'query-window.ts）が唯一の適用口であり、クエリ実装が `actorId` を直接 `.eq()` に渡すこと、',
      '併読の列を実行時入力の変数で直接 `.eq()` / `.in()` することはリンターが落とす。',
    ]),
    `export const queryActorConditions = ${renderLiteral(table)} as const satisfies Readonly<
  Record<string, QueryActorConditions>
>;`,
    '',
  ].join('\n');
}
