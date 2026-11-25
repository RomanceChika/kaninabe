import type { InvariantResolver } from '@kaninabe/runtime/bindings';
import type { RpcCaller } from '@kaninabe/runtime/ports';
import { callRpc } from './call-rpc';
import type { RpcSource } from './rpc-outcome';

/**
 * **定型 RPC の口**(`@kaninabe/adapter-postgrest` の入口の 1 つ)。
 *
 * 結末の読み方(`toOutcome` / 手書きの口の `refusalOrThrow`)と最小の口の型(`RpcSource` / `PostgrestErrorLike`)は
 * `./rpc-outcome.ts` にあり、パッケージの入口(`../index.ts`)が再輸出する。1 回呼ぶ内部の入口(`callRpc`)は
 * `./call-rpc.ts` で、公開しない。
 */

/**
 * `RpcCaller` を作る。
 *
 * **接続層そのものは受け取らない。** 要る能力は `RpcSource` の 1 メソッドだけであり、
 * 実クライアントをその形に適合させるのは**製品の接続層の仕事**である(`rpcSourceOf`。
 * そのアプリの行の型に縛られた実体はパッケージから見えない。ADR-0013 §3-1 のポート)。
 *
 * 呼び出しごとの `options.tracksEffects` を `false` にすると、受領の `requestedEffects` は `null`
 * (要求した効果を追っていない)になる。効果が SQL の本体にあり引数に載らない RPC(受信口の RPC)が使う。
 * 既定は `true`(引数 `p_effects` を要求の写しにする)。
 *
 * @param source - 関数名を実行時に決める最小の口
 * @param invariantOfMessage - DB の不整合のメッセージ → 不変条件 ID（製品が渡す）
 * @returns 実行計画が名指しした関数を名前付き引数で実行する口
 */
export function createRpcCaller(source: RpcSource, invariantOfMessage: InvariantResolver): RpcCaller {
  return {
    call: (rpc, args, options) =>
      callRpc(source, rpc, args, { emptyIsConflict: true, tracksEffects: options?.tracksEffects ?? true }, invariantOfMessage),
  };
}
