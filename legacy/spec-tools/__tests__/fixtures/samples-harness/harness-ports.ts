import type { EqRpcSource, HarnessPorts, RlsReadClient, SeededUser } from '@kaninabe/runtime/testing/harness/ports';

/**
 * 通し実行(`__tests__/samples/harness.ts`)が、製品に `app/` の実物が無いときに写す**口の実装の代用**。
 *
 * 通し実行が生成 TS に求めるのは**型検査と字面の検査だけ**で、ハーネスの口(実 DB とセッションに触る手)を
 * 実際には呼ばない。だからここは `HarnessPorts` を**型として満たす**だけの代用であり、実 DB に触る口は
 * 呼ばれたら throw する(実 DB の通し実行 `samples:db` は、製品の `app/` にある実物を使う。これは使わない)。
 * 製品の実物(`app/src/infrastructure/__tests__/harness-ports.ts`)と同じ欄を持つことは、開発用リポジトリ側の
 * `__tests__/dev-repo/` の見張りが確かめる。
 *
 * 置き場が `fixtures/samples/` の下ではないのは、あそこの直下が「題材 1 つ = ディレクトリ 1 つ」の一覧として
 * 読まれるからである。
 */

/**
 * 実 DB に触る口が呼ばれたことを知らせて止める。
 *
 * @param port 呼ばれた口の名前
 * @returns 返らない
 */
function unavailable(port: string): never {
  throw new Error(`通し実行の代用の口 ${port} が呼ばれました。実 DB に触る通し実行は製品の app/ の実物を使います。`);
}

/** `HarnessPorts` を型として満たすだけの代用(セッション属性の欄は空)。 */
export const HARNESS_PORTS: HarnessPorts = {
  sessionFields: [],
  resetDatabase: () => unavailable('resetDatabase'),
  seedAuthUser: (): Promise<SeededUser> => unavailable('seedAuthUser'),
  signIn: () => unavailable('signIn'),
  writeSessionProfile: () => unavailable('writeSessionProfile'),
  readSessionProfile: () => unavailable('readSessionProfile'),
  withPg: () => unavailable('withPg'),
  connectPg: () => unavailable('connectPg'),
  createRlsClient: (): RlsReadClient => unavailable('createRlsClient'),
  rpcSource: (): EqRpcSource => unavailable('rpcSource'),
};
