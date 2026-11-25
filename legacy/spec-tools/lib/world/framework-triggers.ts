/**
 * 仕組みが自分で持つ表(`jobs` / `domain_events`)の**追記専用トリガの宣言**(名前・関数名・発火)。
 *
 * ここが持つのは宣言だけである —— トリガ関数の本体(SQL の文字列)は持たない。
 * 本体を組むのは `lib/sql/framework-guards.ts` で、そこがこの宣言の名前を鍵に本体を引く。
 * **名前と発火の正はここ 1 か所**であり、SQL 側は同じ宣言を読むだけなので割れない。
 *
 * ## なぜ SQL の側から分けたのか
 *
 * 「この表は追記専用か」「この表に在るトリガの全数」は、**宣言から読める事実**である。
 * 保存点の結果表は追記専用の表を片付けの対象から外すためにこれを引き、ハンドブックの
 * 表の章は「この表に在るトリガの全数」にこれを足す。どちらも SQL の翻訳器を呼ぶ理由が
 * 無いのに、宣言と本体が 1 つのファイルに同居していたので、人向けの出力が SQL の生成器
 * (`guard-to-sql` / `ddl-guards`)を道連れにしていた(設計メモ §11)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataFunctionDecl, DataTableSpec, DataTriggerDecl } from '../model/data/types.js';

/**
 * 宣言されたトリガの名前(DB の実名)。
 *
 * 値域を型で閉じてあるので、SQL の側が持つ本体の表(`Record<FrameworkTriggerName, …>`)は
 * 宣言に名前を足した日に**型が通らなくなる** —— 本体の無い宣言が黙って SQL にならない形を作らない。
 */
export type FrameworkTriggerName = 'domain_events_append_only';

/** 仕組みの表のトリガ 1 本の宣言(SQL の本体を持たない)。 */
export interface FrameworkTriggerSpec {
  /** トリガ名(DB の実名)。 */
  readonly name: FrameworkTriggerName;
  /** 実行する関数の名前。 */
  readonly functionName: string;
  /** 発火の宣言(例: `before update or delete`)。 */
  readonly fires: string;
}

/** 追記専用の執行(監査ログの改変を拒否するトリガ)の宣言。 */
const APPEND_ONLY_TRIGGER: FrameworkTriggerSpec = {
  name: 'domain_events_append_only',
  functionName: 'reject_domain_events_mutation',
  fires: 'before update or delete',
};

/** 仕組みの表の名前 → その表に置くトリガ(執行点を持たない表は空)。 */
const TRIGGERS_BY_TABLE: Readonly<Record<string, readonly FrameworkTriggerSpec[]>> = {
  domain_events: [APPEND_ONLY_TRIGGER],
};

/**
 * その表に置くトリガの宣言の全数。
 *
 * @param table data_table
 * @returns トリガの宣言(執行点を持たない表・仕組みの表でなければ空)
 */
export function frameworkTriggerSpecsOf(table: DataTableSpec): readonly FrameworkTriggerSpec[] {
  if (table.framework === undefined) return [];
  return TRIGGERS_BY_TABLE[table.framework] ?? [];
}

/**
 * 設計図が持つトリガを、**data_table の宣言の形**に写す。
 *
 * 突合(`data-table-parity`)とテーブル仕様のマトリクスは、宣言されたトリガと同じ形でこれを読む ——
 * 「設計図が持つ」ことは正の置き場の違いであって、実 DB に在るべき実体としては同じものである。
 *
 * @param table data_table
 * @returns トリガの宣言(宣言されたものと並べて閉世界になる)
 */
export function frameworkTriggerDecls(table: DataTableSpec): readonly DataTriggerDecl[] {
  return frameworkTriggerSpecsOf(table).map((trigger) => ({
    name: trigger.name,
    functionName: trigger.functionName,
    fires: trigger.fires,
    // コミット時評価ではない(改変はその文の時点で拒否する。遅らせる理由が無い)。
    deferred: false,
    supplies: [],
    params: {},
  }));
}

/**
 * 設計図が持つトリガ関数を、**data_table の帰属宣言の形**に写す。
 *
 * @param table data_table
 * @returns 関数の宣言(`kind: trigger`。引数なし)
 */
export function frameworkFunctionDecls(table: DataTableSpec): readonly DataFunctionDecl[] {
  return frameworkTriggerSpecsOf(table).map((trigger) => ({
    name: trigger.functionName,
    args: [],
    params: [],
    kind: 'trigger',
    alsoWrites: [],
  }));
}
