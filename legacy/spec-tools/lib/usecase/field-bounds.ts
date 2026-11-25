/**
 * 欄が宣言した**値の範囲**と、数の候補をその範囲で切る 1 本。
 *
 * 種(ガード式の数値リテラル)の前後を並べる規則は、範囲を知らないと `min: 0` の欄に `-1` を
 * 出す。その値は entity_spec から導出した CHECK(`{表}_{列}_range`)に当たるので、engine が
 * 許可する組み合わせでも DB が 23514 で落ちる —— 一致の証明が「判定の食い違い」として赤になり、
 * 原因が権限の判定に見えてしまう(束 ③-2 で、下限 0 の金額の欄が実測)。
 *
 * `plan-scenario-values.ts` が持つのは「候補の作り方」、ここが持つのは「範囲の宣言の読み方」である
 * (欄の定義から範囲を取り出す `boundsOf` も、2 つの変数の組み立て — 単発の操作と保存点 — が
 * 同じ 1 本を使う)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef } from '../model/types.js';

/** 欄が宣言した値の範囲(宣言の無い辺は持たない)。 */
export interface FieldBounds {
  readonly min?: number;
  readonly max?: number;
}

/**
 * 数の候補を**欄が宣言した範囲で切る**。
 *
 * 種(式の数値リテラル)の前後を並べる規則は、範囲を知らないと `min: 0` の欄に `-1` を出す。
 * その値は entity_spec から導出した CHECK(`{表}_{列}_range`)に当たるので、engine が許可する
 * 組み合わせでも DB が 23514 で落ちる —— 一致の証明が「判定の食い違い」として赤になり、
 * 原因が権限の判定に見えてしまう(束 ③-2 で、下限 0 の金額の欄が実測)。
 *
 * **範囲の宣言が無い欄は従来どおり**(切らない)。切って空になったら辺の値 1 つに倒す ——
 * 候補が空になると軸そのものが消え、「実行していない」が緑に見える。
 */
export function withinBounds(values: readonly number[], bounds: FieldBounds): readonly number[] {
  const kept = values.filter(
    (value) => (bounds.min === undefined || value >= bounds.min) && (bounds.max === undefined || value <= bounds.max),
  );
  if (kept.length > 0) return kept;
  const edge = bounds.min ?? bounds.max;
  return edge === undefined ? values : [edge];
}

/**
 * 欄の定義から値の範囲を取り出す(宣言の無い辺は持たない)。
 *
 * @param field 欄の定義(引けなければ null)
 * @returns 宣言された範囲
 */
export function boundsOf(field: FieldDef | null): FieldBounds {
  return {
    ...(field?.min === undefined ? {} : { min: field.min }),
    ...(field?.max === undefined ? {} : { max: field.max }),
  };
}
