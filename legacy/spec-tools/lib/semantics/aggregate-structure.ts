/**
 * 集約どうしの**重さ**と**従属**(所有の向き)の導出(book-human-face.md §7-3)。
 *
 * どちらも仕様の宣言から導く。宣言は増やさない(`parent:` を書く日が来たら `dsl-extension-triage.md` に乗せる)。
 * ブックの章の並び(重い順)と、従属する集約を親の章の節に畳む判断が、この 1 か所を読む。
 *
 * - **重さ** = 入次数 + 公理の数 + 操作の数(式は `weightTotal` の 1 か所)。同点は 入次数 → 公理 → 操作 →
 *   名前の辞書順で決める(`compareWeights`)。順位は数の僅差で入れ替わりうるので、**式と同点の規則を
 *   ここに宣言し**、ほかの場所で並べ替えない
 * - **従属** = 所有の向き。子の表が親の表を `on delete cascade` で参照している(親が消えれば子も消える =
 *   存在が親に依る)うえで、子を作る・消すロールがすべて**生きている親の行を動かすロール**であること。
 *   内部実行のロールは人ではないので比べない(内部実行だけが作る子は、親からの写しである)。
 *   親が 2 つ残るときは、入次数の多いほう → 重いほう → 名前の辞書順で 1 つに決める
 *
 * 純粋関数だけ(意味解析の層)。**アプリの語彙は 1 語も持たない。**
 */

import type { DataTableSpec } from '../model/data/types.js';
import { systemRoleId } from '../model/role-hierarchy.js';
import type { AggregateSpecs, SpecModel } from '../model/types.js';
import type { ActionSpec } from '../model/trace/types.js';

/** 集約の重さの内訳。 */
export interface AggregateWeight {
  readonly name: string;
  /** 入次数(この集約のエンティティを `ref` で指す別の集約の数)。 */
  readonly inDegree: number;
  /** 公理の数(invariant_spec の本数)。 */
  readonly invariants: number;
  /** 操作の数(この集約が持つ状態機械・エンティティに結ばれた action_spec の本数)。 */
  readonly operations: number;
  readonly total: number;
}

/** 重さの式(これ 1 つだけ)。 */
export function weightTotal(parts: Pick<AggregateWeight, 'inDegree' | 'invariants' | 'operations'>): number {
  return parts.inDegree + parts.invariants + parts.operations;
}

/** 重い順の比較。同点は 入次数 → 公理 → 操作 → 名前の辞書順(これで総順序になり、仕様の並びに依らない)。 */
export function compareWeights(a: AggregateWeight, b: AggregateWeight): number {
  return (
    b.total - a.total ||
    b.inDegree - a.inDegree ||
    b.invariants - a.invariants ||
    b.operations - a.operations ||
    a.name.localeCompare(b.name)
  );
}

/** エンティティ名 → 集約名。 */
export function entityOwners(model: SpecModel): Map<string, string> {
  const owners = new Map<string, string>();
  for (const [name, specs] of model.aggregates) if (specs.entity !== undefined) owners.set(specs.entity.entity, name);
  return owners;
}

/** 状態機械名 → 集約名。 */
export function machineOwners(model: SpecModel): Map<string, string> {
  const owners = new Map<string, string>();
  for (const [name, specs] of model.aggregates) for (const machine of specs.stateMachines) owners.set(machine.machine, name);
  return owners;
}

/** action_spec が結ばれている集約名(状態機械の所有者 → エンティティの所有者の順に引く)。 */
export function actionOwner(model: SpecModel, action: ActionSpec): string | undefined {
  return machineOwners(model).get(action.handles.machine) ?? entityOwners(model).get(action.handles.machine);
}

/** 全集約の重さを、重い順(`compareWeights`)に返す。 */
export function aggregateWeights(model: SpecModel, actions: readonly ActionSpec[]): AggregateWeight[] {
  const owners = entityOwners(model);
  const referrers = new Map<string, Set<string>>();
  for (const [name, specs] of model.aggregates) {
    for (const field of specs.entity?.fields ?? []) {
      if (field.type.kind !== 'ref') continue;
      const target = owners.get(field.type.entity);
      if (target === undefined || target === name) continue;
      referrers.set(target, (referrers.get(target) ?? new Set<string>()).add(name));
    }
  }
  const operations = new Map<string, number>();
  for (const action of actions) {
    const owner = actionOwner(model, action);
    if (owner !== undefined) operations.set(owner, (operations.get(owner) ?? 0) + 1);
  }
  return [...model.aggregates]
    .map(([name, specs]) => {
      const parts = {
        inDegree: referrers.get(name)?.size ?? 0,
        invariants: specs.invariants?.invariants.length ?? 0,
        operations: operations.get(name) ?? 0,
      };
      return { name, ...parts, total: weightTotal(parts) };
    })
    .sort(compareWeights);
}

/** 従属する集約 1 つの根拠(親 1 つを決めた理由)。 */
export interface OwnedBy {
  /** 直接の親(集約名)。 */
  readonly parent: string;
  /** 親の候補(`on delete cascade` で参照し、作る・消すロールが親を動かす人に収まる集約)。親が 1 つに決まる前の全部。 */
  readonly candidates: readonly string[];
}

/** 集約どうしの所有の向き。 */
export interface AggregateOwnership {
  /** 従属する集約 → その親。ここに無い集約は章を持つ(根)。 */
  readonly owned: ReadonlyMap<string, OwnedBy>;
  /**
   * 子の表が親の表を `on delete cascade` で参照するのに、従属にならなかった集約 → cascade で参照する親。
   * 作るロールか消すロールが、親を動かす人の外にいる(=自分の動かし手を持つ)。
   */
  readonly cascadeOnly: ReadonlyMap<string, readonly string[]>;
}

/** 親の行を動かすロール(状態機械の `by`・編集の `by`・削除の `by`。作成は含めない。内部実行は除く)。 */
function actingRoles(specs: AggregateSpecs, system: string | undefined): Set<string> {
  const roles = new Set<string>();
  for (const machine of specs.stateMachines) for (const event of machine.events) for (const role of event.by) roles.add(role);
  for (const rule of [...(specs.access?.writes ?? []), ...(specs.access?.deletes ?? [])]) roles.add(rule.by);
  if (system !== undefined) roles.delete(system);
  return roles;
}

/** 子を作る・消すロール(内部実行は除く)。 */
function bringingRoles(specs: AggregateSpecs, system: string | undefined): Set<string> {
  const roles = new Set<string>();
  for (const rule of [...(specs.access?.creates ?? []), ...(specs.access?.deletes ?? [])]) roles.add(rule.by);
  if (system !== undefined) roles.delete(system);
  return roles;
}

/**
 * 所有の向きを導く。表の仕様が無い環境(`tables` が空)では従属は無い。
 *
 * @param model ドメイン仕様全体
 * @param tables テーブル仕様(外部キーの `on delete` の出どころ)
 * @param weights 全集約の重さ(親が 2 つ残るときの決め手)
 */
export function aggregateOwnership(
  model: SpecModel,
  tables: readonly DataTableSpec[],
  weights: readonly AggregateWeight[],
): AggregateOwnership {
  const owners = entityOwners(model);
  const system = systemRoleId(model.roles.roles);
  const tableAggregate = new Map<string, string>();
  for (const table of tables) {
    const owner = table.entity === undefined ? undefined : owners.get(table.entity);
    if (owner !== undefined) tableAggregate.set(table.table, owner);
  }
  const weightOf = new Map(weights.map((weight) => [weight.name, weight] as const));
  const owned = new Map<string, OwnedBy>();
  const cascadeOnly = new Map<string, readonly string[]>();
  for (const table of tables) {
    const child = table.entity === undefined ? undefined : owners.get(table.entity);
    const childSpecs = child === undefined ? undefined : model.aggregates.get(child);
    if (child === undefined || childSpecs === undefined) continue;
    const cascading = [
      ...new Set(
        table.foreignKeys
          .filter((fk) => fk.onDelete === 'cascade')
          .flatMap((fk) => tableAggregate.get(fk.references) ?? [])
          .filter((parent) => parent !== child),
      ),
    ];
    if (cascading.length === 0) continue;
    const bringing = bringingRoles(childSpecs, system);
    const candidates = cascading.filter((parent) => {
      const parentSpecs = model.aggregates.get(parent);
      if (parentSpecs === undefined) return false;
      const acting = actingRoles(parentSpecs, system);
      return [...bringing].every((role) => acting.has(role));
    });
    if (candidates.length === 0) {
      cascadeOnly.set(child, cascading);
      continue;
    }
    const best = [...candidates].sort((a, b) => {
      const left = weightOf.get(a);
      const right = weightOf.get(b);
      return (
        (right?.inDegree ?? 0) - (left?.inDegree ?? 0) ||
        (right?.total ?? 0) - (left?.total ?? 0) ||
        a.localeCompare(b)
      );
    })[0];
    if (best !== undefined) owned.set(child, { parent: best, candidates });
  }
  return { owned, cascadeOnly };
}

/** 章を持つ集約(根)を、辿って返す。親の連鎖は外部キーの向きなので循環しないが、念のため訪問済みで止める。 */
export function rootOf(ownership: AggregateOwnership, name: string): string {
  const seen = new Set<string>([name]);
  let current = name;
  for (;;) {
    const next = ownership.owned.get(current)?.parent;
    if (next === undefined || seen.has(next)) return current;
    seen.add(next);
    current = next;
  }
}

/**
 * ある集約に従属する集約を全部返す(子・孫…の順。同じ親の子は重い順)。
 *
 * @param weights 全集約の重さ(並びの決め手)
 */
export function descendantsOf(
  ownership: AggregateOwnership,
  weights: readonly AggregateWeight[],
  name: string,
): string[] {
  const order = new Map(weights.map((weight, index) => [weight.name, index] as const));
  const childrenOf = (parent: string): string[] =>
    [...ownership.owned]
      .filter(([, by]) => by.parent === parent)
      .map(([child]) => child)
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const found: string[] = [];
  const walk = (parent: string): void => {
    for (const child of childrenOf(parent)) {
      if (found.includes(child)) continue;
      found.push(child);
      walk(child);
    }
  };
  walk(name);
  return found;
}

/**
 * ある集約の下に cascade で連なる集約を全部返す(従属かどうかは問わない)。親の章に「消すと一緒に消えるもの」を
 * 数えて出すための材料。
 */
export function cascadeReach(tables: readonly DataTableSpec[], model: SpecModel, name: string): string[] {
  const owners = entityOwners(model);
  const tableAggregate = new Map<string, string>();
  for (const table of tables) {
    const owner = table.entity === undefined ? undefined : owners.get(table.entity);
    if (owner !== undefined) tableAggregate.set(table.table, owner);
  }
  const childrenByParent = new Map<string, Set<string>>();
  for (const table of tables) {
    const child = table.entity === undefined ? undefined : owners.get(table.entity);
    if (child === undefined) continue;
    for (const fk of table.foreignKeys) {
      const parent = tableAggregate.get(fk.references);
      if (fk.onDelete !== 'cascade' || parent === undefined || parent === child) continue;
      childrenByParent.set(parent, (childrenByParent.get(parent) ?? new Set<string>()).add(child));
    }
  }
  const found: string[] = [];
  const walk = (parent: string): void => {
    for (const child of [...(childrenByParent.get(parent) ?? [])].sort()) {
      if (child === name || found.includes(child)) continue;
      found.push(child);
      walk(child);
    }
  };
  walk(name);
  return found.sort();
}
