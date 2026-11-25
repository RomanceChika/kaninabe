/**
 * V14 ux 上書きは理由必須。
 *
 * action-spec-writing.md「方針の導出」: `ux:` は導出結果(`confirm_required` / `variant`)の
 * 上書きであり、上書きである以上「なぜ導出を信じないのか」を書かせる。`reason` の無い
 * `ux:` は「なんとなく確認を消した／足した」と機械的に区別が付かないため、A 群と同じ形
 * (作る側は `legacy/spec-tools/lib/trace`)だが domain-spec-writing.md の V 系列の続きとして
 * V14 として報告する(CLAUDE.md ⑪c 設計メモ)。
 *
 * verify の実行状況の 1 行に「理由つき受け入れ N 件」として件数を出すのは lib/compose/verify-pipeline.ts の役目
 * (ここは Finding を返すだけ)。
 */

import type { Finding, TraceVerifier } from '../verifier.js';
import { traceFinding } from '../verifier.js';
import type { TraceInput } from '../input.js';

/** V14: `ux` を書いたら `reason` が空でないことを検証する。 */
export const uxOverrideReasonVerifier: TraceVerifier = {
  id: 'V14',
  title: 'ux 上書きは理由必須 — confirm の上書きに reason が伴っているか',

  verify(input: TraceInput): Finding[] {
    const findings: Finding[] = [];
    for (const action of input.actions.actions) {
      const ux = action.ux;
      if (ux === undefined) continue;
      if (ux.reason !== undefined && ux.reason.trim() !== '') continue;
      findings.push(
        traceFinding('V14', {
          message: `${action.id} の ux.confirm(${ux.confirm})に reason がありません`,
          location: ux.location,
          suggestion:
            'ux.reason に上書きの理由を日本語 1 文で書く' +
            '(例: 「screen_spec に対応する overlay が無く、今回は画面変更をスコープ外にした」)',
          counterexample: { id: action.id, confirm: ux.confirm },
        }),
      );
    }
    return findings;
  },
};
