import { DatabaseError } from 'pg';
import type { InvariantResolver } from '@kaninabe/runtime/bindings';
import type { CommitOutcome } from '@kaninabe/runtime/ports';
import { classifyDbFailure, commitOfDbError, sqlstateOrNull } from '@kaninabe/runtime/refusal';

/**
 * pg が投げた失敗を、中立の結果に読む(拒否の分類は runtime の `classifyDbFailure` に通す)。
 *
 * | 失敗 | 意味 | 結果 |
 * |---|---|---|
 * | `DatabaseError` で SQLSTATE が拒否(`UC403` ほか)に当たる | 業務の拒否 | `forbidden` / `guard_unsatisfied` / `conflict` |
 * | `DatabaseError` で本文が制約名に引ける | 不変条件違反 | `invariant_violated` |
 * | `DatabaseError` のそれ以外 | 仕様に無い理由の失敗 | `unknown_failure`(txn ごと戻る類の SQLSTATE なら `not_committed`、それ以外は `unknown`。表は `commitOfDbError`) |
 * | `DatabaseError` でない失敗で、木の独立した枝が全部、接続の前の失敗と証明できる | 届く前に落ちた | `transport_failed`(`not_committed`) |
 * | `DatabaseError` でない失敗(枝が 1 つでも疑わしいときを含む) | 送ったあとかもしれない(切断・タイムアウト・接続拒否と切断が混ざる集約ほか) | `transport_failed`(`unknown`) |
 *
 * **`not_committed` と言うのは、接続の前に落ちたと証明できるときだけ**: 接続拒否・名前解決の失敗。
 * 切断(`ECONNRESET`)・問い合わせのタイムアウト・プールの待ち合わせのタイムアウトは、証明できないので
 * `unknown` に倒す(安全側。PostgREST の adapter が `(ECONNREFUSED)` などの書式で判定するのと同じ線)。
 *
 * **失敗は木で読み、独立した枝は全部証明できなければならない**: `AggregateError.errors[]` の枝は別々の試みなので、
 * 1 つでも疑わしい(切断・コードの無い失敗)なら、その枝は送れていたかもしれず `unknown` になる。
 * コードの無い包み(`fetch failed` など)は、原因と枝が全部証明できたときだけ証明になる。
 * 自分が接続の前の失敗コードを持つなら、ただの説明の原因(コードも枝も輪も無い連鎖)は許し、構造を持つ原因は証明を要る。
 * `DatabaseError` は DB が答えたということなので、通信の失敗にはしない。
 */

/** 接続の前に落ちたと証明できる原因コード(接続拒否・名前解決の失敗)。 */
const NOT_CONNECTED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

/** 失敗(`code` / `cause` / `errors` を持ちうる値)から、判定に使う 3 つの欄を取り出す。 */
function partsOf(error: object): { readonly code: unknown; readonly cause: unknown; readonly branches: readonly unknown[] } {
  const { code, cause, errors } = error as { readonly code?: unknown; readonly cause?: unknown; readonly errors?: unknown };
  return { code, cause, branches: Array.isArray(errors) ? (errors as readonly unknown[]) : [] };
}

/**
 * 原因が**ただの説明**か(コードも独立した枝も持たず、輪にもならない連鎖)。
 *
 * 接続の前の失敗コードを持つ失敗の原因は、説明なら読み飛ばしてよい。ただし、原因が**構造を持つ**とき
 * (自分の `code` がある・`errors[]` の枝がある・祖先に戻る輪)は説明ではなく、その中身の証明が要る
 * —— 枝や輪を説明扱いすると、送れていたかもしれない試みを黙って落とす。
 *
 * @param cause - 原因(`undefined` でない値)
 * @param path - 今たどっている祖先(輪を見つける)
 * @returns 説明として読み飛ばしてよいなら true
 */
function isPlainDescription(cause: unknown, path: Set<unknown>): boolean {
  if (typeof cause !== 'object' || cause === null) return true;
  if (path.has(cause)) return false;
  const { code, cause: inner, branches } = partsOf(cause);
  if (typeof code === 'string' || branches.length > 0) return false;
  if (inner === undefined) return true;
  path.add(cause);
  try {
    return isPlainDescription(inner, path);
  } finally {
    path.delete(cause);
  }
}

/**
 * その失敗が、**どの枝も**接続の前に落ちたと証明できるか。
 *
 * 失敗は木である: `errors[]` は独立した枝(別々の宛先へ送った試み)・`cause` は「何が原因でこの失敗になったか」の連鎖。
 * 枝が 1 つでも疑わしければ(切断・コードの無い失敗など)、その枝は送れていたかもしれないので証明にならない。
 *
 * @param error - 判定する失敗(木の根)
 * @param path - 今たどっている祖先(輪を止める。同じ失敗が別の枝に出てくるのは輪ではない)
 * @returns 証明できるなら true
 */
function provenNotConnected(error: unknown, path: Set<unknown> = new Set()): boolean {
  if (typeof error !== 'object' || error === null || path.has(error)) return false;
  const { code, cause, branches } = partsOf(error);
  if (typeof code === 'string' && !NOT_CONNECTED.has(code)) return false;
  path.add(error);
  try {
    if (!branches.every((branch) => provenNotConnected(branch, path))) return false;
    if (typeof code === 'string') {
      // 自分が接続の前の失敗なら、原因はただの説明でよい。構造を持つ原因(コード・枝・輪)は証明を要る。
      return cause === undefined || isPlainDescription(cause, path) || provenNotConnected(cause, path);
    }
    // コードの無い包み(`fetch failed` ほか)は、中身(枝と原因)がちゃんと全部証明できたときだけ。
    if (cause !== undefined && !provenNotConnected(cause, path)) return false;
    return cause !== undefined || branches.length > 0;
  } finally {
    path.delete(error);
  }
}

/**
 * pg が投げた失敗を、中立の結果にする。
 *
 * @param error - `query` が投げた値
 * @param invariantOfMessage - DB の不整合のメッセージ → 不変条件 ID(製品が渡す)
 * @returns 業務の拒否・不変条件違反・通信の失敗・想定外の失敗(どれも `cause` に元の失敗を持つものがある)
 */
export function outcomeOfError(error: unknown, invariantOfMessage: InvariantResolver): CommitOutcome<never> {
  if (error instanceof DatabaseError) {
    const code = error.code ?? '';
    const classified = classifyDbFailure(
      { sqlstate: code, message: error.message, detail: error.detail ?? null, hint: error.hint ?? null },
      invariantOfMessage,
    );
    if (classified !== undefined) return classified;
    return { kind: 'unknown_failure', commit: commitOfDbError(code), sqlstate: sqlstateOrNull(code), cause: error };
  }
  const notCommitted = provenNotConnected(error);
  return { kind: 'transport_failed', commit: notCommitted ? 'not_committed' : 'unknown', cause: error };
}
