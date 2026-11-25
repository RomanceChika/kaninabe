/**
 * **パッケージの外から、やり直しの口を素通りする道を書こうとする探り**(呼ばない。型検査だけが読む。fix27 項目 C)。
 *
 * 各 `@ts-expect-error` の理由の頭の番号は、その行が**その番号の誤りだけ**で落ちることを `public-surface.test.ts` が照らす
 * (`expectedErrorProblems`)。印の無い行(下の正しい道)は誤りを持たない。
 */

// 入口(`exports` の "." が指す `src/index.ts`)を外の利用者と同じ形で読む。
import type * as Root from '../index';
import { createRpcCaller, retryRollbacks, retryTableWrites } from '../index';
// @ts-expect-error TS2305 生の口の型は入口が出さない(名前で import できない)。
import type { RawRpc } from '../index';
// @ts-expect-error TS2307 入口の外のファイルは exports の名指しが開かない(深い住所で生の型を引けない)。
import type { RawTableWrite } from '@kaninabe/adapter-postgrest/src/rpc/rollback-retry';

/** 外で作った、型の印の無い構造の口。 */
const bare = { rpc: (name: string) => Promise.resolve({ data: name, error: null }) };

/** `as` で生の口の型へ戻そうとする(名前が無いので書けない)。 */
// @ts-expect-error TS2694 名前空間の入口にも生の口の型は無い。
export const asRaw = bare as unknown as Root.RawRpc;

// @ts-expect-error TS2741 型の印の無い口は、やり直しの口の型(RpcSource)にならない。
export const notRetried: Root.RpcSource = bare;

// @ts-expect-error TS2345 型の印の無い口は、実行計画の口に渡せない。
export const caller = createRpcCaller(bare, () => undefined);

// @ts-expect-error TS2339 やり直しの口の入力の型から、生の rpc の形を引き出せない(引数は object)。
export type RawFromParameters = Parameters<typeof retryRollbacks>[0]['rpc'];

// 正しい道: やり直しの口を通した口は、実行計画の口に渡せる。表の書き込みの口も同じ。
export const retried: Root.RpcSource = retryRollbacks(bare);
export const callerOk = createRpcCaller(retried, () => undefined);
export const writes: Root.TableWriteSource = retryTableWrites({ from: () => ({}) });

/** 読まれない名前を残さない(型の import を使う)。 */
export type Unused = [RawRpc, RawTableWrite];
