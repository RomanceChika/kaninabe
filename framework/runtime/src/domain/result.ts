/**
 * Server Action の戻り値の型。
 *
 * 正は ARCH-BE-0013（エラー3分類の契約）と
 * process/backend/system/standards/conventions/server-actions.md（型の形）。
 * **全アクションでこの1組を共用する**（PRIN-0007）。ドメイン上の拒否は throw せず、
 * ここに定義した `ActionError` として返す。
 */

import type { z } from 'zod';

/** 成功値 `T` か、失敗理由 `E` のどちらか。 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/**
 * 実装（境界・operation）が出してよい指摘のコード。**この 2 語で全部である。**
 *
 * zod の語彙に無い状況——**入力の形が、フィールド単位では言えない**もの——だけがここに来る。
 * 語はいずれも**集約に依存しない**（`multiple_{集約}s` のように集約固有の語を含む名前を置かない）。
 * どこの話かは `FieldIssue.field` が示すので、コードは「何が壊れているか」だけを言えばよく、
 * 集約の語を混ぜると**このユニオンが集約の数だけ伸びる**（＝語彙の正がまた無くなる）。
 *
 * - `empty` … 送られた集合が空（変更が 1 つも無い更新、対象が 1 件も無い一括指定）
 * - `inconsistent` … 集合としてまとまりを持たない（別々の親にまたがる指定、両立しない値の組）
 */
type OperationIssueCode = 'empty' | 'inconsistent';

/**
 * `FieldIssue` の `code` に入りうる値の**値域**。
 *
 * 出典は 2 つしかない。**zod が出すコード**（生成スキーマ由来。型は zod からそのまま借り、
 * 写し取らない）と、**この実装が出すコード**（`OperationIssueCode`）である。
 * ユニオンにすることで、思いつきの文字列は tsc が落とす（PRIN-0008 の執行）。
 *
 * 仕様（`entity_spec` / `action_spec`）側に語彙を持たせて生成する案は**採らない**。
 * 実装発のコードは現状 2 語で、どちらも「入力の形」の話であり、仕様に書くべき業務の語ではない
 * （業務の語は `event` / `invariant` / `role` の側に、仕様のIDとして既に現れている）。
 * 語が増えて**どの矛盾かを画面で区別する**必要が出たら、そのとき仕様側に移すことを検討する。
 */
export type FieldIssueCode = z.core.$ZodIssueCode | OperationIssueCode;

/** 入力そのものの不正。生成 zod スキーマ由来のフィールド単位の指摘。 */
export interface FieldIssue {
  /** 対象フィールド名（`entity_spec` のフィールド名）。 */
  readonly field: string;
  /** 指摘のコード（値域）。表示文言はUIの責務であり、ここには入れない。 */
  readonly code: FieldIssueCode;
}

/** 不変条件の違反を断った相手の端(トリガ名)と、決まりに合わない行の数。 */
export interface InvariantEdge {
  readonly trigger: string;
  readonly count: number;
}

/**
 * ドメイン上の拒否 3 分類 + 入力検証 + 一時的な失敗(画面の実行器が例外から作る)。分類の意味は ARCH-BE-0013 を正とする。
 *
 * `event` はドメインイベントID（`{集約}.{操作}`）、`invariant` は不変条件ID（`INV-{集約}-001`）、
 * `role` は実行者に解決されたロールID。**いずれも仕様に実在するID**であり、
 * 実装が発明した文字列を入れてはならない（PRIN-0008）。
 */
export type ActionError =
  | { readonly kind: 'invalid_input'; readonly issues: readonly FieldIssue[] }
  | {
      readonly kind: 'guard_unsatisfied';
      readonly event: string;
      readonly blockedBy: 'state' | 'guard';
      readonly reason: string;
      /**
       * **時刻で解ける制限に掛かった拒否**の印(回数・間隔の制限。点検 17 回目)。DB が制限で断り、次に通る見込みの時刻(ISO 8601)を
       * 返したときだけ付く。画面はこれを見て「次に送れるのは〇時ごろ」と言える。どの制限かは `reason` が製品の閉じた表の語で言う。
       * それ以外の拒否には付かない(分類は増やさない)。
       */
      readonly retryAt?: string;
    }
  | {
      readonly kind: 'forbidden';
      readonly event: string;
      readonly role: string;
      /**
       * **多要素認証の要求に掛かった拒否**の印(auth-spec-writing.md §mfa)。要求するロールの実行者が、多要素認証を
       * 済ませていないセッションで書き込もうとしたときだけ `true` が付く。画面はこれを見て、画面の関門と同じ送り先
       * (要素の登録・確認の画面)へ送れる。それ以外の拒否には付かない。
       */
      readonly mfaRequired?: true;
    }
  | {
      readonly kind: 'invariant_violated';
      readonly invariant: string;
      /**
       * 断った**相手の端**と、この決まりに合わない行の数(参照の欄が指す行を読む条件の相手の端の制約トリガが detail で運ぶ形
       * `{トリガ名}: {不変条件 ID}: {件数}` だけ。行の中身や id は運ばない)。画面は宣言から生成した文言に件数を挟む。
       */
      readonly edge?: InvariantEdge;
    }
  /**
   * **一時的に失敗した**(点検 19 回目 B19-1)。業務の拒否ではない: 通信の失敗・想定外の DB の失敗・巻き戻りが確実な失敗のやり直しが
   * 尽きた、のどれかである。例外の文言(DB の文言を含みうる)は運ばない。
   *
   * `commit` は**書けたかどうか**(点検 20 回目 B20-1)。生成した Server Action は、コミットの状態が分かる DB の失敗(`DbInfrastructureError`)を
   * 例外の境界の手前で受けてこの種類の値で返す(例外のまま投げると Next は digest しか返さず、状態が画面に届かない)。
   * `not_committed` = 届く前に落ちたと証明できた(押し直してよい)・`unknown` = 書けたか分からない(画面の実行器が Action の例外を
   * 受けたときもこれ)。分からないときの押し直しを安全にするのは、操作の種類ごとに次のものである —— 作成は**意図ごとの冪等キー**
   * (`ActionIntent`。画面の実行器が 1 回の送信の意図に 1 つ作り、押し直しでは同じ鍵を送る。2 回目は 1 回目の行を返し、行は増えない)、
   * 遷移は判断時の状態の条件(2 回目は状態の食い違いの拒否)、編集は同じ値の書き直し、削除は 2 回目の拒否。
   */
  | { readonly kind: 'temporarily_unavailable'; readonly commit?: 'not_committed' | 'unknown' };

/**
 * **1 回の送信の意図**(点検 20 回目 B20-1)。画面の実行器が意図ごとに 1 つ作り、押し直し(同じ意図の再送)では同じ値を Server Action の
 * 第 2 引数で送る。成功したら次の意図のために作り直す。作成の冪等キー(`p_id`)はこの値になる(実行器が呼び出しごとに作り直さない)。
 */
export interface ActionIntent {
  /** 冪等キー(UUID)。 */
  readonly idempotencyKey: string;
}

/** すべての Server Action の戻り値。 */
export type ActionResult<T> = Result<T, ActionError>;

/**
 * 読み取り（クエリ関数）で起こりうる失敗。
 *
 * 正は ARCH-BE-0016（読み取り経路）と
 * process/backend/system/standards/conventions/queries.md（戻り値の型）。
 * 可視性による拒否は**エラーではなく 0 件**として返る（執行するのは RLS であり、
 * アプリ側は落ちた結果を受け取るだけ）。したがってドメイン上の拒否 3 分類は現れない。
 * 残る 1 つは `ActionError` の `invalid_input` と同じものなので、書き写さず抜き出す
 * （同じ分類の定義を 2 か所に置かない。PRIN-0007）。
 */
export type QueryError = Extract<ActionError, { kind: 'invalid_input' }>;

/** すべてのクエリ関数の戻り値。 */
export type QueryResult<T> = Result<T, QueryError>;

/**
 * 成功の `Result` を作る。
 *
 * @param value - 後続の表示に必要な最小限の値
 * @returns 成功を表す `Result`
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * 失敗の `Result` を作る。
 *
 * @param error - 仕様に書かれた拒否の分類
 * @returns 失敗を表す `Result`
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** 拒否の語の形(スネークケース。仕様の宣言の語と同じ形)。 */
const REFUSAL_WORD = /^[a-z][a-z0-9_]*$/u;

/**
 * `guard_unsatisfied` の理由が**拒否の語の形**か(DB が detail に載せ、`classifyDbFailure` が `reason` に運ぶ形。語の形の判定はここが持つ)。
 * 画面は語の形の理由を生のまま出さない —— 文言の閉じた表に無い語は汎用の文言に倒す(点検 20 回目 O20-1。語は ID で、U11 の「ID を出さない」の内側)。
 *
 * @param reason - `guard_unsatisfied` の `reason`
 * @returns 語の形なら true
 */
export function isRefusalWord(reason: string): boolean {
  return REFUSAL_WORD.test(reason);
}

/**
 * **仕組みが決める拒否の語**の画面の文言(閉じた表。語は生成した作成 RPC が detail に載せる。表の本体はここ 1 か所 —— 製品の文言の
 * 部品 `refusalWordText` と、生成の一致の証明の送り直しの性質 `testing/equivalence/resend.mts` が同じこの表を引く)。
 *
 * - `resend_input_mismatch`(UC412): 同じ送信の意図(冪等キー)で内容の違う作成が届いた(点検 20 回目 B20-1)。1 回目は書けている。
 * - `resend_expired`(UC412): 保存点(複合の作成)の押し直しが、1 回目の入力の要約を残す時間(`retention_hours`)を過ぎて届いた
 *   (点検 21 回目 A21-1)。1 回目は書けているが、鍵はもう使えない(新しい作成として受けると同じ鍵の行とぶつかり、黙って別の行を
 *   作ることもしない)。画面を読み込み直すと新しい鍵になる。
 * - `resend_target_deleted`(UC412): 保存点の 1 回目が作った錨の行が**消された後**に、同じ鍵の押し直しが届いた(点検 22 回目の後 11-07)。
 *   「既に保存されています(一覧で確かめて)」は一覧に行が無いので誤りになる。作ったものは消えているので作り直しを案内する
 *   (読み込み直すと新しい鍵になる)。
 * - `append_full`(UC412): 親の下の末尾に足す番号が、列の範囲の上端を越える(点検 25 回目 B25-1。生成した番号のトリガが上げる)。
 *   並べ替えで最後の番号を上端にしたか、件数が上端に届いた。何も書いていないので、並び順の番号を詰めてから足し直す。
 * - `resend_already_saved`(UC409): 再送で既存の行を返さない表(`resend.returns_existing: false`)に、**同じ鍵**の押し直しが届いた。
 *   1 回目は書けているので「既に保存されている」の種類の文言にする(入力の誤り・失敗と読ませない)。別の鍵の本当の競合はこの語を
 *   載せず、従来の文言のまま。
 */
/** 同じ鍵の押し直しの拒否の語(UC409 の detail。競合が運ぶ語はこれだけ。生成器の `sql/rpc-resend.ts` の RESEND_ALREADY_SAVED と同じ字面)。 */
export const RESEND_ALREADY_SAVED = 'resend_already_saved';

export const FRAMEWORK_REFUSAL_TEXT: Readonly<Record<string, string>> = {
  resend_input_mismatch:
    '前回の送信はすでに受け付けられていますが、今回は内容が違うため登録していません。画面を読み込み直して、登録された内容を確かめてください。',
  resend_already_saved: '既に保存されています(一覧で確かめてください)。前回の送信が受け付けられているので、もう一度押す必要はありません。',
  resend_expired:
    '前回の送信から時間が経ったため、この送信は受け付けられません。画面を読み込み直して、登録された内容を確かめてから操作し直してください。',
  resend_target_deleted: '前回の送信で作られた内容は、その後削除されています。画面を読み込み直してから、もう一度作成してください。',
  append_full: 'これ以上追加できません。並び順の番号が上限に達しています。並び順を見直して(大きな番号を詰めて)から、もう一度追加してください。',
};

/**
 * 仕組みが決める拒否の語の文言(表に無ければ undefined)。
 *
 * @param word - 拒否の語
 * @returns 文言
 */
export function frameworkRefusalText(word: string): string | undefined {
  return Object.hasOwn(FRAMEWORK_REFUSAL_TEXT, word) ? FRAMEWORK_REFUSAL_TEXT[word] : undefined;
}
