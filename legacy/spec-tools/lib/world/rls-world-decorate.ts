/**
 * world の行 1 つに、**宣言から決まる値を差し込む**写像(束 ⑳-4b)。
 *
 * `rls-world.ts` が呼ぶ下位の部品で、責務は 1 つ —— 「型から機械的に置いた行」を、その系統の
 * 実行者と噛み合う行にすることである。差し込むものは 2 つだけである。
 *
 * - **`claim` の欄**(そのロールの実行者自身の行だけ真)とその含意
 * - **境界(`filters`)の列**(その系統の実行者の行の欄を写す。親の列なら、その系統の親の行に写す)
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AccessSpec, SpecModel } from '../model/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import { resolveReadFilter } from '../model/read-filter-path.js';
import { actorEntity } from '../usecase/param-source-facts.js';
import type { RlsWorldActor } from './rls-world-roles.js';
import { holdingValues, unmetValues } from './rls-world-claims.js';
import { isValueSupplied } from './rls-world-values.js';
import type { RlsWorldRow } from './rls-world-rows.js';
import { withBoundary, withValues } from './rls-world-rows.js';

/**
 * 境界の列(実行者の属性を写す)と `claim` の欄(そのロールの実行者だけ真)を差し込む。
 *
 * @param input 行・実行者・ドメイン仕様・アクセス宣言・表・その系統の実行者自身の行
 * @returns 値を差し込んだ行
 */
export function decorateRow(input: DecorateInput): RlsWorldRow {
  const { row, actor, domain, access, tables, actorRow } = input;
  // 実行者自身の行だけを置き直す(束縛のために分けた同じ集約の行は別人であり、その人の欄まで
  // 条件を満たす値にすると「その根拠を持たない人」が world から消える)。
  // 満たす人は条件を満たす値、満たさない人(`unmet`)は条件の外の値を置く。state / enum の欄に `true` は置かない。
  const values =
    row.actor === actor.key && row.entity === actorEntity(domain)
      ? actor.unmet === undefined
        ? holdingValues(domain, actor.role)
        : unmetValues(domain, actor.role, actor.unmet)
      : {};
  // 欄を真にするだけでは足りない —— 「その欄が真なら別の欄はこう」という行内比較があれば、
  // その含意の側も置かなければ行そのものが DB に入らない(INV の写しであって発明ではない。`holdingValues` が一緒に置く)。
  const withClaim = Object.keys(values).length > 0 ? withValues(row, values) : row;
  const fields: Record<string, string> = {};
  for (const rule of access.reads) {
    for (const filter of rule.filters ?? []) {
      // 境界の列を持つ行(自集約の列なら的の行、親の列ならその系統の親の行)にだけ写す。
      const resolution = resolveReadFilter(domain, access.entity, filter);
      if (!resolution.ok || resolution.resolved.entity !== row.entity) continue;
      // DB が決める列(既定値・トリガが埋める列)には書かない —— 写しの列はその親から
      // 埋まるのであって、テストが実行者の値を書き写す場所ではない。
      if (isValueSupplied(resolution.resolved.field, defaultsOf(tables, row.entity))) fields[filter.field] = filter.actorField;
    }
  }
  return withBoundary(withClaim, actorRow, fields);
}

/** その集約の data_table が宣言した列の既定値(表が無ければ空)。 */
function defaultsOf(tables: readonly DataTableSpec[], entity: string): Readonly<Record<string, string>> {
  return tables.find((candidate) => candidate.entity === entity)?.defaults ?? {};
}

/** 1 行に宣言を差し込むのに要るもの。 */
export interface DecorateInput {
  readonly row: RlsWorldRow;
  readonly actor: RlsWorldActor;
  readonly domain: SpecModel;
  readonly access: AccessSpec;
  /** 全 data_table(境界の列を持つ集約の既定値を引く)。 */
  readonly tables: readonly DataTableSpec[];
  /** その系統の実行者自身の行(境界の列の値の出どころ)。 */
  readonly actorRow: RlsWorldRow | undefined;
}
