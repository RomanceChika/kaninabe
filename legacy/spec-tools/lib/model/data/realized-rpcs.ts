/**
 * 同一トランザクションで実現される効果が**名指しした RPC**（`realized_by`）の引き当てと、その書き込み先。
 *
 * 遷移・操作の属性（destructive / bulk / touches_personal）と、遷移書き込みの期待表（匿名化の連鎖の免除）は、
 * どちらも「この操作が実際に通る RPC が also_writes で別の表に届くか」を見る。どの RPC かを集約の関数の本数や
 * 形から**推測しない** —— 効果の側が `realized_by: {イベント ID: RPC 名}` で名指しする（キーの過不足と
 * RPC の実在は T19 が見る）。名指しの引き当てはここ 1 か所で、2 つの読み手が同じ答えを得る。
 *
 * 名指しできる RPC は `kind: rpc` の全部である（遷移の定型 `shape: transition` も、複合 `composite` も）。
 *
 * 純関数であり throw しない。アプリの語彙は 1 語も持たない。
 */

import type { JobDecl } from '../job/types.js';
import type { DataFunctionDecl, DataTableSpec } from './types.js';

/** 名指しされた RPC の引き当て結果。 */
export interface RealizedRpcs {
  /** 名指しされた RPC のうち、data_table に実在したもの（名指しの順・重複なし）。 */
  readonly found: readonly DataFunctionDecl[];
  /** 名指しされたのに data_table に無かった RPC 名（T19 が名指しで error にする。ここでは数えない）。 */
  readonly missing: readonly string[];
}

/**
 * 効果の行がそのイベントで実現する RPC 名（名指しが無ければ undefined）。
 *
 * @param job ジョブカタログの行
 * @param event ドメインイベント ID
 * @returns RPC 名
 */
export function realizingRpcName(job: JobDecl | undefined, event: string): string | undefined {
  return job?.realizedBy?.[event];
}

/**
 * RPC 名を data_table の `kind: rpc` から引く。
 *
 * @param tables 全 data_table
 * @param names RPC 名
 * @returns 実在した RPC と、実在しなかった名前
 */
export function findRealizedRpcs(tables: readonly DataTableSpec[], names: readonly string[]): RealizedRpcs {
  const unique = [...new Set(names)];
  const found: DataFunctionDecl[] = [];
  const missing: string[] = [];
  for (const name of unique) {
    const fn = tables.flatMap((table) => table.functions).find((candidate) => candidate.kind === 'rpc' && candidate.name === name);
    if (fn === undefined) missing.push(name);
    else found.push(fn);
  }
  return { found, missing };
}

/**
 * RPC 群の `also_writes` の和（初出の順・重複なし）。
 *
 * @param rpcs 引き当てた RPC
 * @returns 書き込み先の表名
 */
export function alsoWritesOf(rpcs: readonly DataFunctionDecl[]): readonly string[] {
  return [...new Set(rpcs.flatMap((fn) => fn.alsoWrites))];
}
