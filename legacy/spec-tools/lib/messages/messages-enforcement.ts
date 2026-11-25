/**
 * A18 の「執行点が無い理由」の**文面**(事実 → 日本語 1 行)。
 *
 * 判定そのもの(`unenforcedWriteRules`)は `lib/semantics/unenforced-write-rules.ts` にあり、検証器(A18)と
 * 変異の目録(`lib/mutation/exemptions.ts`)が同じ判定を読む。ここは**事実を受けて字面を組むだけ**で、
 * 共有の文言なので文言の層に置く。
 */

import type { EnforcementGap } from '../semantics/unenforced-write-rules.js';

/**
 * 執行点が無い理由の 1 行の文面(事実 → 日本語)。
 *
 * @param gap 執行点が無い理由(事実)
 * @returns 執行点が無い理由の 1 行
 */
export function enforcementGapWords(gap: EnforcementGap): string {
  switch (gap.kind) {
    case 'no_table':
      return 'その集約に帰属する data_table がありません';
    case 'no_function':
      return `${gap.table} に kind: rpc / shape: ${gap.shape} の関数がありません`;
    case 'unwatched_handwritten':
      return `${gap.table} の shape: ${gap.shape} は handwritten ですが、見張る test_cases が 1 つもありません`;
  }
}
