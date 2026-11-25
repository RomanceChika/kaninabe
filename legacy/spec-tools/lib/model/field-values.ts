/**
 * 「このフィールドが取り得る値は何か」を答える純粋モジュール。
 *
 * 型が閉じた有限集合を指すのは 3 つだけ(`state(machine)` / `enum([...])` / `boolean`)であり、
 * その全列挙はガード式の充足性判定(変数ドメイン)と、リテラルの接地検査
 * (`state == publik` のような**実在しない値との比較**を落とす検査)の両方が使う。
 *
 * 2 か所に同じ対応表を書くと片方だけが直る事故が起きるため、正はここ 1 つに置く。
 */

import type { ValueKind } from '../guard/value-kind.js';
import type { FieldType } from './types-entity.js';
import type { SpecModel } from './types-model.js';

export type { ValueKind };

/** boolean フィールドが取り得る値(ガード式ではリテラル `true` / `false` と比較する)。 */
export const BOOLEAN_VALUES: readonly string[] = ['true', 'false'];

/**
 * モデル中の全状態機械を「機械名 → 状態 ID 一覧」に畳み込む。
 * `state(machine)` 型フィールドの値域を引くのに使う。
 *
 * @param model 検証対象のドメイン仕様全体
 * @returns 機械名をキー、その機械の states を値とするマップ
 */
export function collectMachineStates(model: SpecModel): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, readonly string[]>();
  for (const specs of model.aggregates.values()) {
    for (const machine of specs.stateMachines) {
      result.set(machine.machine, machine.states);
    }
  }
  return result;
}

/**
 * フィールド型が取り得る値の全列挙を返す。
 *
 * 参照先の状態機械が未定義の場合(V2 が別途エラーにする)は null を返す。
 * 「値域が分からない」と「値域が空」を混同させないためである。
 *
 * @param type entity_spec のフィールド型
 * @param machineStates 機械名 → 状態一覧(collectMachineStates の結果)
 * @returns 有限の値集合。閉じた集合を持たない型(数値・日時・文字列・参照)なら null
 */
export function finiteValuesOfField(
  type: FieldType,
  machineStates: ReadonlyMap<string, readonly string[]>,
): readonly string[] | null {
  switch (type.kind) {
    case 'state':
      return machineStates.get(type.machine) ?? null;
    case 'enum':
      return type.values;
    case 'boolean':
      return BOOLEAN_VALUES;
    default:
      return null;
  }
}

/**
 * フィールド型 → 値の種別。
 *
 * @param type entity_spec のフィールド型
 * @returns 比較の観点で畳んだ値の種別
 */
export function valueKindOfFieldType(type: FieldType): ValueKind {
  switch (type.kind) {
    case 'boolean':
      return 'boolean';
    case 'integer':
    case 'decimal':
      return 'number';
    case 'date':
    case 'datetime':
      return 'datetime';
    case 'uuid':
    case 'ref':
      return 'opaque';
    case 'string':
    case 'text':
    case 'enum':
    case 'state':
      return 'text';
  }
}
