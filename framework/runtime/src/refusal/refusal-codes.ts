/**
 * **拒否の分類の語**(errcode・本文の接頭辞・エンジンの拒否理由)の app 側の写し。
 *
 * 仕様: legacy/spec-tools/lib/sql/refusal-codes.ts（語の正。生成される plpgsql が使う）
 *
 * docs と app はビルドの境界を跨ぐので、app から docs の定数を import して使うことはできない
 * （app のバンドルに docs のツールが混ざる）。**写しを持つこと自体は避けられない**ので、
 * 代わりに「写しがずれていないこと」を `legacy/spec-tools/__tests__/guarantees/refusal-codes-parity.test.ts` が
 * 機械で見る。
 *
 * **この 1 ファイルが app 側の唯一の写しである**（束 ⑳-5a-b）。結末を読む側（`rpc-outcome.ts`）
 * と、先読みの理由から errcode を引く側（一致の証明の `@kaninabe/runtime/testing/equivalence/oracle`）が別々に表を
 * 持っていたころは、`invalid_from → UC409` がどの 1 表にも無いまま片方だけに書かれていた
 * （束 ⑳-5a の独立レビュー 1-d）。
 *
 * 何にも依存しない純粋な表であり、**アプリの語彙は 1 語も持たない**。
 */

/**
 * 拒否の分類 → SQLSTATE・接頭辞・エンジンの拒否理由。
 *
 * `reasons` は engine（`canFire` / `canCreate` / `canWrite` / `canDelete`）が返す理由の語である。
 * 遷移だけが `invalid_from` / `unknown_event` を持ち、残りの 3 入口は前 3 つを返す。
 */
export const REFUSALS = [
  {
    kind: 'forbidden',
    code: 'UC403',
    prefix: 'usecase_forbidden:',
    reasons: ['role_forbidden'],
  },
  {
    kind: 'guard_unsatisfied',
    code: 'UC412',
    prefix: 'usecase_guard:',
    reasons: ['guard_unsatisfied', 'guard_unknown'],
  },
  {
    kind: 'conflict',
    code: 'UC409',
    prefix: 'usecase_conflict:',
    reasons: ['invalid_from', 'unknown_event'],
  },
] as const;

/**
 * engine の拒否理由 → RPC が返す errcode。
 *
 * @param reason - engine が返した拒否理由
 * @returns 対応する errcode。表に無い理由なら `undefined`（それ自体が反例である）
 */
export function refusalCodeOfReason(reason: string): string | undefined {
  return REFUSALS.find((refusal) => (refusal.reasons as readonly string[]).includes(reason))?.code;
}
