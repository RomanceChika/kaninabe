/**
 * 条件を課すトリガのうち**本文が生成物のもの**が掴む親の行(定型 RPC の先掴み `sql/rpc-closure-locks.ts` が、宣言の `locks` と同じ口で読む。fix25s)と、
 * **同じ表の BEFORE トリガの格上げ**(点検 D25s-2)の判定の 1 本。
 *
 * 掴む相手は形の判定(`ref-check-shape.ts` / `cross-check-shape.ts`)から決まるので、宣言の `locks` に書き写させない。
 *
 * ## 同じ表の BEFORE トリガの格上げ(D25s-2)
 *
 * 同じ表の同じ発火の BEFORE の行トリガは**名前の順**に走る。先のトリガが親の行を共有(`for share`)で掴み、後のトリガが同じ親を
 * 排他(`for update`)で掴むと、同じ親に 2 本の挿入が来たとき、両方が共有を持ったまま互いの排他を待つ(40P01。題材の製品の演目の表:
 * 条件の `check_program_item_entry` の後に末尾の番号の `number_program_item_order`。枠の表: `check_entry_audience_policy` の後に
 * `check_entry_capacity`)。だから本文が生成物の条件のトリガは、**同じ表で発火が重なる別の BEFORE トリガが同じ親を求める最強の強さ**で
 * 最初から掴む(`impliedLocksOf` がその強さを返し、本文の生成 `sql/ddl-ref-check-body.ts` と先掴みが同じ値を読む)。
 * 直せない形(手書きの本文どうし・宣言の `locks` どうしの格上げ)は `beforeUpgradesOf` が名指す(T27)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../types.js';
import { parseFires } from '../trigger-fires.js';
import { crossShapeOf } from './cross-check-shape.js';
import { refCheckOf } from './ref-check-shape.js';
import type { DataTableSpec, DataTriggerDecl } from './types.js';
import type { LockStrength } from './types-locks.js';

/** 強さの順位(共有 < 排他)。 */
const RANK: Readonly<Record<LockStrength, number>> = { share: 0, update: 1 };

/** 手書きの本文か。 */
function handwritten(trigger: DataTriggerDecl, table: DataTableSpec): boolean {
  return table.functions.some((fn) => fn.name === trigger.functionName && fn.handwritten !== undefined);
}

/** BEFORE の行トリガ(遅延でない)の発火のイベント(BEFORE でなければ null)。 */
function beforeEvents(trigger: DataTriggerDecl): ReadonlySet<string> | null {
  if (trigger.deferred) return null;
  const fires = parseFires(trigger.fires ?? '');
  return fires.timing === 'before' ? new Set(fires.events) : null;
}

/** 発火が重なる同じ表の別の BEFORE トリガ。 */
function overlapping(trigger: DataTriggerDecl, table: DataTableSpec): readonly DataTriggerDecl[] {
  const own = beforeEvents(trigger);
  if (own === null) return [];
  return table.triggers.filter((other) => other.name !== trigger.name && [...(beforeEvents(other) ?? [])].some((event) => own.has(event)));
}

/**
 * 条件を課すトリガの**生成する本文が掴む親の行**(表 → 強さ。定型 RPC の先掴み `sql/rpc-closure-locks.ts` が、宣言の `locks` と同じ口で読む。fix25s)。
 *
 * 本文が生成物のトリガは、掴む相手が宣言から決まる —— 参照の欄が指す行を読む条件(この形)は読む行の全部を、2 つの集約の一致の行の側
 * (`cross-check-shape.ts`)は相手の行を掴む。強さは共有で、参照の欄が指す行を読む条件だけは、同じ表で発火が重なる別の BEFORE トリガが
 * 宣言の `locks` で同じ親を排他で掴むなら排他に上げる(名前の順の格上げを作らない。D25s-2)。それを先掴みに入れないと、RPC が名前の大きい
 * 表(メンバーなど)を掴んだ後でトリガの中から名前の小さい表を掴む逆順になる(lock-order-parity が実測で名指した)。宣言 `locks` に書き写させない
 * (書き写しは本文と食い違いうる)。手書きの本文は読めないので数えない(宣言の `locks` が要る)。
 *
 * @param trigger トリガの宣言
 * @param table そのトリガを宣言した表
 * @param domain ドメイン仕様
 * @param tables 全 data_table
 * @returns 掴む親の表と強さ(無ければ空)
 */
export function impliedLocksOf(trigger: DataTriggerDecl, table: DataTableSpec, domain: SpecModel, tables: readonly DataTableSpec[]): Readonly<Record<string, LockStrength>> {
  if (handwritten(trigger, table)) return {};
  const ref = refCheckOf(trigger, table, domain, tables);
  if (ref.kind === 'ok') {
    const others = overlapping(trigger, table);
    return Object.fromEntries(ref.plan.rows.map((row) => [row.table, others.some((other) => other.locks?.[row.table] === 'update') ? ('update' as const) : ('share' as const)]));
  }
  const cross = trigger.deferred ? crossShapeOf(trigger, table, domain, tables) : null;
  return cross?.kind === 'shape' && cross.shape.side === 'host' ? { [cross.shape.other.table]: 'share' } : {};
}

/** 同じ表の BEFORE トリガの格上げ 1 つ。 */
export interface BeforeUpgrade {
  readonly event: string;
  readonly parent: string;
  /** 先に(名前の順で)弱く掴むトリガ。 */
  readonly earlier: string;
  /** 後で強く掴むトリガ。 */
  readonly later: string;
}

/**
 * その表の BEFORE トリガを名前の順に実行したとき、同じ親を**共有で掴んだ後に排他で掴み直す**組(発火のイベントごと。D25s-2)。
 * 掴む親は宣言の `locks` と、本文が生成物のトリガの `impliedLocksOf`(同じ表は強い方)。
 *
 * @param table 表
 * @param domain ドメイン仕様
 * @param tables 全 data_table
 * @returns 格上げの組(無ければ空)
 */
export function beforeUpgradesOf(table: DataTableSpec, domain: SpecModel, tables: readonly DataTableSpec[]): readonly BeforeUpgrade[] {
  const ordered = table.triggers.filter((trigger) => beforeEvents(trigger) !== null).sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const locksOf = (trigger: DataTriggerDecl): Readonly<Record<string, LockStrength>> => {
    const merged: Record<string, LockStrength> = { ...impliedLocksOf(trigger, table, domain, tables) };
    for (const [parent, mode] of Object.entries(trigger.locks ?? {})) merged[parent] = merged[parent] === 'update' ? 'update' : mode;
    return merged;
  };
  const found: BeforeUpgrade[] = [];
  const events = [...new Set(ordered.flatMap((trigger) => [...(beforeEvents(trigger) ?? [])]))].sort();
  for (const event of events) {
    const held = new Map<string, { readonly strength: LockStrength; readonly by: string }>();
    for (const trigger of ordered.filter((candidate) => beforeEvents(candidate)?.has(event) === true)) {
      for (const [parent, strength] of Object.entries(locksOf(trigger))) {
        const before = held.get(parent);
        if (before !== undefined && RANK[strength] > RANK[before.strength]) found.push({ event, parent, earlier: before.by, later: trigger.name });
        if (before === undefined || RANK[strength] > RANK[before.strength]) held.set(parent, { strength, by: trigger.name });
      }
    }
  }
  return found;
}
