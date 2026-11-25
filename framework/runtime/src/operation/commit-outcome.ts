/**
 * **保存の結果の契約**(`CommitOutcome`)と、通信・想定外の失敗を運ぶ型つきの内部エラー。
 *
 * 公開の入口は `./ports.ts`(`@kaninabe/runtime/ports`)で、ここはその一部を別ファイルに置いているだけである
 * (ポートの宣言と、結果の契約は責務が違うので別のファイルに置く)。
 *
 * ## 結果は 4 種類に分かれる
 *
 * | 種類 | 値 | 何が起きたか | 呼び出し側の扱い |
 * |---|---|---|---|
 * | 書けた | `saved` | 1 トランザクションが成立した | 受領(`receipt`)を読む |
 * | 業務の拒否 | `conflict` / `forbidden` / `guard_unsatisfied` / `invariant_violated` | DB が仕様どおりに断った。全部戻っている | `ActionError` の 3 分類へ写す |
 * | 通信の失敗 | `transport_failed` | DB に届いたか分からない(または届いていない) | **throw**(`DbInfrastructureError`) |
 * | 想定外の失敗 | `unknown_failure` | DB が仕様に無い理由で落ちた(txn ごと戻る類と証明できれば `not_committed`) | **throw**(`DbInfrastructureError`) |
 *
 * 後ろの 2 つは `ActionResult` に現れない。想定外の失敗は握りつぶさず投げる(ARCH-BE-0013)。**投げた先で受けるのはエラー境界ではない**
 * (点検 19 回目 B19-1 で実測): Server Action はクリックの処理から呼ばれ、その Promise の拒否は描画の外なので境界に届かない
 * (しかも製品は非根の `error.tsx` を S12 で持たない)。受けるのは次の 2 つである。
 *   - 生成した Server Action: 投げ直す前に、一時的な失敗(`temporarily_unavailable`)として 1 行記録する(`refusal-log-entry.ts` の生成)
 *   - 画面の実行器(`runAction`): 例外を受けて `pending` から戻し、固定の種類 `temporarily_unavailable` を画面に出す(例外の文言は運ばない)
 * 外から見た Server Action の挙動(投げる)は、この契約を入れる前と同じである。
 * **コミットの状態を失わない**: 例外が `commit` を持つので、「落ちたが書けているかもしれない」呼び出しを再試行してよいかを、
 * 握りつぶさずに判断できる。巻き戻りが確実な失敗(SQLSTATE `40001` / `40P01`)は、ここへ来る前に adapter が上限つきでやり直す
 * (`@kaninabe/adapter-postgrest` の `retryRollbacks`)。手書きのリポジトリも同じ型で投げる(`dbFailure`。素の `Error` は lint が止める)。
 *
 * ## 受領は「要求した効果」と「outbox は不明」
 *
 * `receipt` が言うのは**この呼び出しが何を要求したか**であって、**何を積んだか**ではない。
 * 発火の実体は RPC 内の outbox 挿入だが、いまの SQL の戻り値に job id は無く、再送(同じキーで
 * 読み直しただけで何も積んでいない)と初回(積んだ)を戻り値から区別できない。だから
 * `outbox` は**常に `unknown`** であり、引数から「積んだ」を作らない。`committed_by_this_call` は、
 * DB が同じコミットから受領を返す契約を別の束で作った日のために型に残してある(いまは誰も作らない)。
 */

import type { RpcReturn } from './wire-types';
import type { InvariantEdge } from '../domain/result';

/** 受領。**書けたことと、その呼び出しが何を要求したか**を言う(積んだことは言わない)。 */
export interface CommitReceipt<R> {
  /** RPC が返した値。 */
  readonly returned: R;
  /**
   * この呼び出しが**要求した**副作用の ID(RPC の引数に載せたものの写し)。
   *
   * - 配列: 要求を追っている呼び出し(単発の定型 RPC)。要求の写しであり、積んだことの証明ではない。
   *   空の配列は「効果を要求しなかった」である。
   * - `null`: **この呼び出しは要求した効果を追っていない**(効果が SQL の本体の中にあり、引数に載らない
   *   複合 RPC)。空の配列と区別する —— 空は「積まなかった」と読めてしまうが、`null` は「分からない」である。
   */
  readonly requestedEffects: readonly string[] | null;
  /**
   * outbox に**この呼び出しが**積んだか。
   *
   * 今の SQL では判別できないので `unknown` 固定で作る。同じキーの再送で既存の結果を読み直しただけの
   * 呼び出しも、初回と同じ `unknown` になる(「積んだ」と「積んでいない」を戻り値から区別できない)。
   */
  readonly outbox: 'committed_by_this_call' | 'unknown';
}

/**
 * 通信の失敗(DB に届いたか分からない、または届く前に落ちた)。
 *
 * `not_committed` は**接続の前に落ちたと adapter が証明できる**ときだけ(接続拒否・名前解決の失敗・
 * プールの取得のタイムアウト)。それ以外は `unknown` —— リクエストを送ったあとの切断・タイムアウトは、
 * DB が実行を終えたあとかもしれない。
 */
export interface TransportFailed {
  readonly kind: 'transport_failed';
  readonly commit: 'not_committed' | 'unknown';
  /** 元の失敗(PostgREST のメッセージ等はここにだけ入る。契約の欄には出さない)。 */
  readonly cause?: unknown;
}

/**
 * 想定外の失敗(DB が仕様に無い理由で落ちた)。
 *
 * コミットの状態は既定で `unknown`。`not_committed` と言うのは、**DB が組み立てた誤りの応答が届き、その誤りが txn ごと戻る類**だと
 * adapter が証明できるときだけである(点検 25 回目 O25-1。SQLSTATE の閉じた表は `@kaninabe/runtime/refusal` の `commitOfDbError`、
 * PostgREST はさらに HTTP の状態が 4xx であること)。通信の切断・接続や停止の類の誤りは、応答の途中で落ちたのか実行の前に
 * 落ちたのかを戻り値から証明できないので `unknown` のまま。決まって戻る失敗を「書けたかもしれない」と言うと、利用者に
 * 押し直しを促し、画面は読み直しを起こす(B25-1 で、範囲の拒否が「書けたか分からない」の文言になった)。
 */
export interface UnknownFailure {
  readonly kind: 'unknown_failure';
  readonly commit: 'not_committed' | 'unknown';
  /** DB が返した SQLSTATE(5 桁)。読めなければ `null`。 */
  readonly sqlstate: string | null;
  /** 元の失敗(PostgREST のメッセージ等はここにだけ入る。契約の欄には出さない)。 */
  readonly cause?: unknown;
}

/**
 * 保存 1 回の結果。
 *
 * 業務の拒否は `op`(落ちた操作の ID。DB が返さなければ空文字)か `invariant` を載せ、
 * メッセージ・詳細・ヒント・HTTP の状態は契約に出さない。
 */
export type CommitOutcome<R> =
  | { readonly kind: 'saved'; readonly receipt: CommitReceipt<R> }
  | {
      readonly kind: 'conflict' | 'forbidden' | 'guard_unsatisfied';
      readonly op: string;
      /** 拒否の語(DB の detail。仕様の宣言の閉じた語。例: refuse_erased の word・同じ鍵の押し直しの resend_already_saved)。運ぶのは `guard_unsatisfied` と `conflict` だけ。 */
      readonly word?: string;
    }
  | { readonly kind: 'invariant_violated'; readonly invariant: string; readonly edge?: InvariantEdge }
  | TransportFailed
  | UnknownFailure;

/** 実行器が `ActionResult` に写してよい結果(通信の失敗と想定外の失敗を除いたもの)。 */
export type SettledOutcome<R> = Exclude<CommitOutcome<R>, TransportFailed | UnknownFailure>;

/**
 * DB への口が返す結果(`UsecaseRepository` / `RpcCaller` の戻り値)。
 *
 * かつての `UsecaseCallOutcome`(`result: unknown`)の後継。古い名は 1 束だけ別名で残す。
 */
export type UsecaseCallOutcome = CommitOutcome<RpcReturn>;

/**
 * 通信の失敗・想定外の失敗を運ぶ**型つきの内部エラー**。
 *
 * `ActionError` ではない(業務の拒否ではなく、`ActionResult` に現れない)。Server Action の外から見た
 * 挙動は、素の `Error` を投げていたころと同じである —— 違うのは、**どの種類の失敗で、コミットが
 * どういう状態か**が欄に残ることだけ。メッセージに DB の文言は載せない(`cause` に入る)。
 */
export class DbInfrastructureError extends Error {
  /**
   * どの呼び出しか(RPC の名前・表の名前と読み方)。メッセージの頭と同じ語。
   *
   * テストと記録は**この欄と `sqlstate` で失敗を見分ける**(メッセージの字面は合わせない。点検 19 回目の統合の赤 12 件:
   * 字面を合わせたテストは、文言の形を変えただけで「どの失敗か」と無関係に赤になり、逆に通信の失敗でも RLS の拒否でも同じ字面で緑になる)。
   */
  readonly where: string;
  /** 失敗の種類。 */
  readonly kind: 'transport_failed' | 'unknown_failure';
  /** コミットの状態。`not_committed` は adapter が届く前に落ちたと証明できたときだけ。 */
  readonly commit: 'not_committed' | 'unknown';
  /** DB が返した SQLSTATE。通信の失敗や読めなかったときは `null`。 */
  readonly sqlstate: string | null;

  /**
   * 失敗の結果からエラーを作る(メッセージに DB の文言は載せない)。
   *
   * @param where - どの呼び出しか(RPC の名前や受信口の連携 ID。メッセージに載せる)
   * @param failure - 結果のうち通信の失敗か想定外の失敗
   */
  constructor(where: string, failure: TransportFailed | UnknownFailure) {
    const sqlstate = failure.kind === 'unknown_failure' ? failure.sqlstate : null;
    super(
      `${where} に失敗しました(${failure.kind}。コミット: ${failure.commit}${sqlstate === null ? '' : `。SQLSTATE: ${sqlstate}`})`,
      { cause: failure.cause },
    );
    this.name = 'DbInfrastructureError';
    this.where = where;
    this.kind = failure.kind;
    this.commit = failure.commit;
    this.sqlstate = sqlstate;
  }
}

/**
 * 結果を業務の結果に絞る(通信の失敗・想定外の失敗は `DbInfrastructureError` で投げる)。
 *
 * **投げる場所はここ 1 か所**である。実行器(単発・複合)と受信口が同じ関数を通るので、
 * 入口によって分類が変わらず、`ActionError` の種類も増えない。
 *
 * @param where - どの呼び出しか(エラーのメッセージに載せる)
 * @param outcome - DB への口が返した結果
 * @returns 書けた、または業務の拒否
 * @throws DbInfrastructureError 通信の失敗か想定外の失敗のとき
 */
export function settle<R>(where: string, outcome: CommitOutcome<R>): SettledOutcome<R> {
  if (outcome.kind === 'transport_failed' || outcome.kind === 'unknown_failure') {
    throw new DbInfrastructureError(where, outcome);
  }
  return outcome;
}

/**
 * 書けた結果の受領を作る(**`outbox` は常に `unknown`**。引数から「積んだ」を作る口は無い)。
 *
 * @param value - RPC が返した値
 * @param requestedEffects - 呼び出しが要求した効果の ID。要求を追っていない呼び出しは `null`
 * @returns 受領
 */
export function receiptOf<R>(value: R, requestedEffects: readonly string[] | null): CommitReceipt<R> {
  return { returned: value, requestedEffects: requestedEffects === null ? null : [...requestedEffects], outbox: 'unknown' };
}
