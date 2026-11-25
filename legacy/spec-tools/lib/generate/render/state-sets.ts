/**
 * 不変条件から「アクティブな状態」の集合を導く純粋モジュール。
 *
 * 終端状態の補集合(`{machine}NonFinalStates`)は state_spec から機械的に決まるが、
 * **業務が「アクティブ」と呼ぶ集合はそれと一致するとは限らない**(却下・取下げが終端でなくても
 * 「もう数えない」ことはあり得る)。その正は不変条件の `where` 句であり、ここはその写像である。
 *
 * 導出の対象は `state not in [...]` の形の `where` だけとする。否定形は「この状態のものは
 * 対象から外れる = 残りがアクティブ」という表現であり、肯定形(`state in [...]`)は
 * 「数える対象の集合」であってアクティブの定義ではない(例: 定員を数える対象)。
 * 候補が複数あって結論が食い違う場合は、どちらかを選ぶ根拠が仕様に無いので**何も導かない**。
 */

import type { GuardExpr, GuardServices } from '../../guard/ast.js';
import type { InvariantDef, StateMachineSpec } from '../../model/types.js';

/** 状態を表すフィールド名(entity_spec の `state(...)` 型のフィールド)。 */
const STATE_FIELD = 'state';

/** 導出できたアクティブ状態集合と、その根拠になった不変条件。 */
export interface ActiveStates {
  /** 状態機械の宣言順に並べたアクティブな状態。 */
  readonly states: readonly string[];
  /** 導出元の不変条件 ID(複数一致した場合は宣言順に並べる)。 */
  readonly sources: readonly string[];
}

/**
 * 不変条件の `where` から、その状態機械のアクティブな状態集合を導く。
 *
 * @param machine 対象の状態機械(状態の全体集合と並び順の正)
 * @param invariants 同じ集約の不変条件(空でもよい)
 * @param entities `where` の中で状態フィールドの前置に使ってよいエンティティ名
 * @param guards ガード式の解析サービス
 * @returns 導出できた集合。候補が無い・結論が食い違う場合は null
 */
export function activeStatesFromInvariants(
  machine: StateMachineSpec,
  invariants: readonly InvariantDef[],
  entities: readonly string[],
  guards: GuardServices,
): ActiveStates | null {
  const candidates: { readonly id: string; readonly states: readonly string[] }[] = [];
  for (const invariant of invariants) {
    const where = whereOf(invariant);
    if (where === undefined) continue;
    const parsed = guards.parse(where);
    if (!parsed.ok) continue;
    const excluded = excludedStates(parsed.expr, entities);
    if (excluded === null) continue;
    candidates.push({
      id: invariant.id,
      states: machine.states.filter((state) => !excluded.includes(state)),
    });
  }

  const first = candidates[0];
  if (first === undefined) return null;
  const agreed = candidates.every((candidate) => same(candidate.states, first.states));
  return agreed ? { states: first.states, sources: candidates.map((c) => c.id) } : null;
}

/** `where` 句を持つ形式定義(uniqueness / exclusion / cardinality)からだけ取り出す。 */
function whereOf(invariant: InvariantDef): string | undefined {
  const formal = invariant.formal;
  if (formal === undefined) return undefined;
  if (formal.kind !== 'uniqueness' && formal.kind !== 'exclusion' && formal.kind !== 'cardinality') return undefined;
  return formal.where;
}

/**
 * `{entity}.state not in [a, b]` の形から、除外される状態を取り出す。
 *
 * 他の形(肯定形・複合式・状態以外のフィールド)は「アクティブの定義」ではないので null。
 */
function excludedStates(expr: GuardExpr, entities: readonly string[]): readonly string[] | null {
  if (expr.kind !== 'not') return null;
  const operand = expr.operand;
  if (operand.kind !== 'in') return null;
  if (!isStatePath(operand.path.segments, entities)) return null;
  const values: string[] = [];
  for (const value of operand.values) {
    if (value.kind !== 'symbol') return null;
    values.push(value.value);
  }
  return values;
}

/** パスが対象エンティティの状態フィールドを指しているか(裸の `state` も認める)。 */
function isStatePath(segments: readonly string[], entities: readonly string[]): boolean {
  if (segments.length === 1) return segments[0] === STATE_FIELD;
  if (segments.length !== 2) return false;
  return segments[1] === STATE_FIELD && entities.includes(segments[0] ?? '');
}

/** 2 つの状態集合が同じ並びか。 */
function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((state, index) => state === b[index]);
}
