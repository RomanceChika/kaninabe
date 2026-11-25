import type { PostgrestErrorLike } from './rpc-outcome';

/**
 * **巻き戻りが確実な DB の失敗(SQLSTATE の class 40 の 2 つ)を、上限つきで自動でやり直す唯一の RPC の口**(`retryRollbacks`。点検 19 回目 B19-1・
 * 27 回目の決め(掴む順の約束を守る場所を移す))。
 *
 * ## なぜ口が 1 本なのか
 *
 * 2 本の取引が逆の順で行を掴むと、DB は片方をデッドロック(`40P01`)で中止する。中止された取引は**何も書いていない**(outbox の行も含めて
 * 巻き戻っている)ので、同じ要求をもう一度送ってよい。デッドロックで落ちる側は選べない —— 表名の順を守る生成の RPC が、逆順に掴む手書きの
 * RPC に負けることもある。だから**生成の RPC も手書きの RPC も、同じこの口を通る**: 実行計画の口(`createRpcCaller`)・保存点の口
 * (`createUsecaseRepository`)・手書きのリポジトリの口(`createHandwrittenRpc`)・セッションの管理の口は、どれもこの関数が返した
 * {@link RpcSource} しか受け取らない(型の印。生の接続層を渡す道が型の上に無い)。製品の接続層の型(`AppSupabaseClient`)は `rpc` を出さない。
 * 表の書き込み(PostgREST の `from(表)` の insert / update)も同じ本体を通る({@link retryTableWrites}): 製品の接続層の型は `from` の
 * 読み取り(`select`)だけを出し、書き込みは型の印つきの {@link TableWriteSource} からしか送れない。
 *
 * ## やり直しの単位は 1 トランザクション全体だけ
 *
 * この口の入力は関数名と引数(要求の値)だけで、呼び手の処理を中に入れる口(コールバック)を持たない。やり直すのは下の口の `rpc` の 1 回
 * = PostgREST の 1 要求 = 1 トランザクションで、口の内側に外への送信・別の接続での書き込みのような巻き戻らない副作用を置く場所が無い。
 *
 * ## やり直す失敗(閉じた表)
 *
 * | SQLSTATE | 名前 | やり直す理由 |
 * |---|---|---|
 * | `40001` | serialization_failure | DB がトランザクションを中止した。巻き戻りは確実で、やり直しが Postgres の文書の推奨 |
 * | `40P01` | deadlock_detected | DB が片方のトランザクションを中止した。同上 |
 *
 * class 40 のほかの 2 つは入れない: `40003`(statement_completion_unknown)は**完了したか分からない**ので巻き戻りを言い切れない。
 * `40002`(transaction_integrity_constraint_violation)は制約の違反で、やり直しても同じ答えになる。通信の失敗(応答が無い・呼び出しが例外で
 * 終わる)もやり直さない: 送ったあとに落ちたかもしれず、巻き戻りを言い切れない。
 *
 * **上限は 3 回(最初の 1 回 + やり直し 2 回)**。待ちは 25 ms・50 ms に最大 25 ms 未満の揺らぎを足す(同時に負けた要求どうしが同じ瞬間に
 * ぶつかり直さないようにずらす)。尽きたら最後の失敗をそのまま返す —— 結末の読み(`rpc-outcome.ts`)は表の SQLSTATE を
 * **書けていない(`not_committed`)一時的な失敗**として読む(HTTP の状態に依らない。押し直してよく、押し直しの冪等が同じ結末に揃える)。
 */

/** やり直す SQLSTATE の閉じた表(巻き戻りが確実なものだけ)。 */
export const ROLLBACK_SQLSTATES: readonly string[] = ['40001', '40P01'];

/** 1 要求で送る回数の上限(最初の 1 回を含む)。 */
export const ROLLBACK_ATTEMPT_LIMIT = 3;

/** やり直しの前の待ち(ミリ秒。n 回目のやり直しは基準 × 2^(n-1) + 揺らぎ)。 */
export const ROLLBACK_BACKOFF_MS = 25;

/** 待ちの口(テストが差し替える)。 */
export type Sleep = (ms: number) => Promise<void>;

/** 既定の待ち。 */
const realSleep: Sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 下の口の 1 回の応答(PostgREST の `rpc()` の形のうち、ここで使う部分)。 */
export interface RpcResponse {
  readonly data: unknown;
  readonly error: PostgrestErrorLike | null;
  readonly status?: number;
}

/**
 * 適合前の口(製品の接続層の実クライアントを、関数名を実行時に決めて呼ぶ形)。この形のままでは adapter のどの口も受け取らない。
 *
 * **パッケージの外から名指せない**(fix27 項目 C。入口 `index.ts` が出さず、`exports` の名指しがこのファイルを外に開かない)。やり直しの口の
 * 入力({@link retryRollbacks} の引数)も、この型ではなく `object` で受ける —— 公開の口の引数の型から生の `rpc` の形を引き出す道
 * (`Parameters<typeof retryRollbacks>[0]`)を作らないためである。実クライアントが `rpc` を持つことは、送るときに実行時で確かめる。
 */
export interface RawRpc {
  rpc(name: string, args: Readonly<Record<string, unknown>>): PromiseLike<RpcResponse>;
}

/** やり直しの口を通った印(このモジュールの外から名前を書けない)。 */
declare const RETRIED: unique symbol;

/**
 * **やり直しの口を通った口の型の印**(パッケージの中だけの型。入口は出さない)。RPC か表の書き込みを送る口の型は、全部これを持つ
 * ({@link RpcSource}・{@link TableWriteSource}・手書きの口 `HandwrittenRpc`)。印を付けられるのは、やり直しの口を通した値を包む
 * このパッケージの関数だけである。生の道の規則(`RawPathRule`)は「`rpc` を持つのに印が無い」を生の道と数える。
 */
export interface Retried {
  readonly [RETRIED]: true;
}

/**
 * **やり直しの口を通った、関数名を実行時に決める最小の口**。作れるのは {@link retryRollbacks} だけである(型の印)。
 *
 * `AppSupabaseClient` を丸ごと受け取らずこの形にするのは、要る能力がこれだけだからである(`fact.reader.ts` の `RowSource` と同じ構え)。
 * 関数名のリテラル型に依存した Supabase の型を通さないのも同じ理由で、通すと全関数 × 全引数の組み合わせを解こうとして型が発散する。
 */
export interface RpcSource extends RawRpc, Retried {}

/**
 * 応答が、巻き戻りが確実な DB の失敗か(`code` が表の SQLSTATE)。
 *
 * @param error - 応答のエラー(無ければ `null`)
 * @returns 表の SQLSTATE なら true
 */
export function isCertainRollback(error: Pick<PostgrestErrorLike, 'code'> | null): boolean {
  return error !== null && ROLLBACK_SQLSTATES.includes(error.code);
}

/**
 * 1 要求を、巻き戻りが確実な失敗のあいだ上限つきで送り直す(この口の本体。RPC の口と表の書き込みの口が共有する)。
 *
 * `send` はこのモジュールの中でだけ作る(下の口の 1 要求を送るだけの閉包)。呼び手の処理を中に入れる口は外に出さない。
 *
 * @param send - 下の口の 1 要求を送る
 * @param sleep - 待ちの口
 * @param jitter - 揺らぎ
 * @returns 最後の応答
 */
async function sendRetrying(send: () => PromiseLike<RpcResponse>, sleep: Sleep, jitter: () => number): Promise<RpcResponse> {
  let response = await send();
  for (let attempt = 1; attempt < ROLLBACK_ATTEMPT_LIMIT && isCertainRollback(response.error); attempt += 1) {
    await sleep(ROLLBACK_BACKOFF_MS * 2 ** (attempt - 1) + Math.floor(jitter() * ROLLBACK_BACKOFF_MS));
    response = await send();
  }
  return response;
}

/**
 * 接続層が、名指した能力(メソッド)を実行時に持つことを確かめて取り出す(やり直しの口の入力は型の上では `object` なので、ここが唯一の確かめ)。
 *
 * @param connection - 接続層(型の上では読み取りだけの型で持ち回っている実クライアント)
 * @param capability - 要る能力の名前
 * @returns 接続層に束ねた能力
 * @throws {TypeError} 接続層がその能力を持たない(読み取りだけの偽物や、取り違えた値を渡した)
 */
function capabilityOf(connection: object, capability: 'rpc' | 'from'): (...args: never[]) => unknown {
  const method: unknown = Reflect.get(connection, capability);
  if (typeof method !== 'function') throw new TypeError(`やり直しの口に渡した接続層が ${capability} を持ちません`);
  return (method as (...args: never[]) => unknown).bind(connection);
}

/**
 * 巻き戻りが確実な失敗を上限つきでやり直す口を作る(RPC を呼ぶ道はこの口だけ)。
 *
 * 引数の型は `object` である(生の `rpc` の形を公開の口の型に出さない。{@link RawRpc})。製品の接続層は、読み取りだけの型
 * (`ReadOnlyClient`)のまま実クライアントを渡せる(型を落とす `as` が要らない)。`rpc` を持つことは呼ぶたびに実行時で確かめる。
 *
 * @param connection - 接続層(製品の接続層が実クライアントを渡す)
 * @param sleep - 待ちの口(省略は本物の待ち)
 * @param jitter - 揺らぎ(0 以上 1 未満。省略は `Math.random`)
 * @returns やり直しの口を通った口
 */
export function retryRollbacks(connection: object, sleep: Sleep = realSleep, jitter: () => number = Math.random): RpcSource {
  const source: RawRpc = {
    // 能力の確かめは送る閉包の中(持たなければ、呼び手には拒否された Promise として返る)。
    rpc: (name, args) => sendRetrying(() => (capabilityOf(connection, 'rpc') as RawRpc['rpc'])(name, args), sleep, jitter),
  };
  return source as RpcSource;
}

/** 表の 1 行(列名 → 値)。 */
export type TableRow = Readonly<Record<string, unknown>>;

/**
 * 適合前の表の書き込みの口(PostgREST の `from(表).insert(行)` / `from(表).update(差分).in(列, 値)` の形のうち、ここで使う部分)。
 * この形のままでは製品のどの口も受け取らない。{@link RawRpc} と同じく、パッケージの外から名指せない。
 */
export interface RawTableWrite {
  from(table: string): {
    insert(row: TableRow): PromiseLike<RpcResponse>;
    update(patch: TableRow): { in(column: string, values: readonly unknown[]): PromiseLike<RpcResponse> };
  };
}

/**
 * **やり直しの口を通った、表の書き込みの最小の口**(点検 27 回目の決めの続き: `.from()` の書き込みも RPC と同じやり直しの口を通す)。
 * 作れるのは {@link retryTableWrites} だけである(型の印)。
 *
 * PostgREST の表の書き込みの 1 要求は 1 文 = 1 トランザクションで、デッドロック(40P01)で中止されれば何も書いていない。
 * 入力は表名と値だけで、呼び手の処理を中に入れる口を持たない(やり直しの単位は 1 取引全体だけ)。
 */
export interface TableWriteSource extends Retried {
  /** 行を足す(1 要求)。 */
  insert(table: string, row: TableRow): Promise<RpcResponse>;
  /** `column` が `values` のどれかに等しい行を `patch` で更新する(1 要求)。 */
  updateIn(table: string, patch: TableRow, column: string, values: readonly unknown[]): Promise<RpcResponse>;
}

/**
 * 表の書き込みを、巻き戻りが確実な失敗のあいだ上限つきでやり直す口を作る(表の書き込みの道はこの口だけ。製品の接続層の型は
 * `from` の書き込みを出さない)。引数の型は {@link retryRollbacks} と同じく `object` で、`from` を持つことは送るたびに実行時で確かめる。
 *
 * @param connection - 接続層(製品の接続層が実クライアントを渡す)
 * @param sleep - 待ちの口(省略は本物の待ち)
 * @param jitter - 揺らぎ(0 以上 1 未満。省略は `Math.random`)
 * @returns やり直しの口を通った口
 */
export function retryTableWrites(connection: object, sleep: Sleep = realSleep, jitter: () => number = Math.random): TableWriteSource {
  const raw: RawTableWrite = { from: (table) => (capabilityOf(connection, 'from') as RawTableWrite['from'])(table) };
  const source: Omit<TableWriteSource, typeof RETRIED> = {
    insert: (table, row) => sendRetrying(() => raw.from(table).insert(row), sleep, jitter),
    updateIn: (table, patch, column, values) => sendRetrying(() => raw.from(table).update(patch).in(column, values), sleep, jitter),
  };
  return source as TableWriteSource;
}
