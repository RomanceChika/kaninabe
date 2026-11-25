/**
 * T1 のうち、**状態の欄の `defaults`** を止める部分(点検 12 回目 A12-1)。
 *
 * 作成の RPC の `insert` は状態の列を書かないので、行の初期状態は列の既定値が決める。`ddl-plan.ts` の `planColumn` は `defaults` を
 * 状態機械の `initial` より優先するので、`defaults` に状態の欄を書くと、R2・V5・engine・形式の初期条件(どれも `initial` を読む)と
 * 実際の DB が黙って食い違う(メンバーが最初から有効になる・入金の遷移を飛ばして支払い済みで始まる)。
 *
 * 初期状態の正は state_spec の `initial` の 1 か所である。値が `initial` と同じでも書かせない —— 片方を直した日に食い違いが戻るからである。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { Finding } from '../../kernel/finding.js';
import type { DataTableSpec } from '../../model/data/types.js';
import type { SpecModel } from '../../model/types.js';
import { findEntityFields } from '../../semantics/domain-index.js';

/**
 * `defaults` に書かれた状態の欄を error にする。
 *
 * @param spec テーブル仕様
 * @param domain ドメイン仕様
 * @param verifier 検証器の ID
 * @returns 違反のリスト
 */
export function checkStateDefaults(spec: DataTableSpec, domain: SpecModel, verifier: string): Finding[] {
  if (spec.entity === undefined) return [];
  const fields = findEntityFields(domain, spec.entity) ?? [];
  return fields.flatMap((field) => {
    const raw = spec.defaults[field.name];
    if (raw === undefined || field.type.kind !== 'state') return [];
    return [
      {
        verifier,
        severity: 'error' as const,
        message: `${spec.table} の defaults に状態の欄 ${field.name}(${raw})があります —— 状態機械 ${field.type.machine} の initial を黙って上書きします`,
        location: { ...spec.location, pointer: `defaults.${field.name}` },
        suggestion: `defaults から ${field.name} を消す。初期状態を変えるなら state_spec の initial を直す(検査と形式の証明が読むのはそこだけで、列の既定値はそこから生成される)`,
        counterexample: { table: spec.table, field: field.name, machine: field.type.machine, default: raw },
      },
    ];
  });
}
