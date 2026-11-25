/**
 * T9 **トリガが供給する列は entity_spec が「DB が決める値」と宣言する**(V17 の逆向き)。
 *
 * V17 は `supplied_by: db` の側から「機構(`defaults` か `triggers[].supplies`)があるか」を見る。
 * 逆は見ていなかった —— data_table が `triggers[].supplies` に載せた列が、entity_spec では
 * ふつうの入力欄のままでいられた。宣言が片側にしか無いと、**同じ列について「人が入れる値」と
 * 「DB が決める値」の 2 つの読みが同時に立つ**。
 *
 * 実害は生成物に出る。値の写像(RLS の挙動テストの world・フォームの初期値)は `supplied_by: db` を
 * 見て「置かない列」を決めるので、宣言していない写しの列にはテストが値を書き込もうとする
 * (トリガが上書きするので静かに食い違う)。親の集約から写すテナントの列が実例だった
 * (独立レビュー ⑳-4b ④)。
 *
 * 対処は 1 つである —— entity_spec のその欄に `supplied_by: db` を足す。足すと V17 が
 * (a) 入力に現れない (b) 機構がある (c) 作成 RPC に渡す口が無い を続けて見るので、宣言は
 * そこで閉じる。トリガが埋めるのをやめるなら `triggers[].supplies` から外す。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import { findEntitySpec } from '../../semantics/domain-lookup.js';
import type { DataTableSpecModel } from '../../model/data/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T9';

/**
 * `triggers[].supplies` に載る列が entity_spec で `supplied_by: db` を宣言しているかを見る。
 *
 * @param domain 構築済みのドメイン仕様モデル
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
export function verifySuppliesDeclared(domain: SpecModel, dataTables: DataTableSpecModel): Finding[] {
  if (!dataTables.available) return [];
  const findings: Finding[] = [];
  for (const table of dataTables.tables) {
    const spec = table.entity === undefined ? null : findEntitySpec(domain, table.entity);
    if (spec === null) continue;
    for (const trigger of table.triggers) {
      for (const column of trigger.supplies) {
        const field = spec.fields.find((candidate) => candidate.name === column);
        if (field === undefined || field.suppliedBy === 'db') continue;
        findings.push({
          verifier: VERIFIER_ID,
          severity: 'error',
          message: `${table.table} のトリガ ${trigger.name} が ${column} を供給しますが、${spec.entity}.${column} は supplied_by: db を宣言していません`,
          location: { ...table.location, pointer: `triggers.${trigger.name}.supplies` },
          suggestion:
            `entity_spec の ${spec.entity}.${column} に "supplied_by: db" を足す(足すと V17 が入力の口と` +
            `作成 RPC の引数まで続けて見る)。トリガが埋めるのをやめるなら ${trigger.name} の supplies から外す`,
          counterexample: { table: table.table, trigger: trigger.name, entity: spec.entity, field: column },
        });
      }
    }
  }
  return findings;
}
