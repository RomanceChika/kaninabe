/**
 * 集約とモデル全体。5 つの doc_type の型を束ねて、検証器・生成器への唯一の入力を作る。
 *
 * 入口は types.ts(ファサード)。モデル横断の小さなヘルパー(allMachines)もここに置く
 * — SpecModel の形を知っている必要があり、利用側 5 か所以上で同じ二重ループを書かせないため。
 */

import type { AccessSpec } from './types-access.js';
import type { EntitySpec } from './types-entity.js';
import type { InvariantSpec } from './types-invariant.js';
import type { RoleSpec } from './types-role.js';
import type { StateMachineSpec } from './types-state.js';

/** 1 集約(specs/domain/{aggregate}/ ディレクトリ)に属する仕様の束。 */
export interface AggregateSpecs {
  readonly name: string;
  readonly entity?: EntitySpec;
  readonly stateMachines: readonly StateMachineSpec[];
  readonly access?: AccessSpec;
  readonly invariants?: InvariantSpec;
}

/**
 * ドメイン仕様全体。検証器への唯一の入力。
 * loader だけがこれを構築する。テストではリテラルで直接構築してよい(むしろ推奨)。
 */
export interface SpecModel {
  readonly roles: RoleSpec;
  /** キー = 集約名 */
  readonly aggregates: ReadonlyMap<string, AggregateSpecs>;
}

/** モデル横断のユーティリティが使う: 全状態機械を (集約名, 機械) で列挙する。 */
export interface MachineRef {
  readonly aggregate: string;
  readonly machine: StateMachineSpec;
}

/** SpecModel から全状態機械をフラットに列挙するヘルパー。 */
export function allMachines(model: SpecModel): MachineRef[] {
  const result: MachineRef[] = [];
  for (const [aggregate, specs] of model.aggregates) {
    for (const machine of specs.stateMachines) {
      result.push({ aggregate, machine });
    }
  }
  return result;
}
