/**
 * T15 のうち、**同じ行の日時列 ± 定数の幅で列を決めるトリガ**(`triggers[].derives`)の側。
 *
 * `derives` を宣言した列は「生成物が埋める」と数える(列を埋める機構が無いという警告は出ない)。
 * その代わり、宣言が**嘘にならない**ことをここが見る —— 判定は生成する側(`ddl-derive-triggers.ts`)と
 * 同じ 1 本(`derive-problems.ts` の `derivationProblemsOf`)を呼ぶので、検査器と生成器が食い違わない。
 *
 * | 見ること | 重さ |
 * |---|---|
 * | 元(`from`)が自表の日時の欄で、導出する列自身でない | error |
 * | 幅(`offset`)が閉じた語(`{±n} {minute\|hour\|day}`)に合う | error |
 * | 方式(`mode`)が値域(`initial` / `follow`)にある | error |
 * | 導出する列が `supplied_by: db` を宣言している | error |
 * | 同じ列を 2 つのトリガが導出しない | error |
 * | `supplies` と `derives` の列が一致する | error |
 * | `follow` の `fires` が元の列の更新を含む(含まなければ宣言の嘘) | error |
 * | `fires` が値を入れられる形(before・insert を含む・表名を書かない) | error |
 * | 関数が `handwritten` でない(本文は生成物) | error |
 *
 * **warning ではなく error である**のは、写しの側の「導けない列」と違って、書いた人が**導出を
 * 宣言した**からである —— 宣言した以上、通らない形は宣言の誤りで、直し方が 1 つに決まる。
 *
 * **免除リストは無い。**
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { derivationProblemsOf } from '../../sql/derive-problems.js';
import type { DataTableSpec, DataTriggerDecl } from '../../model/data/types.js';

/** この検証器の ID(T15 の一部)。 */
const VERIFIER_ID = 'T15';

/**
 * `derives` を宣言したトリガ 1 本の宣言を見る。
 *
 * @param trigger トリガの宣言
 * @param table テーブル仕様
 * @param domain ドメイン仕様
 * @returns 違反のリスト(通れば空。関数の宣言の有無は呼び出し側が見る)
 */
export function checkDerivedTrigger(
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  domain: SpecModel,
): Finding[] {
  return derivationProblemsOf(trigger, table, domain).map((problem) => ({
    verifier: VERIFIER_ID,
    severity: 'error',
    message: `${table.table} のトリガ ${trigger.name} の導出の宣言が通りません: ${problem.reason}`,
    location: { ...table.location, pointer: `triggers.${trigger.name}.${problem.path}` },
    suggestion: problem.suggestion,
    counterexample: { table: table.table, trigger: trigger.name, ...problem.example },
  }));
}
