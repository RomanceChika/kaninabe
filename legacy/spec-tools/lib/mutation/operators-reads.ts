/**
 * 変異器のうち、**読み取り規則(`access_spec` の `reads`)を壊す**もの。
 *
 * 壊す先(読み取り規則)ごとの変異器で、目録としては 1 つである(全数は `operators.ts` の
 * `ALL_MUTATION_OPERATORS`)。
 *
 * `reads` の 3 つの軸をそれぞれ 1 つずつ壊す —— 原理の行集合(`scope`)・実行者の側の境界
 * (`filters`)・対象の行の側の判定(`when`)である。どれも壊れると**返る行が増える**方向に
 * 動くので、捕るべきは執行点(RLS の本文)と期待の入力(world の設計図)である。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { readFilterPath } from '../model/read-filter-path.js';
import type { AccessSpec, AggregateSpecs, SpecModel } from '../model/types.js';
import type { Mutant, MutationOperator } from './types.js';

/** access_spec を差し替えたモデル。 */
function withAccess(model: SpecModel, name: string, specs: AggregateSpecs, access: AccessSpec): SpecModel {
  const aggregates = new Map(model.aggregates);
  aggregates.set(name, { ...specs, access });
  return { ...model, aggregates };
}

/** `reads[].filters`(テナントの境界)を落とす。 */
export const dropReadFilters: MutationOperator = {
  id: 'drop_read_filters',
  title: '`reads[].filters`(実行者の属性で行を絞る宣言)を落とす',
  breaks: 'reads[].filters',

  mutate(model: SpecModel): readonly Mutant[] {
    const mutants: Mutant[] = [];
    for (const [name, specs] of model.aggregates) {
      const access = specs.access;
      if (access === undefined) continue;
      access.reads.forEach((rule, index) => {
        if ((rule.filters ?? []).length === 0) return;
        const fields = (rule.filters ?? []).map(readFilterPath).join(', ');
        const { filters: _dropped, ...rest } = rule;
        mutants.push({
          operator: dropReadFilters.id,
          at: `${access.entity} の reads(by: ${rule.by})から filters(${fields})を落とした`,
          model: withAccess(model, name, specs, {
            ...access,
            reads: access.reads.map((current, i) => (i === index ? rest : current)),
          }),
        });
      });
    }
    return mutants;
  },
};

/** `reads[].when`(行の状態で見え方を絞る条件)を落とす。 */
export const dropReadWhen: MutationOperator = {
  id: 'drop_read_when',
  title: '`reads[].when`(行の状態で見え方を絞る条件)を落とす',
  breaks: 'reads[].when',

  mutate(model: SpecModel): readonly Mutant[] {
    const mutants: Mutant[] = [];
    for (const [name, specs] of model.aggregates) {
      const access = specs.access;
      if (access === undefined) continue;
      access.reads.forEach((rule, index) => {
        if (rule.when === undefined) return;
        const { when: _dropped, ...rest } = rule;
        mutants.push({
          operator: dropReadWhen.id,
          at: `${access.entity} の reads(by: ${rule.by})から when "${rule.when}" を落とした`,
          model: withAccess(model, name, specs, {
            ...access,
            reads: access.reads.map((current, i) => (i === index ? rest : current)),
          }),
        });
      });
    }
    return mutants;
  },
};

/** `reads[].scope` を `all` に広げる。 */
export const widenReadScope: MutationOperator = {
  id: 'widen_read_scope',
  title: '`reads[].scope` を `all` に広げる',
  breaks: 'reads[].scope',

  mutate(model: SpecModel): readonly Mutant[] {
    const mutants: Mutant[] = [];
    for (const [name, specs] of model.aggregates) {
      const access = specs.access;
      if (access === undefined) continue;
      access.reads.forEach((rule, index) => {
        if (rule.scope.kind === 'all') return;
        mutants.push({
          operator: widenReadScope.id,
          at: `${access.entity} の reads(by: ${rule.by})の scope を ${rule.scope.kind} から all に広げた`,
          model: withAccess(model, name, specs, {
            ...access,
            reads: access.reads.map((current, i) =>
              i === index ? { ...current, scope: { kind: 'all' as const } } : current,
            ),
          }),
        });
      });
    }
    return mutants;
  },
};
