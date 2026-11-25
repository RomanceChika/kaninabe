import type { RunParam } from '@kaninabe/runtime/plan';
import type { CommitOutcome, DbPorts, Json, RpcCallOptions, RpcReturn, UsecaseCallArgs } from '@kaninabe/runtime/ports';

/**
 * 契約テスト(`contract/*`)の型。**アプリの語彙は 1 語も持たない** —— RPC 名・欄の名前・ID は
 * 製品が `ContractWorld` として渡し、ここは「どんな状況を起こし、何を観測し、何と比べるか」だけを決める。
 *
 * ## 構え
 *
 * 試験の束は adapter の数だけ繰り返す。adapter を **ドライバ**(`ContractDriver`)に包み、同じ束を全ドライバに当てる:
 *
 * - **手元(ユニット)**: ドライバが偽の通信路を差す(PostgREST = 記録する `fetch`・pg = 記録する偽のクライアントと、
 *   作ったエラー)。状況は `scripted.mts` が通信路の振る舞いに直す。
 * - **実 DB(統合)**: ドライバが実物の通信路を差す。状況は、世界(`ContractWorld`)が実 DB で起こせる呼び出しに
 *   直す(例: 権限の無い実行者での作成 → 拒否)。接続の失敗だけは閉じたポート・切断するサーバーで起こす。
 *
 * 試験の本体(`groups.mts`)はどちらでも同じコードで、**期待は中立の結果(`NeutralOutcome`)**で書く。
 */

/**
 * 起こす状況。
 *
 * | 状況 | 起こること |
 * |---|---|
 * | `rows` | 書けて、行の列が返る |
 * | `document` | 書けて、jsonb が 1 つ返る(複合 RPC) |
 * | `zero_rows` | エラー無しで 0 行(条件に当たらなかった) |
 * | `forbidden` / `guard_unsatisfied` / `conflict` | DB が業務の拒否で断る |
 * | `invariant_violated` | 制約違反(制約名が不変条件に引ける) |
 * | `unexpected` | 仕様に無い理由で DB が断る |
 * | `refused` | 接続の前に落ちる(接続拒否) |
 * | `dropped` | 送ったあとに切られる |
 * | `timed_out` | 応答が来ないまま時間切れになる |
 * | `mixed_transport` | 独立した試みが接続拒否と切断に分かれる(送れたかもしれない = `unknown`)。実 DB では起こせない |
 */
export type Situation =
  | 'rows'
  | 'document'
  | 'zero_rows'
  | 'forbidden'
  | 'guard_unsatisfied'
  | 'conflict'
  | 'invariant_violated'
  | 'unexpected'
  | 'refused'
  | 'dropped'
  | 'timed_out'
  | 'mixed_transport';

/** どの口を通すか(`rpc` = 定型 RPC の口 / `usecase` = 保存点の複合 RPC の口)。 */
export type PortName = 'rpc' | 'usecase';

/** 定型 RPC の口への呼び出し。 */
export interface RpcCallSpec {
  readonly port: 'rpc';
  readonly rpc: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly options?: RpcCallOptions;
}

/** 保存点の複合 RPC の口への呼び出し。 */
export interface UsecaseCallSpec {
  readonly port: 'usecase';
  readonly rpc: string;
  readonly args: UsecaseCallArgs;
}

/** 状況を起こす呼び出し。 */
export type Call = RpcCallSpec | UsecaseCallSpec;

/**
 * 結果から実装の差(元の失敗・戻り値の中身)を除いた、**契約が約束する部分**。
 *
 * adapter が違っても同じになるべきものだけを持つ。`cause`(元のエラー)・メッセージ・HTTP の状態は入れない。
 */
export type NeutralOutcome =
  | { readonly kind: 'saved'; readonly shape: RpcReturn['shape']; readonly requestedEffects: readonly string[] | null; readonly outbox: 'committed_by_this_call' | 'unknown' }
  | { readonly kind: 'conflict' | 'forbidden' | 'guard_unsatisfied'; readonly op: string }
  | { readonly kind: 'invariant_violated'; readonly invariant: string }
  | { readonly kind: 'transport_failed'; readonly commit: 'not_committed' | 'unknown' }
  | { readonly kind: 'unknown_failure'; readonly commit: 'not_committed' | 'unknown'; readonly sqlstate: string | null };

/** 状況を起こす呼び出しと、その結果として約束される中立の結果。 */
export interface Scenario {
  readonly call: Call;
  readonly expected: NeutralOutcome;
}

/**
 * 通信路に出た要求 1 回(adapter が運んだもの)。
 *
 * `args` は **DB に届いた名前付き引数**を JSON にしたもの(PostgREST なら本文の鍵、pg ならパラメータ)。
 * 渡さなかった引数は**鍵ごと無い**(`null` ではない)。
 */
export interface Sent {
  readonly rpc: string;
  readonly args: Readonly<Record<string, Json>>;
}

/** 1 つの状況のために開いた口の束と、その通信路の観測。 */
export interface Channel {
  /** adapter が組んだ DB への口。 */
  readonly ports: DbPorts;
  /** 通信路に出た要求を、出た順に返す(試行の回数と、運んだ引数の観測)。 */
  sent(): readonly Sent[];
}

/** adapter 1 つを契約テストに当てるための包み。 */
export interface ContractDriver {
  /** 報告に出す名前。 */
  readonly name: string;
  /**
   * 状況のために口の束を開く(状況ごとに新しい束・新しい観測)。
   *
   * @param situation - 起こす状況
   * @param scenario - その状況の呼び出しと期待(偽の通信路を差すドライバが、振る舞いを決めるのに使う)
   * @returns 口の束と観測
   */
  open(situation: Situation, scenario: Scenario): Promise<Channel>;
  /** 開いたものを閉じる(接続・待ち受けなど)。 */
  close(): Promise<void>;
}

/**
 * 3 値の運び方を確かめる 1 回の呼び出し(実行計画の `call.params` と入力から、実行器と同じ道で引数を組む)。
 *
 * 入力の `undefined` は「送られていない」・`null` は「空で送られた」・それ以外は値である。
 */
export interface EncodingProbe {
  /** 報告に出す名前。 */
  readonly label: string;
  /** 呼ぶ RPC。 */
  readonly rpc: string;
  /** 実行計画の引数の並び(`call.params`)。 */
  readonly params: readonly RunParam[];
  /** 入力(平たい)。 */
  readonly input: Readonly<Record<string, unknown>>;
  readonly actorId: string | null;
  readonly actorRoles: readonly string[];
  readonly idempotencyKey: string;
  readonly writeEffects: readonly string[];
}

/** 製品が渡す世界(RPC 名・欄・ID は全部ここにある)。 */
export interface ContractWorld {
  /** 3 値の確認に使う呼び出し(作成の `record` と編集の `patch` を含むこと)。 */
  readonly probes: readonly EncodingProbe[];
  /**
   * 状況を起こす呼び出しと期待。呼ぶたびに新しい値で組む(実 DB で同じ名前・同じ ID を使い回さないため)。
   *
   * @param situation - 起こす状況
   * @param port - 通す口
   * @returns 呼び出しと期待。この世界が起こせない状況・口の組なら `null`(その組は試験から外れる)
   */
  scenario(situation: Situation, port: PortName): Scenario | null;
  /** 制約違反の本文に載せる、不変条件に引ける制約名を含む文(偽の通信路で `invariant_violated` を作るのに使う)。 */
  readonly invariantMessage: string;
}

/** 結果 1 つを中立の形に直したもの(群の中で比べる)。 */
export type OutcomeOf = CommitOutcome<RpcReturn>;
