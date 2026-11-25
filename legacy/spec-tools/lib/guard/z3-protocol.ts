/**
 * Z3 のセッションを持つ worker と親(`z3-host.ts`)の間で交わす**メッセージの形**。
 *
 * 親は Z3 のハンドル(文脈・ソルバー・モデル)を一切持たない。渡るのは SMT-LIB の本文(文字列)と
 * 問いの番号だけで、返るのは判定の結果と、読み取った値(綴り)だけである。型だけのファイルなので、
 * worker 側も親側も `import type` で読む(実行時には消える)。
 */

/** 問いをどの文脈で解くか。`main` は起動後ずっと使い回す文脈、`scratch` は問いごとに捨てる文脈。 */
export type Z3Context = 'main' | 'scratch';

/** 親 → worker: 1 問を解く。 */
export interface CheckRequest {
  readonly type: 'check';
  /** 問いの番号(返事と突き合わせる)。 */
  readonly id: number;
  readonly context: Z3Context;
  /** `solver.set(key, value)` に渡す組(`timeout` など)。 */
  readonly params: readonly (readonly [string, number])[];
  /** `solver.fromString(...)` に順に渡す SMT-LIB。 */
  readonly sources: readonly string[];
  /** `sat` のときモデルの値を読んで返すか。 */
  readonly withModel: boolean;
  /** Z3 の割当の見積りがこの値(バイト)を超えていたら、返事で「再生が要る」と知らせる。 */
  readonly recycleAboveBytes: number;
}

export type WorkerRequest = CheckRequest;

/** worker → 親: 1 問の答え。`values` はモデルの (変数名, 値の綴り)。 */
export interface CheckReply {
  readonly type: 'reply';
  readonly id: number;
  /** Z3 の答えそのまま(`sat` / `unsat` / `unknown`)。 */
  readonly status: string;
  readonly values?: readonly (readonly [string, string])[];
  /** 問いの前の Z3 の割当の見積り(バイト)。 */
  readonly allocBytes: number;
  /** 見積りが閾値を超えていた(問いの間の静止点での入れ替えを親に頼む)。 */
  readonly recycle: boolean;
}

/** worker → 親: 1 問が例外で終わった(文面だけ。例外オブジェクトは渡さない)。 */
export interface CheckFailure {
  readonly type: 'failure';
  readonly id: number;
  readonly message: string;
  readonly allocBytes: number;
  readonly recycle: boolean;
  /**
   * WASM のモジュールが abort した(壊れている)。後続の問いをそのモジュールの上で動かさないよう、親は静止点を待たず、
   * 待っている問いを error で終えて直ちに worker を入れ替える。
   */
  readonly aborted: boolean;
}

/**
 * worker → 親: この問いの処理を**始めた**。worker は問いを 1 問ずつ順に解くので、後ろの問いは前の問いが
 * 終わるまで始まらない。親の期限(問いごとの host の期限)は「出した時刻」ではなく、この知らせを受けた時刻から数える。
 */
export interface CheckStarted {
  readonly type: 'started';
  readonly id: number;
}

export type WorkerResponse = CheckReply | CheckFailure | CheckStarted;
