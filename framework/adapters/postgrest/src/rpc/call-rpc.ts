import type { InvariantResolver } from '@kaninabe/runtime/bindings';
import type { CommitOutcome, RpcReturn } from '@kaninabe/runtime/ports';
import { toOutcome } from './rpc-outcome';
import type { RpcSource } from './rpc-outcome';

/**
 * **RPC を 1 回呼ぶ内部の入口**(定型 RPC の口 `createRpcCaller` と複合 RPC の口 `createUsecaseRepository` が共有する)。
 *
 * 公開の入口(`@kaninabe/adapter-postgrest`)には載せない。使うのはこのパッケージの内部の 2 か所だけで、
 * 利用側が見る口は `RpcCaller` / `UsecaseRepository` である。結末の写像は `./rpc-outcome.ts` の
 * `toOutcome` の 1 か所に置いてある。
 */

/** `callRpc` の読み方の宣言(隣り合う真偽値の取り違えを型で防ぐため、名前つきの欄で渡す)。 */
export interface CallRpcOptions {
  /** 0 行を競合と読むか(条件つきで書く定型 RPC は true、複合 RPC は false)。 */
  readonly emptyIsConflict: boolean;
  /** 引数 `p_effects` を要求した効果として受領に写すか(false なら `null` = 追っていない)。 */
  readonly tracksEffects: boolean;
}

/**
 * RPC の引数に載せた効果の ID(`p_effects`)を、要求の写しとして取り出す。
 *
 * 要求の写しであって、積んだことの証明ではない(受領の `outbox` は常に `unknown`)。
 * 引数に効果を載せる RPC(単発の定型 RPC)だけがこれを使う。引数に載せない呼び出し(効果が SQL の
 * 本体にある複合 RPC・受信口の RPC)は `null` を受領に渡す(空の配列にしない: 空は「積まなかった」と
 * 読めるが、`null` は「追っていない」である)。
 *
 * @param args - RPC に渡した名前付き引数
 * @returns 要求した効果の ID
 */
function requestedEffectsOf(args: Readonly<Record<string, unknown>>): readonly string[] {
  const effects = args['p_effects'];
  return Array.isArray(effects) ? effects.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * RPC を 1 回呼び出し、結果を契約の形で返す(単発の口と複合の口が共有する唯一の入口)。
 *
 * 呼び出しそのものが例外で終わったとき(`source.rpc` が値を返さず投げた)も、握りつぶさず
 * **通信の失敗**として返す —— コミットの状態は `unknown`(送ったあとかもしれない)。
 * 戻り値のエラーと例外のどちらでも、同じ分類になる。
 *
 * @param source - 関数名を実行時に決める最小の口
 * @param rpc - 関数名
 * @param args - 名前付き引数
 * @param options - 0 行の読み方と、効果を要求の写しとして追うか
 * @param invariantOfMessage - DB の不整合のメッセージ → 不変条件 ID(製品が渡す)
 * @returns 書けた(受領)・業務の拒否・通信の失敗・想定外の失敗
 */
export async function callRpc(
  source: RpcSource,
  rpc: string,
  args: Readonly<Record<string, unknown>>,
  options: CallRpcOptions,
  invariantOfMessage: InvariantResolver,
): Promise<CommitOutcome<RpcReturn>> {
  let response: Awaited<ReturnType<RpcSource['rpc']>>;
  try {
    response = await source.rpc(rpc, args);
  } catch (cause) {
    return { kind: 'transport_failed', commit: 'unknown', cause };
  }
  const effects = options.tracksEffects ? requestedEffectsOf(args) : null;
  return toOutcome(response.data, response.error, options.emptyIsConflict, effects, invariantOfMessage, response.status);
}
