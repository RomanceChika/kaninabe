/**
 * **計算で決まる列**(action_spec の `computes` の書き先)の引き当て(意味解析の層)。
 *
 * 計算で決まる値は入力として受け付けない(2026-10-20 オーケストレーターの裁定)。書くのは `computes` を宣言した
 * 操作の RPC(または計画)だけで、`access_spec` の `writes` には行を持たない(V18 が並べた行を止める)。
 * だから「この列を遷移が書く」ことの宣言は、access_spec ではなく **`computes` の宣言そのもの**から導く ——
 * 手で写した印(以前の `writes` の `by: system` の行)を置かないので、書き忘れも腐った写しも起きない。
 *
 * 読むのは action_spec の `handles` と `computes` だけで、どの操作が遷移かは `groundOperation` が決める
 * (A1 と同じ接地)。純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { ActionSpec } from '../model/trace/types.js';
import { groundOperation } from './operation-ground.js';

/**
 * そのエンティティの列のうち、**どれかの遷移の `computes`** が書くもの(重複なし・action_spec の並び順)。
 *
 * 遷移の集約がどれかは問わない —— 1 つの業務イベントが別の集約の列も計算して書く形(料金の確定が
 * 枠や参加者の額を書く)も、その列から見れば「遷移が書く列」である。編集・作成の `computes` は数えない
 * (遷移ではないので、遷移の手でその列が動くことの根拠にならない)。
 *
 * @param model ドメイン仕様全体
 * @param actions 読み込んだ action_spec(無ければ空)
 * @param entity 列の持ち主のエンティティ名
 * @returns 列名
 */
export function transitionComputedColumns(model: SpecModel, actions: readonly ActionSpec[], entity: string): readonly string[] {
  const columns = new Set<string>();
  for (const action of actions) {
    if (!action.computes.some((decl) => decl.entity === entity)) continue;
    if (groundOperation(model, action.handles.raw).kind !== 'transition') continue;
    for (const decl of action.computes) if (decl.entity === entity) columns.add(decl.field);
  }
  return [...columns];
}
