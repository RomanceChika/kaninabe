/**
 * V10(不変条件の執行)が使う共有部品 — モデルの索引と Finding のファクトリ。
 *
 * V10 の検査は「執行の宣言」(v10-invariant-enforcement.ts)と「formal ブロックの接地」
 * (v10-invariant-formal.ts)の 2 つに分かれており、どちらもこの索引とファクトリを使う。
 * 片方をもう片方から import すると循環するため、共有部分だけをここに置く。
 */

import type { SpecModel, InvariantDef } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';

/** ドット 1 つで繋いだ参照。`machine.event`(enforced_by)と `entity.field`(cardinality.max)に使う。 */
export const DOTTED_REF_PATTERN = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;

/** 執行点として参照できる遷移イベント 1 つ。ガードの中身まで持つ(C-9 の関与判定に使う)。 */
export interface EventRef {
  /** そのイベントのガード式(生文字列)。ガードが無い遷移では undefined。 */
  readonly guard?: string;
  /** イベントが属する集約名。ガード式のパス解決の起点になる。 */
  readonly aggregate: string;
}

/** 参照の実在確認に使う、モデルの索引。 */
export interface SpecIndex {
  /** 機械名 → (イベント ID → そのイベント) */
  readonly machineEvents: ReadonlyMap<string, ReadonlyMap<string, EventRef>>;
  /** エンティティ名 → フィールド名の集合 */
  readonly entityFields: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * モデルから機械・エンティティの索引を作る。
 *
 * @param model ドメイン仕様全体
 * @returns 機械 → イベント、エンティティ(集約名でも引ける)→ フィールド名の索引
 */
export function buildIndex(model: SpecModel): SpecIndex {
  const machineEvents = new Map<string, ReadonlyMap<string, EventRef>>();
  const entityFields = new Map<string, ReadonlySet<string>>();
  for (const [aggregate, specs] of model.aggregates) {
    for (const machine of specs.stateMachines) {
      const events = new Map<string, EventRef>();
      for (const event of machine.events) {
        events.set(event.id, event.guard === undefined ? { aggregate } : { guard: event.guard, aggregate });
      }
      machineEvents.set(machine.machine, events);
    }
    const entity = specs.entity;
    if (entity === undefined) continue;
    const names = new Set(entity.fields.map((field) => field.name));
    entityFields.set(entity.entity, names);
    entityFields.set(aggregate, names);
  }
  return { machineEvents, entityFields };
}

/**
 * V10 の Finding を組み立てる小さなファクトリ(3 点セットの取りこぼしを防ぐ)。
 *
 * @param invariant 対象の不変条件(メッセージに ID を前置し、位置を借りる)
 * @param message 何が起きているか
 * @param suggestion どう直すか
 * @param counterexample 反例
 * @param severity 既定は error。人間の判断に委ねる指摘は warning
 * @returns 組み立てた Finding
 */
export function finding(
  invariant: InvariantDef,
  message: string,
  suggestion: string,
  counterexample: Readonly<Record<string, string>>,
  severity: Finding['severity'] = 'error',
): Finding {
  return {
    verifier: 'V10',
    severity,
    message: `${invariant.id}: ${message}`,
    location: invariant.location,
    suggestion,
    counterexample,
  };
}

