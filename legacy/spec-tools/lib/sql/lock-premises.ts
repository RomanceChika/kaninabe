/**
 * 掴む順の判定(突合テスト lock-order-parity)が当てにする**前提**を、既存の宣言から読む(点検 20 回目の後。)。
 *
 * 掴む順の判定(突合テスト lock-order-parity の書き込みの手がかり `guardFacts`)は、書き込みの `where exists` が確かめた等式を、その書き込みが
 * 発火させたトリガの掴みの行の手がかりに足す(`insert_piece`: 先掴みは枠を「id と催し」で絞り、挿入の `where exists` が同じ結合を求める
 * ので、挿入が通ったなら枠はその催しに属し、先掴みの行の集合に入る)。この推論は**その列が作成の後に書き換わらない**ときだけ正しい ——
 * 先掴みと挿入の間に別の txn が枠の催しを書き換えてコミットすると、トリガは先掴みの外の行を掴む。
 *
 * 前提を口約束にしないため、**作成の後に書き換わらない参照の列**(`fixedReferenceColumnsOf`)を宣言から決めて期待表(`lock-expectations.ts` の
 * `fixedReferenceColumns`)に写す。判定はこの集合に入る列の等式だけを手がかりにし(宣言が列を書けるようにすると手がかりが消え、
 * 覆いが言えなくなって `lock-order-parity` が赤になる)、`lock-order-parity` はライブ DB の関数がこの列を作成の後に書かないことも見る
 * (書く関数が現れれば赤)。
 *
 * 「作成の後に書き換わる」の定義の本体は `model/written-after-create.ts` の `rewrittenAfterCreate`(編集・遷移の宣言・更新で発火する供給・
 * 外部キーの `set_null` / `set_default`。未ログインの作成の天井と T28 と同じ 1 本。点検 21 回目 C の O21-1)。
 *
 * 参照の列(entity_spec の `ref`)だけを並べる —— 判定が当てにするのは結合の鍵だけである。新しい宣言の種類は足していない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import { rewrittenAfterCreate } from '../model/written-after-create.js';
import { aggregateOfTable } from '../model/data/ceiling-plan.js';
import { firesOnUpdate } from '../model/trigger-fires.js';

/** 表 1 つの、作成の後に書き換わらない参照の列(宣言順)。 */
export interface FixedReferenceColumns {
  readonly table: string;
  readonly columns: readonly string[];
}

/**
 * 全 data_table の、作成の後に書き換わらない参照の列。
 *
 * @param tables 全 data_table
 * @param domain ドメイン仕様
 * @returns 表ごと(表名のバイト順。列が 1 つも無い表は載せない)
 */
export function fixedReferenceColumnsOf(tables: readonly DataTableSpec[], domain: SpecModel): readonly FixedReferenceColumns[] {
  const out: FixedReferenceColumns[] = [];
  for (const table of [...tables].sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0))) {
    const specs = aggregateOfTable(table, domain) ?? undefined;
    const fields = specs?.entity?.fields ?? [];
    const columns = fields
      .filter((field) => field.type.kind === 'ref')
      .map((field) => field.name)
      .filter((column) => specs !== undefined && !rewrittenAfterCreate(column, specs, table, firesOnUpdate));
    if (columns.length > 0) out.push({ table: table.table, columns });
  }
  return out;
}
