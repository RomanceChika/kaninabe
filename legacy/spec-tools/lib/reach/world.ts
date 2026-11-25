/**
 * **有界到達性の「世界」を決める写像**(V21 の材料。純粋)。
 *
 * 判定するのは Z3 であり、ここが持つのは「仕様のどこを、どう写すか」という規則だけである
 * (2026-09-11 のユーザー原則「推論・探索は既製品・写像だけ自作」)。
 *
 * ## 何を世界に入れるか(設計の凍結メモ §2)
 *
 * | 要素 | 写し方 |
 * |---|---|
 * | 関与する機械 | 対象の集約の全機械 + **その集約のガードが参照する集約**の全機械(推移的) |
 * | 状態変数 | 機械ごとに 1 本。初期状態は `initial` に固定される |
 * | ガードが参照する欄 | `access_spec.writes[].fields` にある欄 = **手ごとに自由**(誰かがいつでも書ける)。それ以外 = **実行中不変**(作成時に決まる) |
 * | `actor.*` を含む原子 | **手ごとに自由な真偽値**へ逃がす(誰が実行するかを見ない) |
 * | K | 関与する機械の状態数の積 − 1(直積グラフの直径の上界)。上限 128 で打ち切り |
 *
 * **極性は必ず「実行列を多めに認める」側へ倒す。** 不変条件も `by`(誰が実行できるか)も見ず、
 * 読めないガードは「常に真」として扱う。だからここが「K 手以内に無い」と言うときは
 * **本当に無い**(仕様の問題)であり、「ある」は保証ではない。
 */

import type { DomainEnv, GuardExpr } from '../guard/ast.js';
import { parseGuard } from '../guard/parser.js';
import { collectPaths } from '../guard/services.js';
import { pathKey } from '../guard/atoms.js';
import { loosenActorAtoms } from './actor.js';
import type { EventDef, SpecModel } from '../model/types.js';
import { buildAggregateEnv } from '../semantics/domain-env.js';

/** 展開する手数の上限。これを超える世界は打ち切って、その旨を Finding に出す。 */
export const MAX_BOUND = 128;

/** 予約語 `now`(手ごとに動き、単調非減少)。 */
export const NOW = 'now';

/** 実行者を指す予約語のルート。 */
const ACTOR_ROOT = 'actor';

/** 世界に入れた遷移 1 本。 */
export interface ReachEvent {
  readonly id: string;
  readonly from: readonly string[];
  readonly to: string;
  /** ガード(書かれていない・読めないものは undefined = 常に真として扱う)。 */
  readonly guard: GuardExpr | undefined;
  /** ガードを写すときのドメイン宣言(その集約から見た env)。 */
  readonly env: DomainEnv;
  /** 書かれたパス → 世界の中での正規名(`state` → `entry.state`)。 */
  readonly paths: ReadonlyMap<string, string>;
}

/** 世界に入れた状態機械 1 つ。 */
export interface ReachMachine {
  readonly aggregate: string;
  readonly machine: string;
  /** `{集約}.{機械}`(世界の鍵と Finding の反例に使う)。 */
  readonly id: string;
  /** 状態を保持する変数の正規名(`workshop.state`)。 */
  readonly statePath: string;
  readonly states: readonly string[];
  readonly initial: string;
  readonly events: readonly ReachEvent[];
}

/** 1 つの world(関与する機械・手数・手ごとに動く名前)。 */
export interface ReachWorld {
  /** 世界の鍵(関与する機械の id を並べたもの)。 */
  readonly key: string;
  /** 関与する機械(id の昇順)。 */
  readonly machines: readonly ReachMachine[];
  /** 展開する手数 K。 */
  readonly bound: number;
  /** K が上限で打ち切られたか。 */
  readonly truncated: boolean;
  /** 手ごとに別の値を取る正規名(状態変数・`writes` の欄・`now`・実行者の属性・未知のパス)。 */
  readonly perStep: ReadonlySet<string>;
}

/** 組み立ての途中で使い回す表(ドメイン環境の組み立ては重いので集約ごとに 1 回)。 */
interface Workbench {
  readonly model: SpecModel;
  /** 集約名・エンティティ名 → 集約名。 */
  readonly index: ReadonlyMap<string, string>;
  /** 集約名 → その集約の機械(組み立て済み)。 */
  readonly cache: Map<string, readonly ReachMachine[]>;
}

/** 集約名・エンティティ名 → 集約名(ガードのパスのルートを解く表)。 */
function aggregateIndex(model: SpecModel): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const [aggregate, specs] of model.aggregates) {
    index.set(aggregate, aggregate);
    if (specs.entity !== undefined) index.set(specs.entity.entity, aggregate);
  }
  return index;
}

/**
 * 書かれたパスを世界の中での正規名にする。裸の欄(`state`)は書き手の集約の欄であり、
 * `workshop.state` と同じものを指す —— 2 つの変数に割れると嘘の実行列が作れてしまう。
 *
 * @param index 集約名・エンティティ名 → 集約名
 * @param owner そのガードを書いた集約
 * @param path 書かれたパス(ドット表記)
 * @returns 正規名
 */
export function canonicalPath(index: ReadonlyMap<string, string>, owner: string, path: string): string {
  if (path === NOW) return NOW;
  const segments = path.split('.');
  const root = segments[0] ?? path;
  if (segments.length === 1) return `${owner}.${path}`;
  const aggregate = index.get(root);
  return aggregate === undefined ? path : [aggregate, ...segments.slice(1)].join('.');
}

/** その集約の `writes` が並べる欄(誰かがいつでも書ける = 手ごとに自由)。 */
function writableFields(model: SpecModel, aggregate: string): ReadonlySet<string> {
  const fields = new Set<string>();
  for (const rule of model.aggregates.get(aggregate)?.access?.writes ?? []) {
    for (const field of rule.fields) fields.add(field);
  }
  return fields;
}

/**
 * 正規名が**手ごとに自由**か(実行中不変でないか)を決める。
 * 状態変数は遷移関係が動かすので別扱い(呼ぶ側が先に入れる)。ここが見るのは欄だけである。
 */
function isPerStep(model: SpecModel, path: string): boolean {
  if (path === NOW) return true;
  const segments = path.split('.');
  const root = segments[0];
  if (root === ACTOR_ROOT) return true;
  const field = segments.length === 2 ? segments[1] : undefined;
  if (root === undefined || field === undefined || !model.aggregates.has(root)) return true;
  return writableFields(model, root).has(field);
}

/** そのイベントのガードを読み、世界に入れる形にする。 */
function toEvent(bench: Workbench, aggregate: string, env: DomainEnv, event: EventDef): ReachEvent {
  const parsed = event.guard === undefined ? null : parseGuard(event.guard);
  const written = parsed !== null && parsed.ok ? parsed.expr : undefined;
  const paths = new Map<string, string>();
  if (written !== undefined) {
    // 参照の表は**書かれたまま**の式から作る(関与する集約の閉包がここから決まる)。
    for (const ref of collectPaths(written)) {
      const path = pathKey(ref);
      paths.set(path, canonicalPath(bench.index, aggregate, path));
    }
  }
  const guard = written === undefined ? undefined : loosenActorAtoms(written);
  return { id: event.id, from: event.from, to: event.to, guard, env, paths };
}

/** 集約 1 つ分の機械を世界の形にする(同じ集約は 1 回だけ組み立てる)。 */
function machinesOf(bench: Workbench, aggregate: string): readonly ReachMachine[] {
  const known = bench.cache.get(aggregate);
  if (known !== undefined) return known;
  const specs = bench.model.aggregates.get(aggregate);
  if (specs === undefined) {
    bench.cache.set(aggregate, []);
    return [];
  }
  const env = buildAggregateEnv(bench.model, aggregate);
  const built = specs.stateMachines.map((machine) => {
    const field = specs.entity?.fields.find(
      (candidate) => candidate.type.kind === 'state' && candidate.type.machine === machine.machine,
    );
    return {
      aggregate,
      machine: machine.machine,
      id: `${aggregate}.${machine.machine}`,
      statePath: `${aggregate}.${field?.name ?? `#${machine.machine}`}`,
      states: machine.states,
      initial: machine.initial,
      events: machine.events.map((event) => toEvent(bench, aggregate, env, event)),
    };
  });
  bench.cache.set(aggregate, built);
  return built;
}

/** モデル中の全機械を「状態変数の正規名 → 機械」に畳む(参照されたかを引くための表)。 */
function machinesByStatePath(bench: Workbench): ReadonlyMap<string, ReachMachine> {
  const index = new Map<string, ReachMachine>();
  for (const aggregate of bench.model.aggregates.keys()) {
    for (const machine of machinesOf(bench, aggregate)) index.set(machine.statePath, machine);
  }
  return index;
}

/**
 * 関与する機械の閉包 —— **参照される機械だけ**を推移的に足す。
 *
 * 足す条件は「関与する機械のガードが**その機械の状態変数そのもの**を読んでいる」ことである。
 * 同じ集約にあるというだけの機械は入れない —— その状態変数はどのガードにも現れないので、
 * 世界に入れても**答えは 1 つも変わらず**、K(状態数の積 − 1)だけが膨らむ。
 * 題材の製品では entry の世界がこれで 104 手から 34 手に縮む(2026-09-20 の実測)。
 *
 * 「状態変数そのもの」であることを正規名で見るのは、`state(m)` 型の欄が**別の集約に**
 * あることがあるからである。その欄は m の状態変数ではない(写しである)ので、m を
 * 足しても繋がらない —— 足す理由にならない。
 */
function closure(bench: Workbench, seed: ReachMachine): readonly ReachMachine[] {
  const index = machinesByStatePath(bench);
  const involved = [seed];
  const seen = new Set<string>([seed.id]);
  for (let cursor = 0; cursor < involved.length; cursor += 1) {
    const current = involved[cursor];
    if (current === undefined) continue;
    for (const event of current.events) {
      for (const canonical of event.paths.values()) {
        const referenced = index.get(canonical);
        if (referenced === undefined || seen.has(referenced.id)) continue;
        seen.add(referenced.id);
        involved.push(referenced);
      }
    }
  }
  return involved;
}

/** 状態数の積 − 1(上限で打ち切る)。stutter を許すので「K 手以内」は「ちょうど K 手」で問える。 */
function boundOf(machines: readonly ReachMachine[]): { bound: number; truncated: boolean } {
  let product = 1;
  for (const machine of machines) {
    product *= Math.max(machine.states.length, 1);
    if (product - 1 > MAX_BOUND) return { bound: MAX_BOUND, truncated: true };
  }
  return { bound: Math.max(product - 1, 0), truncated: false };
}

/**
 * 状態機械 1 つから見た世界を組み立てる。
 *
 * @param model 構築済みのドメイン仕様モデル
 * @param aggregate 問いの主語になる集約
 * @param machineName 問いの主語になる状態機械
 * @returns 関与する機械・手数・手ごとに動く名前(機械が無ければ空の世界)
 */
export function buildWorld(model: SpecModel, aggregate: string, machineName: string): ReachWorld {
  const bench: Workbench = { model, index: aggregateIndex(model), cache: new Map() };
  const seed = machinesOf(bench, aggregate).find((entry) => entry.machine === machineName);
  if (seed === undefined) {
    return { key: '', machines: [], bound: 0, truncated: false, perStep: new Set([NOW]) };
  }
  const machines = [...closure(bench, seed)].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );

  const perStep = new Set<string>([NOW]);
  for (const machine of machines) perStep.add(machine.statePath);
  for (const machine of machines) {
    for (const event of machine.events) {
      for (const canonical of event.paths.values()) {
        if (perStep.has(canonical)) continue;
        if (isPerStep(model, canonical)) perStep.add(canonical);
      }
    }
  }

  const { bound, truncated } = boundOf(machines);
  return { key: machines.map((machine) => machine.id).join('+'), machines, bound, truncated, perStep };
}
