/**
 * 保存点の**判定の軸**(外部集約の状態とガード変数)の導出(束 ⑳-5a2)。
 *
 * このファイルが答えるのは「判定の軸の 1 本ずつが**どの値を取りうるか**」(外部集約の状態の候補と
 * ガード変数の境界値)だけである。それらの軸をどの grid に入れて掛け合わせるか(組み合わせの組み方)は
 * `eq-save-cases.ts` が持つ。軸の値の**置き方**は単発の操作と同じ 1 つの写像
 * (`eq-placements.ts` の `guardAxes`)を通る —— 日時を行ぜんたいで置き直すことも、`claim` の
 * 含意を緩めることも、保存点だけ忘れる形を作らないためである。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DomainEnv, GuardExpr } from '../guard/ast.js';
import type { FieldDef, FieldType, SpecModel } from '../model/types.js';
import { parseGuard } from '../guard/parser.js';
import { findField } from '../semantics/domain-index.js';
import type { BuiltSave } from '../usecase/plan-build.js';
import type { FieldBounds } from '../usecase/field-bounds.js';
import { boundsOf } from '../usecase/field-bounds.js';
import { seedsOf } from '../usecase/plan-scenario-values.js';
import type { EqAxis } from './eq-cases.js';
import { axisEnv } from './eq-fold.js';
import { guardAxes } from './eq-placements.js';

/** 軸の導出に要る入力(`eq-save-cases.ts` の入力と同じ形)。 */
export interface EqSaveAxesInput {
  readonly domain: SpecModel;
  readonly built: BuiltSave;
}

/** ガード式の変数 1 本(値の候補が作れる形)。 */
export interface EqSaveVariable {
  readonly key: string;
  readonly ref: string;
  readonly type: FieldType | null;
  readonly states: readonly string[];
  /** その欄が宣言した値の範囲(数の候補をここで切る。`ScenarioVariableRef` と同じ理由)。 */
  readonly bounds: FieldBounds;
}

/**
 * 外部集約の状態の軸(手順が「外の行の状態」を条件にするもの)。
 *
 * 値の並びは**宣言された遷移元が先**である —— 上限を超えて両端に畳むとき、成立する側が
 * 落ちないようにするためである(`eq-cases.ts` の `statesOf` と同じ理由)。
 */
export function stateAxesOf(input: EqSaveAxesInput): readonly EqAxis[] {
  const axes: EqAxis[] = [];
  for (const [index, step] of input.built.plan.steps.entries()) {
    const from = input.built.facts.steps[index]?.stateFrom;
    if (from === undefined || from === null || from.kind !== 'external') continue;
    if (axes.some((axis) => axis.key === from.ref)) continue;
    const [entity, column] = from.ref.split('.');
    if (entity === undefined || column === undefined) continue;
    const field = findField(input.domain, entity, column);
    const states = field?.type.kind === 'state' ? statesOf(input.domain, field.type.machine) : [];
    if (states.length === 0) continue;
    const declared = step.event?.from ?? [];
    const ordered = [...declared.filter((state) => states.includes(state)), ...states.filter((state) => !declared.includes(state))];
    axes.push({
      key: from.ref,
      values: ordered.map((state) => ({
        label: state,
        placements: [{ entity, column, value: state, into: 'row' as const }],
      })),
    });
  }
  return axes;
}

/** その状態機械の状態の全集合。 */
export function statesOf(domain: SpecModel, machine: string): readonly string[] {
  for (const specs of domain.aggregates.values()) {
    for (const spec of specs.stateMachines) {
      if (spec.machine === machine) return spec.states;
    }
  }
  return [];
}

/** ガード変数の軸(外の行から読む変数だけ。状態の軸が受け持つ参照は除く)。 */
export function guardValueAxes(
  input: EqSaveAxesInput,
  stateAxes: readonly EqAxis[],
  guards: readonly GuardExpr[],
): readonly EqAxis[] {
  return guardAxes({
    domain: input.domain,
    variables: variablesOf(input),
    excluded: stateAxes.map((axis) => axis.key),
    inputEntity: null,
    seeds: guards.flatMap((guard) => seedsOf(guard)),
  });
}

/** ガード式の変数(外の行から読むものだけ。全手順の和・重複なし)。 */
function variablesOf(
  input: EqSaveAxesInput,
): readonly EqSaveVariable[] {
  const found = new Map<string, EqSaveVariable>();
  for (const step of input.built.facts.steps) {
    for (const fact of step.guardFacts) {
      if (fact.source.kind !== 'external' || found.has(fact.variable)) continue;
      const [entity, column] = fact.source.ref.split('.');
      const field: FieldDef | null =
        entity === undefined || column === undefined ? null : findField(input.domain, entity, column);
      const type = field?.type ?? null;
      found.set(fact.variable, {
        key: fact.variable,
        ref: fact.source.ref,
        type,
        states: type?.kind === 'state' ? statesOf(input.domain, type.machine) : [],
        bounds: boundsOf(field),
      });
    }
  }
  return [...found.values()];
}

/** 予約語 `now` に当たる鍵(全手順の和)。 */
function nowKeysOf(input: EqSaveAxesInput): readonly string[] {
  const found = new Set<string>();
  for (const step of input.built.facts.steps) {
    for (const fact of step.guardFacts) {
      if (fact.source.kind === 'now') found.add(fact.variable);
    }
  }
  return [...found];
}

/** 充足性判定に渡す変数のドメイン。 */
export function envOf(input: EqSaveAxesInput): DomainEnv {
  return axisEnv(input.domain, variablesOf(input), nowKeysOf(input));
}

/** その保存点が見るガード式の全数(手順ごとの遷移のガードと、access_spec の規則の条件)。 */
export function guardExpressions(input: EqSaveAxesInput): readonly GuardExpr[] {
  const sources: string[] = [];
  for (const step of input.built.plan.steps) {
    if (step.event?.guard !== undefined && step.event.guard !== null) sources.push(step.event.guard);
    for (const when of accessConditions(input.domain, step.kind, step.entity)) sources.push(when);
  }
  const parsed: GuardExpr[] = [];
  for (const source of [...new Set(sources)]) {
    const result = parseGuard(source);
    if (result.ok) parsed.push(result.expr);
  }
  return parsed;
}

/** 形に対応する access_spec の規則の条件(宣言順)。 */
function accessConditions(domain: SpecModel, kind: string, entity: string): readonly string[] {
  for (const specs of domain.aggregates.values()) {
    const access = specs.access;
    if (access?.entity !== entity) continue;
    const rules = kind === 'delete' ? access.deletes : kind === 'update' ? access.writes : access.creates;
    return rules.flatMap((rule) => (rule.when === undefined ? [] : [rule.when]));
  }
  return [];
}
