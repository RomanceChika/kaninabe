/**
 * 保存点の判定の grid が大きすぎるときに**どの軸をどの順で畳むか**(束 ⑳-5a2-b)。
 *
 * 単発の操作(`eq-cases.ts`)と**同じ二段**である。
 *
 * | 段 | 上限 | 畳む相手 | なぜその順か |
 * |---|---:|---|---|
 * | 1 | `CASE_LIMIT` | ガード変数の境界値 | 値を減らしても**成立側と不成立側の両方が残る**畳み方が既にある(`eq-fold.ts`) |
 * | 2 | `HARD_LIMIT` | 呼び出し元の文脈 → 外の状態 → 繰り返しの件数 | いちばん落としたくない軸(実行者)を最後まで残す |
 *
 * 二段なのは、**畳みは情報を捨てる**からである。1 段目はガードの成立 / 不成立を保ったまま値を
 * 減らせるので安く、2 段目は「代表値で実行した」に落ちるので高い —— 高いほうを `CASE_LIMIT` の
 * 直後に実行すると、少し超えただけの保存点まで代表値になる。
 *
 * **軸そのものは落とさない。** 落とした軸は「実行されていない」であり、畳んだ軸は「代表値で
 * 実行した」である。畳んだ軸はテスト名に出る(`messages-eq.ts`)。
 *
 * 二段目を通しても収まらない形は残る —— 実行者の数と軸の本数(1 本 2 値にしても 2^n)は
 * 畳まないからである。単発の操作と同じ線引きであり、そこまで大きい保存点が現れたときは
 * **軸を減らす設計(手順を分ける)**の合図である。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { EqAxis, EqFoldedAxis, EqFoldedGuard } from './eq-cases.js';
import { CASE_LIMIT, HARD_LIMIT } from './eq-cases.js';

/**
 * 畳む前の判定の grid。
 *
 * 呼び出し元の文脈は**型を問わない**(`C`)—— ここが見るのは並びの長さだけであり、中身を
 * 知る必要が無い(知ると軸の意味が 2 か所に散る)。
 */
export interface EqSaveFoldInput<C> {
  /** 実行する実行者の数(畳まない)。 */
  readonly actors: number;
  readonly callers: readonly C[];
  /** 外の集約の状態の軸。 */
  readonly stateAxes: readonly EqAxis[];
  /** ガード変数の軸。 */
  readonly valueAxes: readonly EqAxis[];
  /** 判定の grid が回す繰り返しの件数(入力を見ない保存点では 1 つ)。 */
  readonly repeats: readonly number[];
  /** 判定の grid が回す入力の形(入力を見ない保存点では 1 つ)。 */
  readonly inputs: readonly string[];
  /** ガード変数の軸を成立 / 不成立の 2 側に畳む(充足性の witness から)。 */
  readonly foldGuards: (axes: readonly EqAxis[]) => {
    readonly axes: readonly EqAxis[];
    readonly folded: readonly EqFoldedGuard[];
  };
}

/** 畳んだあとの判定の grid。 */
export interface EqSaveFoldResult<C> {
  readonly callers: readonly C[];
  readonly stateAxes: readonly EqAxis[];
  readonly valueAxes: readonly EqAxis[];
  readonly repeats: readonly number[];
  readonly inputs: readonly string[];
  /** 畳んだあとの直積の大きさ。 */
  readonly count: number;
  /** 代表値に畳んだ軸(畳んでいなければ空)。 */
  readonly folded: readonly EqFoldedAxis[];
  /** 畳んだガード変数の内訳(成立側と不成立側の両方を残す)。 */
  readonly foldedGuards: readonly EqFoldedGuard[];
}

/**
 * 判定の grid を上限に収まるまで畳む。
 *
 * @param input 畳む前の軸と、ガード変数の畳み方
 * @returns 畳んだあとの軸・大きさ・畳んだことの表示
 */
export function foldSaveGrid<C>(input: EqSaveFoldInput<C>): EqSaveFoldResult<C> {
  const state: Mutable<C> = {
    callers: input.callers,
    stateAxes: input.stateAxes,
    valueAxes: input.valueAxes,
    repeats: input.repeats,
    inputs: input.inputs,
    folded: [],
    foldedGuards: [],
  };
  const size = (): number =>
    input.actors *
    state.callers.length *
    product(state.stateAxes) *
    product(state.valueAxes) *
    state.repeats.length *
    state.inputs.length;
  if (size() > CASE_LIMIT && state.valueAxes.some((axis) => axis.values.length > 2)) {
    const result = input.foldGuards(state.valueAxes);
    state.valueAxes = result.axes;
    state.foldedGuards = result.folded;
    if (result.folded.length > 0) state.folded.push('guard');
  }
  if (size() > HARD_LIMIT && state.callers.length > 2) {
    state.callers = ends(state.callers);
    state.folded.push('array');
  }
  if (size() > HARD_LIMIT && state.stateAxes.some((axis) => axis.values.length > 2)) {
    state.stateAxes = state.stateAxes.map((axis) => ({ ...axis, values: ends(axis.values) }));
    state.folded.push('state');
  }
  if (size() > HARD_LIMIT && state.repeats.length > 2) {
    state.repeats = ends(state.repeats);
    state.folded.push('input');
  }
  return { ...state, count: size() };
}

/** 畳んでいる途中の軸(この関数の中でだけ書き換わる)。 */
interface Mutable<C> {
  callers: readonly C[];
  stateAxes: readonly EqAxis[];
  valueAxes: readonly EqAxis[];
  repeats: readonly number[];
  inputs: readonly string[];
  readonly folded: EqFoldedAxis[];
  foldedGuards: readonly EqFoldedGuard[];
}

/** 直積の大きさ。 */
function product(axes: readonly EqAxis[]): number {
  return axes.reduce((total, axis) => total * Math.max(axis.values.length, 1), 1);
}

/** 両端 2 つ(2 つ以下ならそのまま)。 */
function ends<T>(values: readonly T[]): readonly T[] {
  if (values.length <= 2) return values;
  const first = values[0];
  const last = values[values.length - 1];
  return first === undefined || last === undefined ? values : [first, last];
}
