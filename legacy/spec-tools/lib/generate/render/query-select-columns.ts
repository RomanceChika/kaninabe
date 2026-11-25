/**
 * query_spec の projection・sort・paging・includes を PostgREST の select 文字列・order・limit の
 * 宣言に写す純粋関数群。
 *
 * **列挙の組み立てだけ**を持つ(select/order/limit の生成器 `code-query-fragments.ts` が呼ぶ)。
 *
 * スコープ条件(via の binding)を成立させる内部結合の要否は `query-window-columns.ts` の列パス解決を
 * そのまま再利用する。2 つの生成器(query-windows / query-fragments)が同じ経路解決を別々に
 * 持つと、どちらかが古くなったときにドリフトするため、列パスの導出は 1 か所にしか無い。
 *
 * ## スコープ条件のための内部結合をいつ足すか
 *
 * `bindingColumn` / `actorFilterColumn` / `paramFilterCondition` が返す列パスは、起点(source、
 * または各 includes)から見て高々 2 segment(`{field}` か `{table}.{field}`)である
 * (query-window-columns.ts の解決規則)。
 * - 1 segment(裸のフィールド)は起点自身の列であり、select に何も足さなくても `.eq()` が効く
 *   (PostgREST は埋め込み先の未選択の列でもフィルタできる。workshop_detail の `entries.owner_id`
 *   が実例 —— `entries(...)` の埋め込みに `owner_id` は無いが、フィルタは効く)。
 * - 2 segment(`{table}.{field}`)は起点からもう 1 段辿った先の列であり、その段の埋め込みが
 *   select に無ければフィルタが効かない。**返すためではなく絞るため**の埋め込みなので
 *   `!inner`(結合条件を満たさない行を落とす)で足す(結合先の列は呼び出し側に返さない)。
 *
 * ## この生成器が再現しないもの
 *
 * 併読の埋め込みを「必ず 1 件」として型づけるための `!inner`(スコープ条件とは無関係な、実装側の型の
 * 都合。例: participant_self_list の `entries!inner(...)`)は query_spec に現れない判断であり、
 * ここでは再現しない。誤って一般化すると、RLS で見えないことがある関係にまで `!inner` を
 * 広げてしまい、本来 null になるだけの行を丸ごと落とす方向に寄りうる(workshop_detail の
 * 世話役プロフィールが実例 —— 同じ「必須の外部キー」でも意図的に `!inner` を使っていない)。
 */

import type { GuardServices } from '../../guard/ast.js';
import type { SpecModel } from '../../model/types.js';
import type { QueryInclude, QueryPaging, QuerySortKey, QuerySpec } from '../../model/query/types.js';
import { actorFilterColumn, bindingColumn, paramFilterCondition, tableOf } from '../../semantics/query-window-columns.js';

/** スコープ条件のためだけに足す内部結合(テーブル名 → 返す列の集合)。返り値の projection には現れない。 */
type SupportJoins = Map<string, Set<string>>;

/** 列パス 1 本が 2 segment(`{table}.{field}`)なら、内部結合の集合に足す。 */
function addSupportJoin(joins: SupportJoins, rawPath: string | null): void {
  if (rawPath === null) return;
  const dot = rawPath.indexOf('.');
  if (dot === -1) return; // 起点自身の列。select は変わらない。
  const table = rawPath.slice(0, dot);
  const field = rawPath.slice(dot + 1);
  const fields = joins.get(table) ?? new Set<string>();
  fields.add(field);
  joins.set(table, fields);
}

/** source 1 本ぶんの内部結合(`via` の binding + actor を参照する `filters`)。 */
function sourceSupportJoins(query: QuerySpec, model: SpecModel, guards: GuardServices): SupportJoins {
  const joins: SupportJoins = new Map();
  if (query.via !== undefined) {
    addSupportJoin(joins, bindingColumn(model, guards, query.source, query.via.role));
  }
  for (const filter of query.filters) {
    addSupportJoin(joins, actorFilterColumn(model, guards, query.source, filter.source));
  }
  return joins;
}

/** includes 1 本ぶんの内部結合(`via` の binding + actor / param を参照する `filters`)。 */
function includeSupportJoins(
  include: QueryInclude,
  model: SpecModel,
  guards: GuardServices,
): SupportJoins {
  const joins: SupportJoins = new Map();
  if (include.via !== undefined) {
    addSupportJoin(joins, bindingColumn(model, guards, include.entity, include.via.role));
  }
  for (const filter of include.filters) {
    const actorColumn = actorFilterColumn(model, guards, include.entity, filter.source);
    if (actorColumn !== null) {
      addSupportJoin(joins, actorColumn);
      continue;
    }
    const paramCondition = paramFilterCondition(model, guards, include.entity, filter.source);
    if (paramCondition !== null) addSupportJoin(joins, paramCondition.column);
  }
  return joins;
}

/** 内部結合をテーブル名の昇順で `, {table}!inner({fields})` の並びに直す。 */
function renderSupportJoins(joins: SupportJoins): string {
  return [...joins.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([table, fields]) => `, ${table}!inner(${[...fields].join(', ')})`)
    .join('');
}

/** 併読 1 件ぶんの埋め込み文字列(`{table}({projection}{スコープ条件のための内部結合})`)。 */
function renderInclude(include: QueryInclude, model: SpecModel, guards: GuardServices): string {
  const table = tableOf(model, include.entity);
  const columns = include.projection.map((field) => field.name).join(', ');
  const joins = renderSupportJoins(includeSupportJoins(include, model, guards));
  return `${table}(${columns}${joins})`;
}

/**
 * `query_spec` の `projection` + `includes` を PostgREST の select 文字列に写す。
 *
 * 列の並びは `projection`(source)→ source のスコープ条件のための内部結合 → `includes`(宣言順)。
 */
export function renderSelect(query: QuerySpec, model: SpecModel, guards: GuardServices): string {
  const base = query.projection.map((field) => field.name).join(', ');
  const sourceJoins = renderSupportJoins(sourceSupportJoins(query, model, guards));
  const includes = query.includes.map((include) => `, ${renderInclude(include, model, guards)}`).join('');
  return `${base}${sourceJoins}${includes}`;
}

/** 1 件の並び替えキー(`.order()` の引数の形)。 */
export interface QueryOrderKey {
  readonly column: string;
  readonly ascending: boolean;
  /** 併読先の並びなら、その埋め込みのテーブル名(`.order(..., { referencedTable })`)。 */
  readonly referencedTable?: string;
  /** null の位置(`.order(..., { nullsFirst })`)。書かれていなければ Postgres の既定。 */
  readonly nullsFirst?: boolean;
}

/** `QuerySortKey` 1 本を `QueryOrderKey` に写す(referencedTable は呼び出し側が足す)。 */
function orderKeyOf(key: QuerySortKey): Omit<QueryOrderKey, 'referencedTable'> {
  return {
    column: key.field,
    ascending: key.direction === 'asc',
    ...(key.nulls === undefined ? {} : { nullsFirst: key.nulls === 'first' }),
  };
}

/**
 * `query_spec` の `sort`(source + includes)を `.order()` 呼び出しの並びに写す。
 *
 * 並びは source の `sort`(宣言順)→ 各 `includes` の `sort`(includes の宣言順 → 各々の宣言順)。
 */
export function renderOrder(query: QuerySpec, model: SpecModel): QueryOrderKey[] {
  const keys: QueryOrderKey[] = query.sort.map((key) => orderKeyOf(key));
  for (const include of query.includes) {
    const table = tableOf(model, include.entity);
    for (const key of include.sort) {
      keys.push({ ...orderKeyOf(key), referencedTable: table });
    }
  }
  return keys;
}

/** `query_spec` の `paging` を `.limit()` の件数に写す(`none` / `cursor` / 未宣言は `undefined`)。 */
export function renderLimit(paging: QueryPaging | undefined): number | undefined {
  return paging?.kind === 'limit' ? paging.max : undefined;
}
