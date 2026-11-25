/**
 * 画面が宣言した操作を「状態ごとに並びうるボタン」として数えるための写像。
 *
 * screen-spec-writing.md §先読みの線引きが定めるとおり、**画面がボタンにしてよいのは
 * 宣言した操作と状態機械の遷移の交差だけ**である。その交差はこれまで生成物(遷移表)と
 * 画面仕様を人間が突き合わせて読むものだったが、交差そのものは機械的に決まる。
 * ここはその計算を 1 箇所に置き、U4 が「状態ごとの同時操作数」を数えられるようにする。
 *
 * 数え方は**上界**である(判定できないものは「並びうる」と数える)。U 群は経験則の検査であり、
 * 数え落として警告が出ないほうが、多めに数えて人間が確認するより悪い。
 */

import type { SpecModel } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type { ScreenSpec } from '../model/screen/types.js';
import { canonicalActionId } from '../semantics/action-ground.js';
import { declaredActionIds } from '../model/screen/declared-actions.js';
import {
  findCreate,
  findDelete,
  findEvent,
  findUpdate,
  isCreateId,
  isDeleteId,
  isUpdateId,
} from '../semantics/domain-index.js';
import type { StateScope } from '../semantics/entity-state-axes.js';
import { axisReferencedBy, createStateScope, entityStateView } from '../semantics/entity-state-axes.js';

/**
 * 画面が宣言した操作 1 つを、状態依存の観点で見たもの。
 *
 * 3 種類ある。**状態機械の遷移**(`from` に居る状態でだけ並ぶ)、**予約 ID**
 * (access_spec の `when` が許す状態でだけ並ぶ)、**接地しない ID**(S2 が別途エラーにするので、
 * ここでは常に並ぶものとして数える)。
 */
export interface ActionSlot {
  /** 正規化済みの操作 ID。 */
  readonly id: string;
  /** 状態機械の遷移ならその機械名。予約 ID・未接地なら null。 */
  readonly machine: string | null;
  /** 状態機械の遷移ならその `from`。 */
  readonly from: readonly string[];
  /** 予約 ID ならその接地先エンティティ。 */
  readonly entity: string | null;
  /** 予約 ID の規則ごとの `when`(1 つでも成立すればその状態で並ぶ)。 */
  readonly whens: readonly (string | undefined)[];
}

/**
 * 画面の宣言(本体 + 重ね表示)を ActionSlot へ写す。
 *
 * @param domain ドメイン仕様全体
 * @param screen 対象の画面
 * @returns 宣言順・重複なしの操作
 */
export function classifyActions(domain: SpecModel, screen: ScreenSpec): readonly ActionSlot[] {
  return classifyIds(domain, declaredActionIds(screen));
}

/**
 * 書かれた操作 ID の並びを ActionSlot へ写す(画面の宣言全体でも、部品が載せた操作だけでも使う)。
 *
 * @param domain ドメイン仕様全体
 * @param ids 書かれたままの操作 ID(重複は呼び出し側が畳む)
 * @returns 入力と同じ順の ActionSlot
 */
export function classifyIds(domain: SpecModel, ids: readonly string[]): readonly ActionSlot[] {
  return ids.map((written) => {
    const id = canonicalActionId(domain, written) ?? written;
    const event = findEvent(domain, id);
    if (event !== null) {
      return { id, machine: event.machine.machine, from: event.event.from, entity: null, whens: [] };
    }
    const access = accessRules(domain, id);
    if (access !== null) {
      return { id, machine: null, from: [], entity: access.entity, whens: access.whens };
    }
    return { id, machine: null, from: [], entity: null, whens: [] };
  });
}

/** 予約 ID(`create` / `delete` / `update`)の接地先と条件。 */
function accessRules(
  domain: SpecModel,
  id: string,
): { readonly entity: string; readonly whens: readonly (string | undefined)[] } | null {
  const entry = isCreateId(id)
    ? findCreate(domain, id)
    : isDeleteId(id)
      ? findDelete(domain, id)
      : isUpdateId(id)
        ? findUpdate(domain, id)
        : null;
  if (entry === null) return null;
  return { entity: entry.entity, whens: entry.rules.map((rule) => rule.when) };
}

/** 画面が触れる状態機械の名前(宣言順・重複なし)。 */
export function machineNamesOf(slots: readonly ActionSlot[]): readonly string[] {
  return [...new Set(slots.flatMap((slot) => (slot.machine === null ? [] : [slot.machine])))];
}

/** 状態ごとの可視判定を行う器(集約ごとの条件評価器を使い回すためのキャッシュを持つ)。 */
export interface VisibilityScope {
  /**
   * その操作が、指定した機械の指定した状態で並びうるか。
   *
   * 対象の機械に属さない操作(別集約の遷移・状態を持たないエンティティの予約 ID)は
   * **常に並びうる**と数える。1 画面が 2 つの状態機械に触れる場合、片方の状態を固定しても
   * もう片方は自由に動けるためで、これが上界の評価である所以でもある。
   */
  visibleIn(slot: ActionSlot, machine: string, state: string): boolean;
}

/**
 * 可視判定の器を作る。
 *
 * @param domain ドメイン仕様全体
 * @param guards ガード式の共有サービス
 * @returns 可視判定の器
 */
export function createVisibilityScope(domain: SpecModel, guards: GuardServices): VisibilityScope {
  /** 予約 ID 1 つぶんの「どの軸で数えるか」と評価器(集約ごとに 1 度だけ組み立てる)。 */
  interface SlotAxis {
    readonly machine: string;
    readonly scope: StateScope;
  }
  const axes = new Map<string, SlotAxis | null>();
  /**
   * その予約 ID の条件が参照している状態の軸を引く。
   *
   * **直交する軸を持つ集約では、参照していない軸で数えてはならない**(催しは進行と掲載の
   * 2 本を持つ。`when: state in [draft, accepting]` を掲載の状態に対して評価すると、
   * 変数が食い違って「常に成立」になる)。
   */
  const axisOf = (slot: ActionSlot): SlotAxis | null => {
    const entity = slot.entity;
    if (entity === null) return null;
    const key = `${entity}\u0000${slot.id}`;
    const cached = axes.get(key);
    if (cached !== undefined) return cached;
    const view = entityStateView(domain, entity);
    const axis = view === null ? null : axisReferencedBy(view, slot.whens, guards);
    const resolved =
      view === null || axis === null
        ? null
        : {
            machine: axis.machine.machine,
            scope: createStateScope(domain, guards, view.aggregate, axis.stateField),
          };
    axes.set(key, resolved);
    return resolved;
  };

  return {
    visibleIn(slot: ActionSlot, machine: string, state: string): boolean {
      if (slot.machine !== null) return slot.machine === machine ? slot.from.includes(state) : true;
      if (slot.entity === null || slot.whens.length === 0) return true;
      const axis = axisOf(slot);
      if (axis === null || axis.machine !== machine) return true;
      return slot.whens.some((when) => axis.scope.appliesIn(when, state));
    },
  };
}
