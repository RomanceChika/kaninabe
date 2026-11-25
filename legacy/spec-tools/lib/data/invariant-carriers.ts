/**
 * 不変条件を**執行点として宣言した表**の、集約自身の綴り(T16 の (e) が「自集約」と読む名前)。
 *
 * 執行点は data_table の `checks[]` / `indexes[]` / `exclusions[]` / `triggers[]` が `invariant` で名指す。
 * その表が属する集約(entity_spec を持つ集約)が、その不変条件にとっての「自集約」である。
 * 判定は純関数で、ファイルを読まない。
 */

import { findEntitySpec } from '../semantics/domain-lookup.js';
import type { SpecModel } from '../model/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';

/**
 * 不変条件ごとの「**執行点を置く表の集約自身**を指す綴り」(集約ディレクトリ名とエンティティ名)。
 *
 * (e) の `referencesOtherAggregate` が「自集約」と読むのは、**不変条件が住む集約**ではなく、
 * 執行点(`checks[]` / `indexes[]` / `exclusions[]` / `triggers[]` の `invariant`)を宣言した表が
 * 属する集約でなければならない(`lib/sql/check-expression.ts` の `aggregateOf` の docstring ——
 * 別の集約の欄を自分の欄と取り違えない)。住む集約と置く表の集約が違えば、前者を自集約にすると
 * 置く表から見て別集約の欄が「自分の欄」に化ける。どの表も宣言していない不変条件は、ここに
 * 載らない(呼び側が、住む集約の綴りに退く)。
 */
export function carrierAggregateNames(
  domain: SpecModel,
  dataTables: DataTableSpecModel,
): ReadonlyMap<string, ReadonlySet<string>> {
  const names = new Map<string, Set<string>>();
  for (const table of dataTables.tables) {
    const entity = table.entity === undefined ? null : findEntitySpec(domain, table.entity);
    if (entity === null) continue;
    const own = ownAggregateNames(domain, entity.entity);
    const declared = [...table.checks, ...table.indexes, ...table.exclusions, ...table.triggers];
    for (const decl of declared) {
      if (decl.invariant === undefined) continue;
      const known = names.get(decl.invariant) ?? new Set<string>();
      for (const name of own) known.add(name);
      names.set(decl.invariant, known);
    }
  }
  return names;
}

/** エンティティを持つ集約自身の綴り(集約ディレクトリ名とエンティティ名)。 */
function ownAggregateNames(domain: SpecModel, entityName: string): readonly string[] {
  for (const [aggregate, specs] of domain.aggregates) {
    if (specs.entity?.entity === entityName) return [aggregate, entityName];
  }
  return [entityName];
}
