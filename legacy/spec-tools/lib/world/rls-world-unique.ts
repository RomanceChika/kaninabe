/**
 * world の行の組み立てが使う、一意の鍵になっている欄の読み(純関数)。
 *
 * 仕様: docs/rules/process/common/specification/standards/domain-spec-writing.md(`formal.type: uniqueness`)
 *
 * 呼び側(`rls-world-rows.ts`)は参照の欄だけを使う。宣言の読み(不変条件)と行の組み立て(world)は別の責務なので別のファイルに置く。
 */

import type { SpecModel } from '../model/types.js';

/**
 * その集約の、**単独で一意の鍵になっている**欄(`formal.type: uniqueness` で鍵がその 1 欄だけ・`where` なし)。
 *
 * @param domain ドメイン仕様
 * @param entity 対象の集約
 * @returns 欄の名前の集合(参照の欄に限らず返す。呼び側が参照の欄だけを使う)
 */
export function uniqueRefColumnsOf(domain: SpecModel, entity: string): ReadonlySet<string> {
  const columns = new Set<string>();
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      const formal = invariant.formal;
      if (formal?.kind !== 'uniqueness' || formal.where !== undefined) continue;
      if (!invariant.entities.includes(entity) || formal.keys.length !== 1) continue;
      const key = formal.keys[0];
      if (key !== undefined) columns.add(key);
    }
  }
  return columns;
}
