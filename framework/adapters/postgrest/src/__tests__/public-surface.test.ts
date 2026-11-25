/**
 * **PostgREST の adapter の公開の口の閉じた表**(fix27 項目 C。照らしの本体は `../../testing/closed-surface.mts`)。
 *
 * `package.json` の `exports` の全部の入口の、全部の口(値と型)を 1 行ずつ載せる。口を足したのに表に無い・表にあるのに口が無い・
 * 口が生の道(やり直しの口を通らない `rpc`・`schema`・`from` の書き込み)を返す / 受け取る —— のどれも赤になる。
 * 型の口は具体の型引数で呼ぶ(生の道を外す規則 `ReadOnlyClient` は、生の道を全部持つ接続層の形で呼んで、外れることを見る)。
 */

import { describe, expect, it } from 'vitest';
import { ownSurfaceProblems } from '../../testing/closed-surface.mts';
import type * as Root from '../index';
import type * as Testing from '../../testing/closed-surface.mts';

/** 生の道を全部持つ接続層の形(`ReadOnlyClient` がそれを外すことを表で見る)。 */
interface FullConnection {
  readonly auth: { readonly signOut: () => Promise<void> };
  rpc(name: string): Promise<unknown>;
  schema(name: string): FullConnection;
  from(table: string): { readonly select: () => unknown; readonly insert: () => unknown };
}

/** 表名 → 問い合わせの組み立て(書き込みのメソッドも持つ形)。 */
type FullBuilders = { readonly widgets: { readonly select: () => unknown; readonly insert: () => unknown; readonly delete: () => unknown } };

/** 手書きの RPC の関数の表(1 本)。 */
type Fns = { readonly erase_widget: { readonly Args: { readonly p_id: string }; readonly Returns: number } };

/** 入口 → 口の名前 → 口の型。 */
export interface PublicSurface {
  '.': {
    createFactReader: typeof Root.createFactReader;
    RowSource: Root.RowSource;
    createRpcCaller: typeof Root.createRpcCaller;
    createHandwrittenRpc: typeof Root.createHandwrittenRpc;
    invariantResolverOf: typeof Root.invariantResolverOf;
    HandwrittenCall: Root.HandwrittenCall<number>;
    HandwrittenFunctionShape: Root.HandwrittenFunctionShape;
    HandwrittenRpc: Root.HandwrittenRpc<Fns>;
    dbFailure: typeof Root.dbFailure;
    refusalOrThrow: typeof Root.refusalOrThrow;
    toOutcome: typeof Root.toOutcome;
    HandwrittenRefusal: Root.HandwrittenRefusal;
    ROLLBACK_ATTEMPT_LIMIT: typeof Root.ROLLBACK_ATTEMPT_LIMIT;
    ROLLBACK_SQLSTATES: typeof Root.ROLLBACK_SQLSTATES;
    isCertainRollback: typeof Root.isCertainRollback;
    retryRollbacks: typeof Root.retryRollbacks;
    retryTableWrites: typeof Root.retryTableWrites;
    RpcResponse: Root.RpcResponse;
    Sleep: Root.Sleep;
    TableRow: Root.TableRow;
    TableWriteSource: Root.TableWriteSource;
    PostgrestErrorLike: Root.PostgrestErrorLike;
    RpcSource: Root.RpcSource;
    ReadOnlyClient: Root.ReadOnlyClient<FullConnection, FullBuilders>;
    createUsecaseRepository: typeof Root.createUsecaseRepository;
  };
  // 試験の基盤の入口も配布の入口なので外さずに照らす(fix27 差分点検 O-3。口は文字列と数と照らしの関数だけで、型検査器の型を外へ出さない)。
  './testing/closed-surface': {
    SURFACE_TABLE: typeof Testing.SURFACE_TABLE;
    SURFACE_PROBE: typeof Testing.SURFACE_PROBE;
    SURFACE_DEPTH_LIMIT: typeof Testing.SURFACE_DEPTH_LIMIT;
    FileOverlay: Testing.FileOverlay;
    SurfaceInput: Testing.SurfaceInput;
    closedSurfaceProblems: typeof Testing.closedSurfaceProblems;
    expectedErrorProblems: typeof Testing.expectedErrorProblems;
    ownSurfaceProblems: typeof Testing.ownSurfaceProblems;
  };
}

describe('PostgREST の adapter の公開の口は閉じている', () => {
  it('exports の全部の口が表に載り、どの口も生の道を返さず受け取らない。生の口の型は外から名指せない', () => {
    expect(ownSurfaceProblems(import.meta.url)).toEqual([]);
  });
});
