/**
 * **行が作った後に消えうるか**の定義(1 か所。点検 23 回目 A23-2 で T28 から出した)。
 *
 * 消える経路は 3 つで、どれも宣言から読む: 自分の集約の access の `deletes`、操作で消せる集約の削除の外部キーの連鎖
 * (`on_delete: cascade`。閉包は T21 の章と同じ `aggregate-structure.ts` の `cascadeReach`)、どれかの RPC の副作用の削除
 * (`also_writes` / `event_writes` の `delete`。読みは `model/data/rpc-writes.ts` の `alsoWritesAt`)。
 *
 * 読み手は 4 つ: T28(写し元の行が消えると写しの持ち主が分からなくなる)、T24(保存点の錨の行が消えると、要約から本人へ届く道も消える)、
 * 期待表の生成(`code-rpc-expectations.ts`。消去の本文が錨の無い要約も消すことを erase-parity が見る)、
 * 表の単位の全数(`removableTables`。データ保持の規約の「消える行の全数」の表と両方向に突き合わせる。点検 24 回目 A の観察 O24-2)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataTableSpec } from '../model/data/types.js';
import type { SpecModel } from '../model/types.js';
import { alsoWritesAt, selfWriteKindsOf } from '../model/data/rpc-writes.js';
import { cascadeReach, entityOwners } from './aggregate-structure.js';

/**
 * その集約の行が、作った後に操作で消えうるか。
 *
 * @param domain ドメイン仕様
 * @param tables 全 data_table
 * @param entity 集約のエンティティ名
 * @returns 消えうれば true(集約が見つからなければ false)
 */
export function rowsRemovable(domain: SpecModel, tables: readonly DataTableSpec[], entity: string): boolean {
  for (const specs of domain.aggregates.values()) {
    if (specs.entity?.entity !== entity) continue;
    const table = tables.find((candidate) => candidate.entity === entity);
    return (specs.access?.deletes.length ?? 0) > 0 || removedByCascade(domain, tables, entity) || (table !== undefined && removedBySideEffect(tables, table.table));
  }
  return false;
}

/**
 * 行が、操作で消せる集約の削除の外部キーの連鎖(`on_delete: cascade`)で消えるか(点検 21 回目 C21-6。以前は自分の access の `deletes`
 * だけを数え、親の削除の cascade でだけ消える写し元の表では削除の瞬間を求めなかった)。
 */
function removedByCascade(domain: SpecModel, tables: readonly DataTableSpec[], entity: string): boolean {
  const own = entityOwners(domain).get(entity);
  if (own === undefined) return false;
  return [...domain.aggregates].some(([name, specs]) => name !== own && (specs.access?.deletes.length ?? 0) > 0 && cascadeReach(tables, domain, name).includes(own));
}

/**
 * 行が、どれかの RPC の副作用の削除(`also_writes` / `event_writes` の `delete`)か、自表の RPC の自表の削除(`self_writes` の `delete`。
 * 全入れ替えのキャッシュ)で消えるか(点検 22 回目 A の O22-2。以前は access の `deletes` とその cascade だけを数え、遷移の RPC の後始末を数えなかった。
 * 自表の削除は 2026-11-08 に足した —— 全消しして入れ直す内部テーブルを数え落としていた)。イベントごとの宣言も全部見る。
 */
function removedBySideEffect(tables: readonly DataTableSpec[], table: string): boolean {
  return tables.some((home) =>
    home.functions.some(
      (fn) =>
        (home.table === table && (selfWriteKindsOf(fn) ?? []).includes('delete')) ||
        [alsoWritesAt(fn, null), ...Object.keys(fn.eventWrites ?? {}).map((event) => alsoWritesAt(fn, event))].some((writes) => (writes[table] ?? []).includes('delete')),
    ),
  );
}

/**
 * 行が作った後に消えうる**表の全部**(行が消える経路の全数の表の正。点検 24 回目 A の観察 O24-2)。
 *
 * 集約の表は `rowsRemovable`(上の 3 つの経路)。内部テーブル(entity_spec が無い)は集約の削除を持たないので、次の 3 つで消える:
 * どれかの RPC の副作用の削除(`also_writes` / `event_writes` の `delete`)・保持の時間(`retention_hours`。仕組みの表の掃除)・
 * 消えうる表を指す外部キーの連鎖(`on_delete: cascade`。閉包)。加えて、**宣言の外の表**(認証基盤の `auth.users` など data_table の無い表)を
 * cascade で指す表と、そこからの連鎖の閉包(集約の表も含む)は消えうる —— 外の持ち主(認証基盤の運用者)は操作の外で行を消しうる。
 * メンバーの行が認証ユーザーの削除の連鎖で消える経路を数え落としていた)。操作でないので `rowsRemovable`(操作で消えうるか。T28・T24・期待表)には数えない。
 *
 * @param domain ドメイン仕様
 * @param tables 全 data_table
 * @returns 消えうる表の名前(data_table の並び)
 */
export function removableTables(domain: SpecModel, tables: readonly DataTableSpec[]): readonly string[] {
  const removable = new Set(
    tables
      .filter((table) => (table.entity === undefined ? removedBySideEffect(tables, table.table) || table.retentionHours !== undefined : rowsRemovable(domain, tables, table.entity)))
      .map((table) => table.table),
  );
  // 宣言の外の表(認証基盤の `auth.users` など。data_table を持たない)は、持ち主が操作の外で行を消しうる。そこを cascade で指す表は消えうる。
  const declared = new Set(tables.map((table) => table.table));
  const external = (references: string): boolean => !declared.has(references);
  for (const table of tables) if (table.foreignKeys.some((key) => key.onDelete === 'cascade' && external(key.references))) removable.add(table.table);
  for (let grew = true; grew; ) {
    grew = false;
    for (const table of tables) {
      if (removable.has(table.table) || !table.foreignKeys.some((key) => key.onDelete === 'cascade' && removable.has(key.references))) continue;
      removable.add(table.table);
      grew = true;
    }
  }
  return tables.map((table) => table.table).filter((name) => removable.has(name));
}
