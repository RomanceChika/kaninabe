/**
 * ハンドブックの「軸にする流れ」の判定 — 状態機械ごとに、その状態を条件で読む**ほかの集約の規則**を集め、
 * いちばん多くの集約が従う状態機械を製品の全体像の軸にする。
 *
 * 設計メモ `docs/design/book-as-spec.md` §1-8-5(試作 `proto-v3_7-build/lifecycle_hub.py` の本番版)。試作は条件の文字列を
 * 正規表現で探したが、ここはガードの構文木で読む(`state-abilities.ts` の近似と同じ読み方。状態以外の原子は may として全状態に通す)。
 *
 * - **従う規則** = 持ち主以外の集約の、遷移の `guard`・権限の `creates` / `writes` / `deletes` / `reads` の `when` のうち、
 *   `{持ち主のエンティティ}.{状態の欄}` にふれるもの。開く状態の集合(may)を持つ。全体像の「軸の段 × ほかの集約で開く操作」の図の材料。
 * - **軸** = 従う集約がいちばん多い状態機械。0 なら軸は無い(集約ごとの小さな図を並べる)。同数なら全部(並べる。1 つに寄せない)。
 *   これは直接の状態の参照の多さであって、業務の従属そのものではない(usecase の手順の順・snapshot・ジョブの連鎖は数えない。
 *   外部レビュー の Q3)。
 *
 * 並びは仕様の宣言順。純粋関数だけ。**アプリの語彙は 1 語も持たない。**
 */

import type { SourceLocation } from '../../kernel/source-location.js';
import type { StateMachineSpec } from '../../model/types-state.js';
import type { AggregateSpecs, SpecModel } from '../../model/types.js';
import { stateField, statesOf } from '../state-abilities.js';

/** 従う規則の種類。 */
export type FollowingKind = 'event' | 'create' | 'write' | 'delete' | 'read';

/** ほかの集約の規則 1 つが、軸の候補の状態機械のどの状態で開くか。 */
export interface FollowingRule {
  readonly aggregate: string;
  readonly kind: FollowingKind;
  /** 遷移なら `{状態機械}.{イベント}`、それ以外は空。 */
  readonly event: string;
  /** 遷移の表示名(無ければ id)。それ以外は空。 */
  readonly label: string;
  readonly by: readonly string[];
  /** 開く状態(may。宣言順)。 */
  readonly states: readonly string[];
  readonly source: SourceLocation;
}

/** 状態機械 1 本に従うもの。 */
export interface MachineFollowers {
  readonly aggregate: string;
  readonly machine: string;
  /** 従う集約(宣言順)。 */
  readonly followers: readonly string[];
  readonly rules: readonly FollowingRule[];
}

/** 製品の流れの軸の判定。 */
export interface LifecycleAxes {
  /** 軸の状態機械(0 = 軸なし・2 以上 = 同数で並べる)。 */
  readonly axes: readonly MachineFollowers[];
  /** 全状態機械(集約の宣言順 → 状態機械の宣言順)。 */
  readonly all: readonly MachineFollowers[];
}

/** 状態機械 1 本に従う、ほかの集約の規則を集める。 */
export function machineFollowers(model: SpecModel, owner: AggregateSpecs, machine: StateMachineSpec): MachineFollowers {
  const entity = owner.entity?.entity;
  const field = stateField(owner, machine);
  const rules: FollowingRule[] = [];
  if (entity !== undefined && field !== undefined) {
    const open = (when: string | undefined): readonly string[] | null => {
      const states = statesOf(when, entity, field, false, machine.states);
      return states === null ? null : machine.states.filter((state) => states.has(state));
    };
    for (const specs of model.aggregates.values()) {
      if (specs === owner) continue;
      for (const other of specs.stateMachines) {
        for (const event of other.events) {
          const states = open(event.guard);
          if (states !== null) {
            rules.push({ aggregate: specs.name, kind: 'event', event: `${other.machine}.${event.id}`, label: event.label ?? event.id, by: event.by, states, source: event.location });
          }
        }
      }
      const access = specs.access;
      const plain = [
        ...(access?.creates ?? []).map((rule) => ({ kind: 'create' as const, rule })),
        ...(access?.writes ?? []).map((rule) => ({ kind: 'write' as const, rule })),
        ...(access?.deletes ?? []).map((rule) => ({ kind: 'delete' as const, rule })),
        ...(access?.reads ?? []).map((rule) => ({ kind: 'read' as const, rule })),
      ];
      for (const { kind, rule } of plain) {
        const states = open(rule.when);
        if (states !== null) rules.push({ aggregate: specs.name, kind, event: '', label: '', by: [rule.by], states, source: rule.location });
      }
    }
  }
  const followers = [...model.aggregates.keys()].filter((name) => rules.some((rule) => rule.aggregate === name));
  return { aggregate: owner.name, machine: machine.machine, followers, rules };
}

/** 製品の流れの軸を決める。 */
export function lifecycleAxes(model: SpecModel): LifecycleAxes {
  const all = [...model.aggregates.values()].flatMap((owner) => owner.stateMachines.map((machine) => machineFollowers(model, owner, machine)));
  const top = Math.max(0, ...all.map((entry) => entry.followers.length));
  return { axes: top === 0 ? [] : all.filter((entry) => entry.followers.length === top), all };
}
