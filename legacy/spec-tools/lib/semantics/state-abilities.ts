/**
 * ある状態機械の各状態で、あるロールの集まりが**できること**の導出(結果表のロールの列の元)。
 *
 * 元は 2 つで、どちらも仕様の宣言である(新しい宣言は要らない):
 *
 * - **操作の `by`** … 状態機械の遷移(`events[].by`)。親の状態機械の遷移は `from` の状態でできる。
 *   別の状態機械の遷移は、`guard` が親の状態を条件にしているときだけ、その状態でできる
 * - **access の宣言** … `creates` / `writes` / `deletes` の `when` が親の状態を条件にしているとき、その状態で
 *   作れる・書ける・消せる。親の集約の `reads` は、状態で絞っていなければ全状態で読める
 *
 * 条件の式は**状態の原子だけ**を読む(`{親}.state == a`・`in [a, b]`・`!=`・`not`・`and` / `or`)。状態以外の原子
 * (時刻・欄の値)は「成り立つかもしれない」として全状態に通す。そのため結果は**できるかもしれない状態**(may)で、
 * 権限の厳密な判定ではない(`not` は状態の原子だけの式のときだけ補集合にする)。式が親の状態にふれない規則は、状態ごとの表に載せない。
 *
 * 純粋関数だけ(意味解析の層)。**アプリの語彙は 1 語も持たない。**
 */

import type { GuardExpr, PathRef } from '../guard/ast.js';
import { parseGuard } from '../guard/parser.js';
import type { AggregateSpecs, SpecModel, StateMachineSpec } from '../model/types.js';

/** できることの種類。 */
export type AbilityKind = 'read' | 'event' | 'create' | 'write' | 'delete';

/** できること 1 つ。 */
export interface StateAbility {
  readonly kind: AbilityKind;
  /** 何についてか(集約名。遷移は遷移を持つ集約)。 */
  readonly aggregate: string;
  /** 遷移の呼び名(`label`、無ければ id)。ほかの種類は空。 */
  readonly label: string;
}

/**
 * 式の近似の結果: 通りうる状態の集合(null = 全状態)・親の状態にふれたか・その集合が**ぴったり**かどうか。
 * `exact` は、式のすべての原子が状態の原子だったとき(= 集合が「式が成り立つ状態」そのものであるとき)だけ真。
 * 偽のときの集合は「成り立つかもしれない状態」(may)で、実際より広くてよいが、狭くてはならない。
 */
export interface StateApproximation {
  readonly states: ReadonlySet<string> | null;
  readonly mentions: boolean;
  readonly exact: boolean;
}

/** 状態以外の原子: どの状態でも成り立つかもしれない(may)。ぴったりではない。 */
const EVERY: StateApproximation = { states: null, mentions: false, exact: false };

/** 2 つの集合(null = 全状態)の積。 */
function intersect(a: ReadonlySet<string> | null, b: ReadonlySet<string> | null): ReadonlySet<string> | null {
  if (a === null) return b;
  if (b === null) return a;
  return new Set([...a].filter((state) => b.has(state)));
}

/** 2 つの集合(null = 全状態)の和。 */
function union(a: ReadonlySet<string> | null, b: ReadonlySet<string> | null): ReadonlySet<string> | null {
  if (a === null || b === null) return null;
  return new Set([...a, ...b]);
}

/** パスが親の状態を指すか(`{親のエンティティ}.{状態の欄}`。自分の集約の規則では、裸の `{状態の欄}` も)。 */
function isStatePath(path: PathRef, entity: string, field: string, own: boolean): boolean {
  const [first, second, ...rest] = path.segments;
  if (rest.length > 0) return false;
  if (second === undefined) return own && first === field;
  return first === entity && second === field;
}

/**
 * 式が通しうる状態を近似する。状態以外の原子は全状態に通し(may)、ぴったりでないと記す。
 * 否定は**ぴったりの内側**(状態の原子だけでできた式)のときだけ補集合にする。内側がぴったりでないときは全状態のままにする
 * —— 補集合は「できる状態」を落とすから(`not (state == a and 時刻の条件)` は、a でも時刻の条件が外れればできる)。
 * 今の文法は `not` を原子にしか付けられないが、木の形に依らず安全にしておく。
 */
export function approximateStates(expr: GuardExpr, entity: string, field: string, own: boolean, all: readonly string[]): StateApproximation {
  switch (expr.kind) {
    case 'compare': {
      if (!isStatePath(expr.path, entity, field, own) || expr.rhs.kind !== 'symbol') return EVERY;
      if (expr.op === '==') return { states: new Set([expr.rhs.value]), mentions: true, exact: true };
      if (expr.op === '!=') return { states: new Set(all.filter((state) => state !== (expr.rhs.kind === 'symbol' ? expr.rhs.value : ''))), mentions: true, exact: true };
      return EVERY;
    }
    case 'in': {
      if (!isStatePath(expr.path, entity, field, own)) return EVERY;
      return { states: new Set(expr.values.flatMap((value) => (value.kind === 'symbol' ? [value.value] : []))), mentions: true, exact: true };
    }
    case 'and': {
      const left = approximateStates(expr.left, entity, field, own, all);
      const right = approximateStates(expr.right, entity, field, own, all);
      return { states: intersect(left.states, right.states), mentions: left.mentions || right.mentions, exact: left.exact && right.exact };
    }
    case 'or': {
      const left = approximateStates(expr.left, entity, field, own, all);
      const right = approximateStates(expr.right, entity, field, own, all);
      return { states: union(left.states, right.states), mentions: left.mentions || right.mentions, exact: left.exact && right.exact };
    }
    case 'not': {
      const inner = approximateStates(expr.operand, entity, field, own, all);
      if (!inner.exact || inner.states === null) return { states: null, mentions: inner.mentions, exact: false };
      const kept = inner.states;
      return { states: new Set(all.filter((state) => !kept.has(state))), mentions: inner.mentions, exact: true };
    }
    default:
      return EVERY;
  }
}

/**
 * 条件の式が通す状態。式が親の状態にふれなければ null(その規則は状態ごとの表に載せない)、
 * ふれていて状態で絞っていなければ全状態。式が無い・読めないときも null。
 */
export function statesOf(
  source: string | undefined,
  entity: string,
  field: string,
  own: boolean,
  all: readonly string[],
): ReadonlySet<string> | null {
  if (source === undefined || source.trim().length === 0) return null;
  const parsed = parseGuard(source);
  if (!parsed.ok) return null;
  const result = approximateStates(parsed.expr, entity, field, own, all);
  if (!result.mentions) return null;
  return result.states ?? new Set(all);
}

/** 親の集約の、この状態機械の状態を持つ欄の名前。 */
export function stateField(owner: AggregateSpecs, machine: StateMachineSpec): string | undefined {
  return owner.entity?.fields.find((field) => field.type.kind === 'state' && field.type.machine === machine.machine)?.name;
}

/**
 * 各状態で、`roles` のロールができること。状態ごとに重複なく、宣言の並び(読む → 集約の並びの遷移・作る・書く・消す)で返す。
 *
 * @param model ドメイン仕様全体
 * @param owner 状態機械を持つ集約(結果表を出す章の集約)
 * @param machine 結果表の状態機械
 * @param roles 列にまとめるロール(ロール ID)
 */
export function abilitiesByState(
  model: SpecModel,
  owner: AggregateSpecs,
  machine: StateMachineSpec,
  roles: ReadonlySet<string>,
): ReadonlyMap<string, readonly StateAbility[]> {
  const entity = owner.entity?.entity;
  const field = stateField(owner, machine);
  const found = new Map<string, StateAbility[]>(machine.states.map((state) => [state, []]));
  if (entity === undefined || field === undefined) return found;
  const add = (states: ReadonlySet<string> | null, ability: StateAbility): void => {
    for (const state of states ?? machine.states) {
      const list = found.get(state);
      if (list === undefined) continue;
      if (!list.some((known) => known.kind === ability.kind && known.aggregate === ability.aggregate && known.label === ability.label)) list.push(ability);
    }
  };
  for (const rule of owner.access?.reads ?? []) {
    if (!roles.has(rule.by) || rule.scope.kind === 'none') continue;
    const states = statesOf(rule.when, entity, field, true, machine.states);
    add(states, { kind: 'read', aggregate: owner.name, label: '' });
  }
  for (const specs of model.aggregates.values()) {
    const own = specs === owner;
    for (const other of specs.stateMachines) {
      for (const event of other.events) {
        if (!event.by.some((by) => roles.has(by))) continue;
        const ability: StateAbility = { kind: 'event', aggregate: specs.name, label: event.label ?? event.id };
        if (other === machine) add(new Set(event.from), ability);
        else {
          const states = statesOf(event.guard, entity, field, false, machine.states);
          if (states !== null) add(states, ability);
        }
      }
    }
    const rules = [
      ...(specs.access?.creates ?? []).map((rule) => ({ kind: 'create' as const, rule })),
      ...(specs.access?.writes ?? []).map((rule) => ({ kind: 'write' as const, rule })),
      ...(specs.access?.deletes ?? []).map((rule) => ({ kind: 'delete' as const, rule })),
    ];
    for (const { kind, rule } of rules) {
      if (!roles.has(rule.by)) continue;
      const states = statesOf(rule.when, entity, field, own, machine.states);
      if (states !== null) add(states, { kind, aggregate: specs.name, label: '' });
    }
  }
  return found;
}
