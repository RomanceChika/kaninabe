import type { CommitOutcome } from '../operation/ports';
import type { InvariantResolver } from '../domain/bindings';
import { REFUSALS } from './refusal-codes';
import { RESEND_ALREADY_SAVED, isRefusalWord, type InvariantEdge } from '../domain/result';

/**
 * **DB が返した失敗の分類**(SQLSTATE → 業務の拒否・不変条件違反)。Postgres 固定の側の純粋な関数である。
 *
 * 仕様: docs/rules/decisions/common/ADR-0012-db-as-authority.md ④
 *       legacy/spec-tools/lib/sql/refusal-codes.ts(語の正。生成される plpgsql が使う)
 *
 * 生成される plpgsql は、業務の拒否を SQLSTATE(`UC403` / `UC412` / `UC409`)と本文の接頭辞
 * (`usecase_forbidden:{操作}` ほか)で返し、不変条件は制約違反(23xxx)の本文に制約名を載せて返す。
 * どの DB クライアントを通っても **SQLSTATE と本文は同じ**なので、この読み方は接続の方式
 * (HTTP の PostgREST・直結のドライバ)に依らない —— 接続の方式ごとの失敗の形をここの入力
 * ({@link DbFailure})に直すのは、各 adapter の仕事である。
 *
 * **ここが決めないこと。** 通信の失敗(DB に届いたかどうか)と、仕様に無い理由の失敗は、接続の方式に
 * よって証拠の取り方が違う(エラーの書式・コードの体系)ので adapter が決める。この関数は
 * 「DB が答えた業務の分類」だけを返し、当たらなければ `undefined` を返す。
 */

/** 業務の拒否の分類(`REFUSALS` の `kind`)。 */
export type RefusalKind = (typeof REFUSALS)[number]['kind'];

/**
 * 分類の入力。接続の方式を持たない、DB が返した失敗の最小の形。
 *
 * `sqlstate` は DB(またはクライアント)が返したエラーコードをそのまま入れる。SQLSTATE の形
 * (5 桁の英数大文字)でないコードも入りうる —— 分類は `REFUSALS` の `code` との一致だけで決まる。
 */
export interface DbFailure {
  /** エラーコード(SQLSTATE)。 */
  readonly sqlstate: string;
  /** エラーの本文(拒否の接頭辞と制約名が載る)。 */
  readonly message: string;
  /** 詳細(無ければ `null`)。 */
  readonly detail: string | null;
  /** ヒント(無ければ `null`)。 */
  readonly hint: string | null;
}

/** この関数が返す結末(業務の拒否 3 種と不変条件違反)。 */
export type ClassifiedFailure = Extract<CommitOutcome<never>, { readonly kind: RefusalKind | 'invariant_violated' }>;



/** SQLSTATE の形(5 桁の英数大文字)。接続の方式に固有のコード(英字の接頭辞つきなど)は含めない。 */
const SQLSTATE_SHAPE = /^[0-9A-Z]{5}$/u;

/**
 * その SQLSTATE が**拒否の分類**か。
 *
 * 定型 4 手順の古い口(集約ごとのリポジトリ)はこれを使う。本文が `by` とガードを守るようになると DB は
 * 理由を 3 つに分けて raise するが、その経路は engine が先に同じ判定をしているので、古い口にとっては
 * 3 つとも「判断時の前提が崩れた」である。結末の語彙を増やさず、分類を読み分けるのは実行計画の口だけにする。
 *
 * @param sqlstate - DB が返したエラーコード
 * @returns 拒否の分類。拒否でなければ `undefined`
 */
export function refusalKindOfSqlstate(sqlstate: string): RefusalKind | undefined {
  return REFUSALS.find((candidate) => candidate.code === sqlstate)?.kind;
}

/**
 * エラーコードが SQLSTATE の形なら、そのまま返す(違えば `null`)。
 *
 * `unknown_failure` の `sqlstate` に載せる値を決める。接続の方式に固有のコードは SQLSTATE ではないので
 * 載せない(`null`)。
 *
 * @param code - DB またはクライアントが返したエラーコード
 * @returns SQLSTATE の形ならその値・そうでなければ `null`
 */
export function sqlstateOrNull(code: string): string | null {
  return SQLSTATE_SHAPE.test(code) ? code : null;
}

/**
 * **DB が答えた想定外の失敗のうち、txn が戻ったと言い切れるもの**の閉じた表(点検 25 回目 O25-1)。
 *
 * 文の実行が誤りで終わると、その txn は全部戻る(PostgREST は 1 要求を 1 txn で実行し、誤りなら戻す。pg の自動コミットの 1 文も同じ。
 * コミット時評価の制約がコミットで落ちても、コミットは成立しない)。ただし誤りの応答が届いても「戻った」と言えない類がある ——
 * 接続の失敗(08)・資源の尽き(53)・取り消しと停止(57。コミットの最中に届きうる)・外部の失敗(58)・内部の失敗(XX)・
 * 完了したか分からない 40003。巻き戻りの確実な 40001 / 40P01 は adapter の RPC の口が上限つきでやり直し(`retryRollbacks`)、尽きたときは
 * adapter が書けていない(`not_committed`)と読む(DB が取引を中止した。HTTP の状態に依らないので、この表ではなく adapter の読みが持つ。
 * 点検 27 回目の決め)。表に載せるのは**文の失敗の類**だけである:
 *
 * | 表 | 何の失敗か |
 * |---|---|
 * | class `22` | 値の誤り(範囲の外の数・形の違う値) |
 * | class `23` | 制約の違反(CHECK・一意・外部キー・NOT NULL・排他) |
 * | class `42` | 文の誤り・権限の不足(関数が無い・実行権が無い) |
 * | `P0001` | plpgsql の `raise exception` の既定(仕様の語を持たない手書きの拒否) |
 * | `UC403` / `UC412` / `UC409` | 業務の拒否(`REFUSALS` の errcode。`raise exception` なので txn ごと戻る。点検 27 回目 B27-1) |
 *
 * 業務の拒否は、ふつうは `classifyDbFailure` が先に拒否として読むのでここへ来ない。来るのは拒否として読まない呼び手(読みの口の
 * `dbFailure` ほか)だけで、そのときも「書けたか分からない」とは言わない(B27-1: 確実に戻った拒否がコミット unknown になっていた)。
 *
 * 表の外(`P0002` ほかの plpgsql の実行時の失敗を含む)と SQLSTATE の形でないコードは `unknown`。
 */
const ROLLED_BACK_CLASSES: readonly string[] = ['22', '23', '42'];

/** 表の個別の SQLSTATE(class を丸ごと載せない分)。業務の拒否の errcode は `REFUSALS` から取る(写しを持たない)。 */
const ROLLED_BACK_CODES: readonly string[] = ['P0001', ...REFUSALS.map((refusal) => refusal.code)];

/**
 * DB が答えた想定外の失敗の、コミットの状態(閉じた表に当たれば `not_committed`、それ以外は `unknown`)。
 *
 * 接続の方式に固有の証拠(HTTP の状態など)を重ねて見るのは adapter の仕事で、ここは SQLSTATE だけで言える分を返す。
 *
 * @param sqlstate - DB が返したエラーコード
 * @returns コミットの状態
 */
export function commitOfDbError(sqlstate: string): 'not_committed' | 'unknown' {
  if (!SQLSTATE_SHAPE.test(sqlstate)) return 'unknown';
  return ROLLED_BACK_CODES.includes(sqlstate) || ROLLED_BACK_CLASSES.includes(sqlstate.slice(0, 2)) ? 'not_committed' : 'unknown';
}

/** 拒否のメッセージから、落ちた操作の ID を取り出す(読めなければ空文字)。 */
function refusedOpOf(failure: DbFailure, prefix: string): string {
  const haystack = [failure.message, failure.detail ?? '', failure.hint ?? ''].join(' ');
  const index = haystack.indexOf(prefix);
  if (index < 0) return '';
  const rest = haystack.slice(index + prefix.length);
  const end = rest.search(/\s/);
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * DB が返した失敗を、業務の拒否か不変条件違反に分類する。
 *
 * 順序は固定である: ①`REFUSALS` の SQLSTATE に当たれば業務の拒否(落ちた操作の ID つき)
 * ②本文が制約名に引ければ不変条件違反 ③どちらでもなければ `undefined`(通信の失敗か想定外の失敗。
 * adapter が決める)。
 *
 * @param failure - DB が返した失敗
 * @param invariantOfMessage - DB の不整合のメッセージ → 不変条件 ID(製品が渡す)
 * @returns 業務の拒否・不変条件違反。分類できなければ `undefined`
 */
export function classifyDbFailure(failure: DbFailure, invariantOfMessage: InvariantResolver): ClassifiedFailure | undefined {
  const refusal = REFUSALS.find((candidate) => candidate.code === failure.sqlstate);
  if (refusal !== undefined) {
    const op = refusedOpOf(failure, refusal.prefix);
    // ガードの拒否は detail に**拒否の語**(仕様の宣言の閉じた語。例: refuse_erased の word)を載せうる。競合は同じ鍵の押し直しの語
    // (resend_already_saved)だけを運ぶ(別の鍵の本当の競合は語を持たない)。語の形のときだけ運ぶ(文や接頭辞つきの本文は運ばない)。
    const word =
      failure.detail !== null && ((refusal.kind === 'guard_unsatisfied' && isRefusalWord(failure.detail)) || (refusal.kind === 'conflict' && failure.detail === RESEND_ALREADY_SAVED))
        ? failure.detail
        : undefined;
    return word === undefined ? { kind: refusal.kind, op } : { kind: refusal.kind, op, word };
  }
  const invariant = invariantOfMessage([failure.message, failure.detail ?? '', failure.hint ?? ''].join(' '));
  if (invariant === undefined) return undefined;
  const edge = edgeOf(failure.detail, invariant);
  return edge === undefined ? { kind: 'invariant_violated', invariant } : { kind: 'invariant_violated', invariant, edge };
}

/** 相手の端の制約トリガが detail に載せる形(`{トリガ名}: {不変条件 ID}: {件数}`)。 */
const EDGE_DETAIL = /^([a-z_][a-z0-9_]*): (INV-[A-Z0-9-]+): (\d{1,9})$/u;

/**
 * 相手の端の断りの detail から、断った端と件数を引く(その形で、引いた不変条件 ID と一致するときだけ。DB の自由な文言は運ばない)。
 *
 * @param detail - DB の detail
 * @param invariant - 本文から引いた不変条件 ID
 * @returns 断った端と件数(形でなければ undefined)
 */
function edgeOf(detail: string | null, invariant: string): InvariantEdge | undefined {
  const found = detail === null ? null : EDGE_DETAIL.exec(detail);
  if (found === null || found[2] !== invariant) return undefined;
  return { trigger: String(found[1]), count: Number(found[3]) };
}
