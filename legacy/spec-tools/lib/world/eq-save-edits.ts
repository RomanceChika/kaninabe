/**
 * 同じ鍵の押し直しで**1 欄だけ変える**ときの別の値(点検 21 回目の後の samples:db の赤。この仕組みの持ち主はこのモジュール)。
 *
 * 押し直しの性質(`framework/runtime/testing/save/resend.mts`)は、変える値が宣言の範囲の外だと押し直しの比べより先に欄の CHECK で落ち、
 * 確かめたい拒否(`resend_input_mismatch`)に届かない。ここが宣言から範囲の中の別の値を決め、設計図(`eq-save-inputs.ts` の
 * `EqSaveInput.edits`)に運ぶ。値の写像は world の値と同じ 1 本(`rls-world-values.ts` の `valueOfField`)である。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef } from '../model/types.js';
import type { ScenarioValue } from '../usecase/plan-scenario-values.js';
import { effectivePattern, valueOfField } from './rls-world-values.js';

/** 別の値を決める文脈(押し直し用の連番と、欄の順位)。 */
export interface EditAt {
  /** 押し直しの値の連番を 1 つ取る(入力の値の連番と別。入力の値を動かさない)。 */
  readonly nextEdit: () => number;
  /** 欄名 → 日時・数値の順位(順序の宣言に出る欄は変えない)。 */
  readonly order: ReadonlyMap<string, number>;
}

/**
 * その欄を押し直しで変えるときの別の値(宣言の範囲の中。変えられなければ null)。純関数(連番だけ進める)。
 *
 * | 型 | 別の値 |
 * |---|---|
 * | enum | 今の値と違う最初の要素(要素が 1 つなら null) |
 * | integer / decimal | 範囲の中の別の値(順序の宣言に出る欄・範囲が 1 点なら null) |
 * | string / text ほか文字列 | 押し直し用の連番の値(長さ・書式は world の値と同じ写像。書式に合わなければ null) |
 * | boolean / date / datetime / uuid / ref | null(含意・順序・参照の宣言に当たりうる) |
 *
 * @param field 欄の宣言
 * @param current 1 回目に送る値
 * @param at 押し直しの値の連番と順位
 * @returns 別の値か null
 */
export function editedValueOf(field: FieldDef, current: ScenarioValue | undefined, at: EditAt): ScenarioValue | null {
  switch (field.type.kind) {
    case 'enum':
      return field.type.values.find((value) => value !== current) ?? null;
    case 'integer':
    case 'decimal':
      return at.order.has(field.name) ? null : otherNumber(field, current);
    case 'boolean':
    case 'date':
    case 'datetime':
    case 'uuid':
    case 'ref':
    case 'state':
      return null;
    default: {
      const value = valueOfField(field, { rowIndex: 0, next: at.nextEdit, order: at.order });
      const pattern = effectivePattern(field);
      if (value === current || typeof value !== 'string') return null;
      return pattern === undefined || new RegExp(pattern, 'u').test(value) ? value : null;
    }
  }
}

/** 範囲の中の別の数(+1 か、上限なら下限側へ 1 つ戻す。範囲が 1 点なら null)。 */
function otherNumber(field: FieldDef, current: ScenarioValue | undefined): number | null {
  if (typeof current !== 'number') return null;
  const up = current + 1;
  if (field.max === undefined || up <= field.max) return up;
  const down = current - 1;
  return field.min === undefined || down >= field.min ? down : null;
}
