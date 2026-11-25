import type { InvariantResolver } from '@kaninabe/runtime/bindings';
import { DbInfrastructureError } from '@kaninabe/runtime/ports';
import { refusalOrThrow } from './rpc-outcome';
import { sqlstateOrNull } from '@kaninabe/runtime/refusal';
import type { HandwrittenRefusalRead, RpcSource } from './rpc-outcome';
import type { Retried } from './rollback-retry';

/**
 * **手書きのリポジトリが RPC を呼ぶ唯一の口**(`createHandwrittenRpc`。点検 27 回目 B27-1)。
 *
 * 集約ごとのリポジトリ(`runner: manual` の操作と古い定型 4 手順の口)は、関数名と引数の型を製品の DB の型から受け取りたい
 * (戻りの行を型つきで読むため)。実行計画の口(`createRpcCaller`)は関数名を実行時に決めるので型を持たない。この口はその間を埋める:
 * 型は製品の関数の表(`Database['api']['Functions']`)から受け、呼び出しと結末の読みは adapter が持つ。
 *
 * 結末は 2 つに分かれる —— 書けた(`refused: null` と戻りの値)か、業務の拒否(`refused` と `data: null`)。通信の失敗と想定外の失敗は
 * `refusalOrThrow` が `DbInfrastructureError` で投げる。リポジトリは拒否の分類も投げ方も持たない(並べ忘れが書けない)。
 */

/** 製品の DB の型の 1 関数の形(`Args` と `Returns`)。 */
export interface HandwrittenFunctionShape {
  readonly Args: object;
  readonly Returns: unknown;
}

/** 1 回の呼び出しの結末(書けた / 業務の拒否)。 */
export type HandwrittenCall<R> =
  | { readonly refused: null; readonly reason: null; readonly error: null; readonly data: R }
  | (HandwrittenRefusalRead & { readonly data: null });

/**
 * 手書きのリポジトリが受け取る口(関数名と引数は製品の関数の表で型がつく)。やり直しの口の型の印を持つ(作れるのは
 * {@link createHandwrittenRpc} だけ。やり直しの口を通った `RpcSource` を包む)。
 */
export interface HandwrittenRpc<Fns extends Readonly<Record<string, HandwrittenFunctionShape>>> extends Retried {
  rpc<N extends keyof Fns & string>(name: N, args: Fns[N]['Args']): Promise<HandwrittenCall<Fns[N]['Returns']>>;
  /**
   * 業務の拒否を持たない関数(ジョブの取り出し・取り込みの置き換えなど)の口。拒否も含めて全部の失敗を `DbInfrastructureError` で投げる
   * (拒否の errcode と制約の違反は txn ごと戻るので、コミットの状態は `not_committed` になる)。
   */
  rpcOrThrow<N extends keyof Fns & string>(name: N, args: Fns[N]['Args']): Promise<Fns[N]['Returns']>;
}

/**
 * 制約名の表から不変条件の引き方を作る(本文・詳細・ヒントを連ねた字面に制約名が現れるか。PostgREST は constraint の欄を載せない)。
 *
 * @param table - DB の制約名 → 不変条件 ID(キーは仕様の `enforced_by[].ref` に実在する名前)
 * @returns 不変条件の引き方
 */
export function invariantResolverOf(table: Readonly<Record<string, string>>): InvariantResolver {
  return (haystack) => {
    const found = Object.keys(table).find((name) => haystack.includes(name));
    return found === undefined ? undefined : table[found];
  };
}

/**
 * 拒否を持たない約束の呼び出しが、業務の拒否を受けたときに投げる失敗(拒否の errcode と制約の違反は txn ごと戻るので `not_committed`)。
 *
 * @param where - どの呼び出しか
 * @param read - 業務の拒否の読み
 * @returns 投げる失敗
 */
export function unexpectedRefusal(where: string, read: HandwrittenRefusalRead): DbInfrastructureError {
  return new DbInfrastructureError(where, { kind: 'unknown_failure', commit: 'not_committed', sqlstate: sqlstateOrNull(read.error.code), cause: read.error });
}

/**
 * 手書きのリポジトリの口を作る。
 *
 * @param source - 関数名を実行時に決める最小の口(製品の接続層が適合させる)
 * @param invariantOfMessage - DB の不整合のメッセージ → 不変条件 ID(リポジトリが持つ制約名の表)
 * @returns 関数名と引数に型のつく口
 */
export function createHandwrittenRpc<Fns extends Readonly<Record<string, HandwrittenFunctionShape>>>(
  source: RpcSource,
  invariantOfMessage: InvariantResolver,
): HandwrittenRpc<Fns> {
  /** 1 回呼ぶ(呼び出しが例外で終わったら、送ったあとかもしれない通信の失敗として投げる。実行計画の口 `callRpc` と同じ読み)。 */
  async function once(name: string, args: object): Promise<Awaited<ReturnType<RpcSource['rpc']>>> {
    try {
      return await source.rpc(name, args as Readonly<Record<string, unknown>>);
    } catch (cause) {
      throw new DbInfrastructureError(name, { kind: 'transport_failed', commit: 'unknown', cause });
    }
  }
  /** 1 回呼び、書けた結果か業務の拒否の読みにする(それ以外の失敗は投げる)。 */
  async function call<N extends keyof Fns & string>(name: N, args: Fns[N]['Args']): Promise<HandwrittenCall<Fns[N]['Returns']>> {
    const response = await once(name, args);
    if (response.error === null) return { refused: null, reason: null, error: null, data: response.data as Fns[N]['Returns'] };
    return { ...refusalOrThrow(name, response.error, invariantOfMessage, response.status), data: null };
  }
  const port: Omit<HandwrittenRpc<Fns>, keyof Retried> = {
    rpc: call,
    async rpcOrThrow(name, args) {
      const result = await call(name, args);
      if (result.refused !== null) throw unexpectedRefusal(name, result);
      return result.data;
    },
  };
  // 型の印(実行時の値は持たない)。包むのはやり直しの口を通った `source` だけである。
  return port as HandwrittenRpc<Fns>;
}

