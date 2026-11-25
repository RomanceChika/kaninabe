/**
 * **PostgREST の adapter**(`@kaninabe/adapter-postgrest`)の公開の入口。
 *
 * 仕様: docs/rules/decisions/common/ADR-0013-framework-runtime-package.md
 *
 * runtime が定める中立のポート(`@kaninabe/runtime/ports` の `FactReader` / `RpcCaller` / `UsecaseRepository`)を、
 * PostgREST の形(`from().select().eq().maybeSingle()` / `rpc(name, args)`)の上で実装する。持つものは
 * ①読み取りと RPC の呼び出し(3 つの口)②PostgREST のエラーの形から中立の分類の入力への写し
 * (拒否の分類そのものは runtime の `@kaninabe/runtime/refusal` が持つ)③それが要る最小の口の型
 * (`RowSource` / `RpcSource`)である。**接続層そのものは受け取らない** —— 実クライアントをその形に
 * 適合させるのは製品の接続層の仕事で、組み立ては製品の配線 1 本(`createDbPorts()`)が持つ。
 *
 * このパッケージは runtime に依存し、runtime はこのパッケージを知らない(逆向きの依存は無い)。
 * **サーバー専用の印(`import 'server-only'`)はここに置かない** —— 印は製品の配線と生成した組み立ての根が持つ。
 */

export { createFactReader } from './facts/fact.reader';
export type { RowSource } from './facts/fact.reader';
export { createRpcCaller } from './rpc/rpc.caller';
export { createHandwrittenRpc, invariantResolverOf } from './rpc/handwritten-rpc';
export type { HandwrittenCall, HandwrittenFunctionShape, HandwrittenRpc } from './rpc/handwritten-rpc';
export { dbFailure, refusalOrThrow, toOutcome } from './rpc/rpc-outcome';
export type { HandwrittenRefusal } from './rpc/rpc-outcome';
export { ROLLBACK_ATTEMPT_LIMIT, ROLLBACK_SQLSTATES, isCertainRollback, retryRollbacks, retryTableWrites } from './rpc/rollback-retry';
export type { RpcResponse, Sleep, TableRow, TableWriteSource } from './rpc/rollback-retry';
// 生の口の型(`RawRpc` / `RawTableWrite`)は出さない(パッケージの外から名指せない。fix27 項目 C)。
export type { PostgrestErrorLike, RpcSource } from './rpc/rpc-outcome';
export type { ReadOnlyClient } from './rpc/read-only-client';
export { createUsecaseRepository } from './usecase/usecase.repository';
