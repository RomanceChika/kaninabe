/**
 * 作成の組み合わせの入力のうち、**world の行と一意の鍵で当たらない値に置き直す欄**(点検 20 回目 B20-1 の残り 2)。
 *
 * 作成の入力は対象の行の雛形(その系統に置いた同じ集約の行)から取る(`@kaninabe/runtime/testing/equivalence/world` の `inputOf`。
 * 束縛の判定に雛形の参照が要るため)。ところが雛形の行は **world に既にある行**なので、一意の宣言(`formal.type: uniqueness`)の
 * 鍵の欄まで雛形から写すと、許可された作成が全部その索引に当たる(製品の実測: 子の集約の作成が親と順番の鍵の組に当たり、
 * engine の許可と RPC の制約違反は「一致」に数えられるので黙って緑になり、送り直しの性質は 1 度も実行されなかった)。
 *
 * そこで、その集約が鍵に入る一意の宣言ごとに、**参照でない鍵の欄を 1 つ**選び、world のその集約の行のどれとも違う値を決める
 * (参照の欄は束縛と系統の判定に効くので動かさない。参照でない欄が 1 つ違えば鍵の組は当たらない)。実行する側は、作成のときに
 * 雛形の値の上からこの値を置く(軸の置き直しはさらにその上)。
 *
 * もう 1 つ、**別の集約の欄との順序の宣言**(`formal.type: check` の `{自集約}.{欄} >= {別の集約}.{欄}` の形)に入る入力の欄も
 * 置き直す。入力の既定値(`inputs`。型から決めた固定の値)は world の祖先の行の値を知らないので、順序の宣言に当たりうる(製品の実測: 子の
 * 開始時刻の既定値が親の開始より前で、許可された作成が全部 INV の執行点に当たった)。値は world のその集約の行のその欄の最大(または
 * 最小)から 1 刻み(1 日・1)ずらした値である。
 *
 * 値の決め方は型から機械的に決める(`rls-world-values.ts` と同じ流儀): 整数・小数は宣言された範囲の中で world が使っていない最小の
 * 値、文字列は `{欄}-fresh`(使われていれば番号を足す。`max_length` を超えない)。`pattern` / `format` を持つ欄・範囲が使い切られた
 * 欄・ほかの型は置き直さない(その宣言は、送り直しの性質が 0 件で赤になることで読める —— `resend.mts`)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef, SpecModel } from '../model/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import type { ScenarioValue } from '../usecase/plan-scenario-values.js';
import { comparisonsOf, effectivePattern } from './rls-world-values.js';
import type { Comparison } from './rls-world-values.js';
import type { EqWorld } from './eq-world-types.js';

/** 置き直しを探す数値の幅(上限を宣言しない欄で、下限からこの数だけ探す)。 */
const NUMBER_SPAN = 10_000;

/** 置き直しを求めるのに要る入力。 */
export interface EqFreshInput {
  readonly domain: SpecModel;
  /** 作成する集約。 */
  readonly entity: string;
  /** 作成の入力の欄(この中の欄だけを置き直す)。 */
  readonly inputKeys: readonly string[];
}

/**
 * 作成の入力のうち、world の行と一意の鍵で当たらない値に置き直す欄と値。
 *
 * @param world その集約の world(行の値を読む)
 * @param input 集約と入力の欄
 * @returns 欄 → 置き直す値(置き直す欄が無ければ空)
 */
export function freshInputsOf(world: Pick<EqWorld, 'rows'>, input: EqFreshInput): Readonly<Record<string, ScenarioValue>> {
  const fields = findEntitySpec(input.domain, input.entity)?.fields ?? [];
  const fresh: Record<string, ScenarioValue> = {};
  for (const keys of uniqueKeysOf(input.domain, input.entity)) {
    if (keys.some((key) => fresh[key] !== undefined)) continue;
    for (const key of keys) {
      const field = fields.find((candidate) => candidate.name === key);
      if (field === undefined || !input.inputKeys.includes(key)) continue;
      const used = new Set(world.rows.filter((row) => row.entity === input.entity).map((row) => row.values[key]));
      const value = unusedValue(field, used);
      if (value === null) continue;
      fresh[key] = value;
      break;
    }
  }
  for (const [key, value] of Object.entries(orderedInputsOf(world, input, fields))) if (fresh[key] === undefined) fresh[key] = value;
  return fresh;
}

/** 1 日(日時の刻み)。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 別の集約の欄との順序の宣言に入る入力の欄を、world の祖先の行の値の外側へ置く。 */
function orderedInputsOf(world: Pick<EqWorld, 'rows'>, input: EqFreshInput, fields: readonly FieldDef[]): Readonly<Record<string, ScenarioValue>> {
  const result: Record<string, ScenarioValue> = {};
  for (const comparison of crossComparisonsOf(input.domain, input.entity)) {
    const own = sideOf(comparison, input.entity);
    if (own === null || result[own.field] !== undefined || !input.inputKeys.includes(own.field)) continue;
    const field = fields.find((candidate) => candidate.name === own.field);
    const values = world.rows.filter((row) => row.entity === own.otherEntity).map((row) => row.values[own.otherField]);
    const value = field === undefined ? null : beyond(field, values, own.after);
    if (value !== null) result[own.field] = value;
  }
  return result;
}

/** その集約が入る行内比較の宣言の比較のうち、両辺が別々の集約の欄であるもの。 */
function crossComparisonsOf(domain: SpecModel, entity: string): readonly Comparison[] {
  const found: Comparison[] = [];
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      const formal = invariant.formal;
      if (formal?.kind !== 'check' || !invariant.entities.includes(entity)) continue;
      found.push(...comparisonsOf(formal.expr).filter((comparison) => comparison.right !== null && comparison.op !== '==' && comparison.op !== '!='));
    }
  }
  return found;
}

/** 比較の自集約の側(自集約の欄が相手より後ろ = after)。自集約の欄と別の集約の欄の比較でなければ null。 */
function sideOf(
  comparison: Comparison,
  entity: string,
): { readonly field: string; readonly otherEntity: string; readonly otherField: string; readonly after: boolean } | null {
  const [leftEntity, leftField] = comparison.left.segments;
  const [rightEntity, rightField] = comparison.right?.segments ?? [];
  if (leftEntity === undefined || leftField === undefined || rightEntity === undefined || rightField === undefined) return null;
  const leftAfter = comparison.op === '>' || comparison.op === '>=';
  if (leftEntity === entity && rightEntity !== entity) return { field: leftField, otherEntity: rightEntity, otherField: rightField, after: leftAfter };
  if (rightEntity === entity && leftEntity !== entity) return { field: rightField, otherEntity: leftEntity, otherField: leftField, after: !leftAfter };
  return null;
}

/** world の値の全部より後ろ(または前)へ 1 刻みずらした値(値が無い・型が順序を持たなければ null)。 */
function beyond(field: FieldDef, values: readonly unknown[], after: boolean): ScenarioValue {
  const pick = (numbers: readonly number[]): number => (after ? Math.max(...numbers) : Math.min(...numbers));
  switch (field.type.kind) {
    case 'integer':
    case 'decimal': {
      const numbers = values.filter((value): value is number => typeof value === 'number');
      return numbers.length === 0 ? null : pick(numbers) + (after ? 1 : -1);
    }
    case 'date':
    case 'datetime': {
      const times = values.filter((value): value is string => typeof value === 'string').map((value) => Date.parse(value)).filter((time) => !Number.isNaN(time));
      if (times.length === 0) return null;
      const iso = new Date(pick(times) + (after ? DAY_MS : -DAY_MS)).toISOString();
      return field.type.kind === 'date' ? iso.slice(0, 10) : iso;
    }
    default:
      return null;
  }
}

/** その集約が鍵に入る一意の宣言の鍵の並び(宣言順)。 */
function uniqueKeysOf(domain: SpecModel, entity: string): readonly (readonly string[])[] {
  const keys: (readonly string[])[] = [];
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      const formal = invariant.formal;
      if (formal?.kind !== 'uniqueness' || !invariant.entities.includes(entity)) continue;
      keys.push(formal.keys);
    }
  }
  return keys;
}

/** world がその欄に使っていない値(決められなければ null)。参照・真偽・列挙・日時の欄は置き直さない。 */
function unusedValue(field: FieldDef, used: ReadonlySet<unknown>): ScenarioValue {
  if (effectivePattern(field) !== undefined) return null;
  switch (field.type.kind) {
    case 'integer':
    case 'decimal': {
      const min = field.min ?? 1;
      const max = field.max ?? min + NUMBER_SPAN;
      for (let value = min; value <= max; value += 1) if (!used.has(value)) return value;
      return null;
    }
    case 'string':
    case 'text': {
      for (let n = 0; n < NUMBER_SPAN; n += 1) {
        const value = n === 0 ? `${field.name}-fresh` : `${field.name}-fresh-${String(n)}`;
        if (field.maxLength !== undefined && value.length > field.maxLength) return null;
        if (!used.has(value)) return value;
      }
      return null;
    }
    default:
      return null;
  }
}
