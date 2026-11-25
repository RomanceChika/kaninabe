import type { InvariantResolver } from '@kaninabe/runtime/bindings';
import type { CommitOutcome, Json, RpcReturn, TransportFailed, UnknownFailure } from '@kaninabe/runtime/ports';
import { DbInfrastructureError, receiptOf } from '@kaninabe/runtime/ports';
import { classifyDbFailure, commitOfDbError, sqlstateOrNull } from '@kaninabe/runtime/refusal';
import { isCertainRollback } from './rollback-retry';

/**
 * **RPC の結末を契約の形に読む写像**(`toOutcome`)と、それが要る最小の型。
 * 実行計画が名指しした関数を名前付き引数で 1 回実行する口(`rpc.caller.ts`・`call-rpc.ts`)の下にある。
 *
 * 仕様: docs/rules/decisions/common/ADR-0012-db-as-authority.md ④
 *       docs/rules/process/backend/system/standards/conventions/server-actions.md（5 形 × RPC）
 *       生成物 `@/domain/generated/rpc-signatures`（関数名・引数名の閉世界）
 *
 * 集約ごとのリポジトリと違い、**この口は集約を知らない**。関数名も引数名も実行計画
 * （仕様からの生成物）が渡す。ここが持つのは「結末をどう読むか」という写像だけである。
 *
 * | DB からの合図 | 意味 | 写像 |
 * |---|---|---|
 * | エラー無し・0 行 | 判断の前提が書き込みまでに崩れた（楽観的並行制御） | `conflict` |
 * | エラー無し・1 行以上 | 書けた | `saved`(受領: 要求した効果 + `outbox: unknown`) |
 * | `UC403` + `usecase_forbidden:{操作}` | RPC が `by`（ロール）で落とした | `forbidden` |
 * | `UC412` + `usecase_guard:{操作}` | RPC がガードで落とした | `guard_unsatisfied` |
 * | `UC409` + `usecase_conflict:{操作}` | 状態が判断時と違う（複合 RPC の手順を含む） | `conflict` |
 * | 23xxx（制約名が本文に出る） | 不変条件違反 | `invariant_violated` |
 * | `code` が空（クライアント側の通信の失敗） | DB に届いたか分からない | `transport_failed`(接続の前に落ちたと証明できるときだけ `not_committed`) |
 * | それ以外 | 想定外（権限不足・PostgREST 自身のエラーなど） | `unknown_failure`(SQLSTATE が txn ごと戻る類で HTTP が 4xx なら `commit: not_committed`、それ以外は `unknown`) |
 *
 * **通信の失敗と想定外の失敗は戻り値で返し、実行器の 1 か所(`settle`)が `DbInfrastructureError` として
 * 投げる**(ARCH-BE-0013。握りつぶさない)。PostgREST の message / details / hint は契約の欄に出さず、
 * `cause` にだけ入れる。
 *
 * **3 分類は束 ⑳-3 で増えた**。それまで定型 RPC は 0 行を返すだけだったので、理由は「競合」の
 * 1 つしか無かった。本文が `by` とガードを守るようになると 0 行の理由が 3 つに分かれるので、
 * DB が errcode で返す（`legacy/spec-tools/lib/sql/refusal-codes.ts` が語の 1 か所）。
 *
 * **0 行を競合と読むのは「条件つきの書き込み」だけに成り立つ**。5 形の定型 RPC はどれも判断時の
 * 値を条件に持つ（`where ... and state = p_expected_state`）ので、エラーを伴わない 0 行は
 * 「前提が崩れた」である（server-actions.md §5 形 × migration の要否）。行を返さない形の関数が
 * 現れたら、その判定はここではなく関数の側の契約の問題である。
 */

/** PostgREST が返すエラーの形のうち、ここで使う部分。 */
export interface PostgrestErrorLike {
  readonly code: string;
  readonly message: string;
  readonly details: string | null;
  readonly hint: string | null;
}

/** 関数名を実行時に決める最小の口(やり直しの口を通ったもの。作り方と型の印は `rollback-retry.ts`)。 */
export type { RpcSource } from './rollback-retry';

/**
 * 接続の前に落ちたと**証明できる**クライアント側の失敗の印(文字列での判定。取れなければ `unknown` になる = 安全側)。
 *
 * postgrest-js(2.x)は fetch の失敗を、`details` に
 * `{失敗の name}: {message}\n\nCaused by: {cause の name}: {cause の message} ({cause の code})\n{cause の stack}` と書く。
 * 読むのは**直接の原因 1 つ**だけで、`(原因コード)` が付くのはその原因が自分の `code` を持つときである。
 * Node の `fetch` が接続を張れないときの原因は `AggregateError`(宛先ごとの試みを `errors[]` に持つ)で、
 * その `code` は**先頭の枝のコードの写し**になる。`errors[]` の中身は `details` に出ない(`stack` にも載らない)。
 * したがってこの文字列から読めるのは「直接の原因のコード」と、本文・`stack` に混ざった `(…)` までで、枝ごとの判定はできない。
 * 先頭の枝が接続拒否で後ろの枝が切断の集約は、`details` には接続拒否の印しか出ないので、ここからは見分けられない。
 * そこで**原因が集約(`AggregateError`)だと見えたら、枝の情報が落ちているので `unknown`** にする。Node の標準の `fetch` の
 * 集約は宛先ごとの接続の試みだけのはずだが、差し替えた `fetch` や依存の版でそれが保たれることをこの口は執行していないので、
 * 文字列から「全部の枝が接続の前」とは言わない(pg の参照 adapter は木をたどれるので、枝を 1 つずつ確かめる)。
 * 代わりに、接続を張れない失敗の多く(宛先が複数ある名前の接続拒否)が `unknown` になる。安全側の代価として受け入れる。
 *
 * **`not_committed` と言うのは、原因が集約でなく、`(E…)` の印が 1 つ以上あり、見えた印が全部接続の前の失敗のときだけ**。
 * 接続拒否・名前解決の失敗はリクエストが相手に着く前の失敗なので、コミットしていないと言える。
 * タイムアウトや切断は、リクエストを送ったあとかもしれないので入れない(= `unknown`)。1 つでも別の印(切断など)が
 * 混ざれば、その分の試みは送れていたかもしれないので `unknown` になる。
 */
const NOT_CONNECTED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

/** 原因が集約だという印(`Caused by: AggregateError: …`)。枝の中身は `details` に出ない。 */
const AGGREGATE_CAUSE = /\bAggregateError\b/u;

/** `details` に見える原因コードの印(`(ECONNREFUSED)` の形。括弧つきの大文字の `E…`)を全部取り出す(括弧は外す)。`g` の正規表現は `lastIndex` を持つので呼び出しの中で作る(点検 14 回目 B14-2)。 */
function codeMentions(details: string): readonly string[] {
  return (details.match(/\(E[A-Z0-9_]+\)/gu) ?? []).map((mention) => mention.slice(1, -1));
}

/** クライアントの通信の失敗(`code` が空)を、コミットの状態つきの結果にする。 */
function transportFailed(error: PostgrestErrorLike): TransportFailed {
  const details = error.details ?? '';
  const mentions = codeMentions(details);
  const notCommitted = !AGGREGATE_CAUSE.test(details) && mentions.length > 0 && mentions.every((code) => NOT_CONNECTED.has(code));
  return { kind: 'transport_failed', commit: notCommitted ? 'not_committed' : 'unknown', cause: error };
}

/**
 * 仕様に無い理由の失敗の、コミットの状態の閉じた表(点検 25 回目 O25-1)。
 *
 * | `code` | HTTP の状態 | コミット | なぜ |
 * |---|---|---|---|
 * | txn ごと戻る類の SQLSTATE(`commitOfDbError` が `not_committed`) | 4xx | `not_committed` | PostgREST が誤りの応答を組み立てて返した = 要求の txn は戻っている |
 * | 同上 | 4xx でない・無い | `unknown` | PostgREST の組み立てた応答と言い切れない(中継の応答・状態を渡さない呼び手) |
 * | 巻き戻りが確実な `40001` / `40P01`(やり直しの口が尽きた) | どれでも | `not_committed` | DB が取引を中止した(本文の `code` は DB の SQLSTATE。点検 27 回目の決め) |
 * | 表の外の SQLSTATE(接続・資源・停止・内部の失敗ほか) | どれでも | `unknown` | コミットの最中に落ちたかもしれない |
 * | SQLSTATE の形でない(`PGRST…` ほか) | どれでも | `unknown` | PostgREST 自身の誤り。証明の材料を持たない |
 */
function failureCommit(code: string, status: number | undefined): UnknownFailure['commit'] {
  // やり直しの口が尽きた巻き戻りの確実な失敗(40001 / 40P01)は、HTTP の状態に依らず書けていない(DB が取引を中止した。点検 27 回目の決め)。
  if (isCertainRollback({ code })) return 'not_committed';
  const fromPostgrest = status !== undefined && status >= 400 && status < 500;
  return fromPostgrest ? commitOfDbError(code) : 'unknown';
}

/**
 * 仕様に無い理由の失敗を結果にする(コミットの状態は `failureCommit` の表)。
 *
 * @param error - PostgREST が返したエラー
 * @param status - 応答の HTTP の状態(呼び手が渡さなければ `unknown` に倒す)
 * @returns 想定外の失敗
 */
function unknownFailure(error: PostgrestErrorLike, status?: number): UnknownFailure {
  return {
    kind: 'unknown_failure',
    commit: failureCommit(error.code, status),
    sqlstate: sqlstateOrNull(error.code),
    cause: error,
  };
}

/**
 * RPC の戻り値を契約の形に直す(PostgREST が返すのは JSON.parse の結果なので Json である)。
 *
 * 配列は行の列(`rows`)・それ以外(オブジェクト・`null`・スカラー)は文書 1 つ(`document`)。
 */
function returnedOf(data: unknown): RpcReturn {
  if (Array.isArray(data)) return { shape: 'rows', rows: data as readonly Json[] };
  return { shape: 'document', document: (data ?? null) as Json };
}

/**
 * エラー・戻り値を結果に写す（`UsecaseRepository` と共有する唯一の写像）。
 *
 * @param data - PostgREST が返した行（`setof` の関数なら配列）
 * @param error - PostgREST が返したエラー（無ければ `null`）
 * @param emptyIsConflict - 0 行を競合と読むか（条件つきで書く定型 RPC は true、複合 RPC は false）
 * @param requestedEffects - この呼び出しが要求した効果（`requestedEffectsOf`。受領に写す）。要求を追っていない呼び出しは `null`
 * @param invariantOfMessage - DB の不整合のメッセージ → 不変条件 ID（製品が渡す。ADR-0013）
 * @param status - 応答の HTTP の状態(想定外の失敗のコミットの状態の材料。渡さなければ `unknown` に倒す)
 * @returns 書けた(受領)・業務の拒否・通信の失敗・想定外の失敗
 */
export function toOutcome(
  data: unknown,
  error: PostgrestErrorLike | null,
  emptyIsConflict: boolean,
  requestedEffects: readonly string[] | null,
  invariantOfMessage: InvariantResolver,
  status?: number,
): CommitOutcome<RpcReturn> {
  if (error === null) {
    // 0 行 = 条件（判断時の状態)と一致しなかった。**定型 RPC だけ**この読み方が成り立つ
    // （`setof` を返し、条件つきで書く形だから）。複合 RPC は jsonb を 1 つ返すので、
    // 空の配列が返ることが「0 行」を意味しない —— 呼び側が `emptyIsConflict` で示す。
    if (emptyIsConflict && Array.isArray(data) && data.length === 0) return { kind: 'conflict', op: '' };
    return { kind: 'saved', receipt: receiptOf(returnedOf(data), requestedEffects) };
  }
  const classified = classifyDbFailure(
    { sqlstate: error.code, message: error.message, detail: error.details, hint: error.hint },
    invariantOfMessage,
  );
  if (classified !== undefined) return classified;
  return error.code === '' ? transportFailed(error) : unknownFailure(error, status);
}

/**
 * 手書きのリポジトリが返す業務の拒否(集約ごとの `ports.ts` の生の非成功枝。`@kaninabe/runtime/template/outcome` の `seal` が受ける形)。
 *
 * 拒否の 3 分類(`forbidden` / `guard_unsatisfied` / `conflict`)は、ここでは全部 `conflict`(判断時の前提が崩れた)に寄せる ——
 * 手書きの口の経路は engine が先に同じ判定をしているので、DB が断ったのは判断から書き込みまでの間に前提が崩れたときだけである
 * (例: 消去の途中で実行者の運営スタッフが外れた = `UC403`。点検 27 回目 B27-1)。元の分類は {@link HandwrittenRefusalRead} の
 * `reason` に残す(実行者の資格の拒否を別の結末にする口 —— 例: AI の枠の `forbidden` —— が読む)。
 */
export type HandwrittenRefusal = { readonly kind: 'conflict' } | { readonly kind: 'invariant_violated'; readonly invariant: string };

/** 業務の拒否の読み(結末と、DB が返した元の分類)。 */
export interface HandwrittenRefusalRead {
  readonly refused: HandwrittenRefusal;
  readonly reason: 'conflict' | 'forbidden' | 'guard_unsatisfied' | 'invariant_violated';
  /** DB が返した元の失敗(拒否の detail / hint に閉じた語を載せる約束の RPC —— 告知の送信の制限 —— だけが読む)。 */
  readonly error: PostgrestErrorLike;
}

/**
 * **手書きのリポジトリの RPC の失敗を読む唯一の口**(点検 27 回目 B27-1)。
 *
 * 断りの分類は実行計画の口(`toOutcome`)と同じ部品を同じ順に通す: 業務の拒否(`UC403` / `UC412` / `UC409`)と不変条件違反は戻り値の
 * 拒否(4xx の業務の結末・コミットは確定 = 戻った)、通信の失敗と想定外の失敗は `DbInfrastructureError` で投げる(コミットの状態つき)。
 * それまで各リポジトリは `refusalKindOf` と `dbFailure` を自分で並べていて、並べ忘れた 8 関数(erase_member ほか)は確実に戻った
 * 拒否を HTTP 500・コミット unknown にしていた。
 *
 * @param where - どの呼び出しか(RPC の名前。投げるときのメッセージに載せる)
 * @param error - PostgREST が返したエラー
 * @param invariantOfMessage - DB の不整合のメッセージ → 不変条件 ID(リポジトリが持つ制約名の表)
 * @param status - 応答の HTTP の状態(想定外の失敗のコミットの状態の材料)
 * @returns 業務の拒否の読み(投げなければ必ずこれ)
 */
export function refusalOrThrow(where: string, error: PostgrestErrorLike, invariantOfMessage: InvariantResolver, status?: number): HandwrittenRefusalRead {
  // 分類は `toOutcome` と同じ部品の同じ順(業務の拒否 → 不変条件 → 通信の失敗 / 想定外の失敗)。
  const classified = classifyDbFailure({ sqlstate: error.code, message: error.message, detail: error.details, hint: error.hint }, invariantOfMessage);
  if (classified === undefined) throw new DbInfrastructureError(where, error.code === '' ? transportFailed(error) : unknownFailure(error, status));
  if (classified.kind === 'invariant_violated') return { refused: { kind: 'invariant_violated', invariant: classified.invariant }, reason: 'invariant_violated', error };
  return { refused: { kind: 'conflict' }, reason: classified.kind, error };
}

/**
 * 手書きのリポジトリが PostgREST の失敗を投げるときの**唯一の作り方**(点検 19 回目 B19-1)。
 *
 * 素の `Error` に `error.message` を詰めると、SQLSTATE とコミットの状態が消え、DB の文言が例外の文言に載る。ここは実行計画の口と
 * 同じ分類(`code` が空 = 通信の失敗、それ以外 = 想定外の失敗。SQLSTATE を欄に残す)で `DbInfrastructureError` を作る。DB の文言は
 * `cause` にだけ入る。手書きの基盤の層の素の `Error` は lint(`layer/no-bare-db-error`)が止める。
 *
 * @param where - どの呼び出しか(RPC の名前・表の名前と読み方。メッセージに載せる)
 * @param error - PostgREST が返したエラー
 * @returns 投げるエラー
 */
export function dbFailure(where: string, error: PostgrestErrorLike): DbInfrastructureError {
  return new DbInfrastructureError(where, error.code === '' ? transportFailed(error) : unknownFailure(error));
}
