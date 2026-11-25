/**
 * 索引の要求元(query_spec・関数の `lookup`)から、索引候補を機械的に導く純粋モジュール
 * (関係の層 `lib/relations/index-requirements/`。入口は `index.ts`)。
 *
 * 設計: 設計メモ ⑪d(0-4「索引の導出」)。要求元から候補を作って畳み込むところまでで、
 * 既存の索引による除外は `exclusion.ts`。入力の状態(未選択・阻害)は入口 `index.ts` が見て、
 * ここには**使える入力だけ**が渡る。
 *
 * ## 導出規則
 *
 * query_spec 1 本につき、索引候補を 1 本作る:
 *
 *   (スコープ条件の binding 列(自表内のものだけ), filters の等値・in 列(宣言順), 並び順の列(宣言順・重複除く))
 *
 * - **スコープ条件の binding 列**: `via` が解決する列が `query.source` 自身の列(1 segment)であるときだけ
 *   候補に加える。`context` を跨ぐ(2 segment = 別表の列)ときは、その表自身の索引の仕事ではない
 *   ので入れない(`semantics/query-window-columns.ts` の列パス解決を再利用する。生成器 code-query-windows.ts
 *   と同じ経路解決を 2 つ持たないため)。
 * - **filters の等値・in 列**: `==` と `in`(`!=` / `not in` は対象外 — 索引が素直に効く形だけを
 *   拾う)の左辺パスが `source` 自身の列に解決するものを、宣言順で集める(actor 参照・
 *   param 参照・リテラル値のどれでも同じに扱う — 索引にとっては「値が 1 つに決まる等値条件」
 *   であることだけが意味を持つ)。
 * - **並び順の列**: `sort` の列のうち、既に等値列に入っているものは除く(entry_own_list の
 *   `state` のように、絞り込みにも並び順にも現れる列を 2 回書かない)。
 *
 * 等値列の順序は「スコープ条件の binding → filters の宣言順」の固定順。並べ方が変わっても等値条件
 * どうしの効き目(複合索引の先頭が全部そろえば効く)は変わらないため、決定的な出力のための
 * 便宜的な順序である(**判断が入る箇所**。詳細は builder-report を見よ)。
 *
 * ## 前方一致の畳み込み
 *
 * 同一テーブルの候補どうしを列数の多い順に見て、短い方が長い方の**前方一致(先頭から連続一致)**
 * であれば、短い方は長い方に畳む(どちらも要求元の query 名を長い方に集約する)。前方一致しない
 * 候補(先頭列が違う、途中で分岐する)はそれぞれ別の索引として残す。
 *
 * ## 関数の本文が引く索引(`lookup`)
 *
 * data_table の `functions[].lookup`(トリガ関数・ジョブを取り出す関数など、本文が自表を絞り込み・並べる
 * 列の並び。`index-lookup.ts`)も、query_spec の候補と**同じ流れ**に載せる(前方一致の畳み込み)。
 * 要求元は `lookups`(関数名)に入り、`queries` と並ぶ。
 */

import type { GuardExpr, GuardServices, PathRef } from '../../guard/ast.js';
import type { SpecModel } from '../../model/types.js';
import type { QuerySpec } from '../../model/query/types.js';
import { findEntitySpec } from '../../semantics/domain-lookup.js';
import { resolveFilterPath } from '../../semantics/query-filter-path.js';
import { bindingColumn, tableOf } from '../../semantics/query-window-columns.js';
import type { LookupIndexRequest } from './index-lookup.js';
import { foldTable, type RawCandidate } from './index-fold.js';
import type { IndexRequirement } from './types.js';

/** 索引候補 1 本(テーブル名 + 列の並び)。 */
export interface QueryIndexCandidate {
  readonly table: string;
  readonly columns: readonly string[];
}

/** 主キーの列名(このリポジトリの規約。data_table は主キー以外の索引だけを宣言する)。 */
export const PRIMARY_KEY_COLUMN = 'id';

/**
 * `query.filters` から「等値・in」の左辺パスを集める(`not` の下・`!=` は対象外)。
 *
 * `and` / `or` の両辺は平らに集める(析出した列がすべて等値の索引候補に混ざっても、
 * 実際に効くかどうかは実行時の条件次第だが、これは**索引の要否を見る近似**であり
 * `explain-queries.mts` と同じ立ち位置である — 判断ではなく候補を配る)。
 */
function collectEqualityPaths(expr: GuardExpr): readonly PathRef[] {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return [...collectEqualityPaths(expr.left), ...collectEqualityPaths(expr.right)];
    case 'in':
      return [expr.path];
    case 'compare':
      return expr.op === '==' ? [expr.path] : [];
    default:
      return [];
  }
}

/** query の起点エンティティの正規名(entity_spec の `entity`)。 */
function canonicalEntity(model: SpecModel, source: string): string {
  return findEntitySpec(model, source)?.entity ?? source;
}

/** `query.filters` のうち、`source` 自身の列に解決する等値・in 列を宣言順・重複除去で集める。 */
function ownEqualityColumns(
  model: SpecModel,
  guards: GuardServices,
  query: QuerySpec,
): readonly string[] {
  const entity = canonicalEntity(model, query.source);
  const columns: string[] = [];
  for (const filter of query.filters) {
    const parsed = guards.parse(filter.source);
    if (!parsed.ok) continue;
    for (const path of collectEqualityPaths(parsed.expr)) {
      const resolved = resolveFilterPath(model, query, path);
      if (resolved.kind !== 'field' || resolved.entity !== entity) continue;
      if (!columns.includes(resolved.field)) columns.push(resolved.field);
    }
  }
  return columns;
}

/** `via` の binding 列。`source` 自身の列(1 segment 解決 = パスにドットを含まない)のときだけ返す。 */
function ownWindowColumn(model: SpecModel, guards: GuardServices, query: QuerySpec): string | null {
  if (query.via === undefined) return null;
  const column = bindingColumn(model, guards, query.source, query.via.role);
  if (column === null || column.includes('.')) return null;
  return column;
}

/**
 * query_spec 1 本から索引候補を作る(畳み込み前)。
 *
 * @returns 候補。等値列も並び順列も無ければ(索引を要求する材料が無ければ)null
 */
export function rawIndexCandidate(
  model: SpecModel,
  guards: GuardServices,
  query: QuerySpec,
): QueryIndexCandidate | null {
  const equality: string[] = [];
  const windowColumn = ownWindowColumn(model, guards, query);
  if (windowColumn !== null) equality.push(windowColumn);
  for (const column of ownEqualityColumns(model, guards, query)) {
    if (!equality.includes(column)) equality.push(column);
  }
  // 等値条件が主キー(id)そのものを含むなら、それだけで対象行が高々 1 件に定まる
  // (`returns: one` の「id で 1 件引く」形が典型例。workshop_organizer_detail の
  // `filters: [id == param.workshop_id]` が実例)。主キーの一意索引が既に効くので、
  // 他の等値列・並び順を混ぜた複合索引を新たに要求しない。
  if (equality.includes(PRIMARY_KEY_COLUMN)) return null;
  const sortColumns = query.sort.map((key) => key.field).filter((field) => !equality.includes(field));
  const columns = [...equality, ...sortColumns];
  if (columns.length === 0) return null;
  return { table: tableOf(model, query.source), columns };
}

/**
 * 全 query_spec と全関数の `lookup` から索引候補を導く(テーブルごとに前方一致を畳んだ後の形)。
 *
 * data_table を**既存の索引の除外には**使わない(`exclusion.ts` が担う)。要求元の宣言だけから決まる。
 * 検査(T2)・生成器(code-index-expectations・data-table-body)・ハンドブックの索引節は、入口
 * (`index.ts`)がこの結果を 1 つの値(`IndexRequirements`)にして配る(導出規則を 1 か所に保つ)。
 *
 * @param model 構築済みのドメイン仕様モデル
 * @param guards ガード式のパース
 * @param queries 読み込み済みの query_spec
 * @param lookups 関数の `lookup` の要求(`lookupIndexRequests` の結果)
 * @returns テーブル名の昇順、テーブル内は列数降順・列名昇順(決定的な出力)
 */
export function deriveCandidates(
  model: SpecModel,
  guards: GuardServices,
  queries: readonly QuerySpec[],
  lookups: readonly LookupIndexRequest[],
): readonly IndexRequirement[] {
  const byTable = new Map<string, RawCandidate[]>();
  const add = (table: string, raw: RawCandidate): void => {
    byTable.set(table, [...(byTable.get(table) ?? []), raw]);
  };
  for (const query of queries) {
    const candidate = rawIndexCandidate(model, guards, query);
    if (candidate !== null) {
      add(candidate.table, { columns: candidate.columns, origins: [{ kind: 'query', name: query.name, location: query.location }] });
    }
  }
  for (const request of lookups) {
    add(request.table, { columns: request.columns, origins: [{ kind: 'lookup', name: request.function, location: request.location }] });
  }
  return [...byTable.keys()].sort().flatMap((table) => foldTable(table, byTable.get(table) ?? []));
}
