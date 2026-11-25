/**
 * 書き込み RPC 1 本が**実際に書く表と種類**の引き当て(宣言の読み方を 1 か所にする)。
 *
 * 操作の属性(destructive / touches_personal / affects_others)・書き込みの宣言の検査(T21 / T22)・
 * RPC 本文の期待表(rpc-parity の材料)が、同じ読み方で宣言を読む:
 *
 *   - 自表(帰属表)への書き込みは `self_writes`。定型 4 形は形が決める(create = insert / update = update /
 *     delete = delete / transition = update)。composite で宣言が無いものは**分からない**(undefined)
 *   - 他の表への書き込みは `also_writes`。`event_writes` がそのイベントを持てば、そのイベントの分だけ
 *     (持たなければ全部 —— 宣言を欠いたまま危険の表示を落とさない安全側)
 *   - 本文が呼ぶ関数(`calls`)の書き込みは呼んだ側に合流する(推移的。循環は 1 度だけ辿る)
 *
 * 純関数であり throw しない。アプリの語彙は 1 語も持たない。
 */

import { rpcNameCandidates } from './rpc-names.js';
import type { DataFunctionDecl, DataTableSpec, DataWriteKind } from './types.js';

/** 表 → 書き込みの種類。 */
export type WriteKindsByTable = Readonly<Record<string, readonly DataWriteKind[]>>;

/**
 * 自表への書き込みの種類(宣言、無ければ形から)。
 *
 * @param fn 関数の宣言
 * @returns 種類(composite で宣言が無い = 分からないときは undefined。rpc 以外は空)
 */
export function selfWriteKindsOf(fn: DataFunctionDecl): readonly DataWriteKind[] | undefined {
  if (fn.selfWriteKinds !== undefined) return fn.selfWriteKinds;
  if (fn.kind !== 'rpc') return [];
  switch (fn.shape) {
    case 'create':
      return ['insert'];
    case 'update':
    case 'transition':
      return ['update'];
    case 'delete':
      return ['delete'];
    default:
      return undefined;
  }
}

/**
 * その関数の帰属表(持ち場の表)。
 *
 * @param tables 全 data_table
 * @param fn 関数の宣言
 * @returns 表名(どの表にも無ければ undefined)
 */
export function homeTableOf(tables: readonly DataTableSpec[], fn: DataFunctionDecl): string | undefined {
  return tables.find((table) => table.functions.includes(fn))?.table;
}

/**
 * 全 data_table から `kind: rpc` の関数を名前で引く。
 *
 * @param tables 全 data_table
 * @param name 関数名
 * @returns 関数の宣言(無ければ undefined)
 */
export function findRpcByName(tables: readonly DataTableSpec[], name: string): DataFunctionDecl | undefined {
  return tables.flatMap((table) => table.functions).find((fn) => fn.kind === 'rpc' && fn.name === name);
}

/**
 * その状態機械の遷移が通る RPC(命名規約で引く。計画と同じ規約)。
 *
 * @param tables 全 data_table
 * @param entity 集約名
 * @param machine 状態機械の名前
 * @param soleMachine その集約の状態機械がちょうど 1 本か(`rpc-names.ts` の規約に渡す)
 * @returns 遷移の RPC(無ければ undefined)
 */
export function transitionRpcOf(tables: readonly DataTableSpec[], entity: string, machine: string, soleMachine: boolean): DataFunctionDecl | undefined {
  for (const name of rpcNameCandidates('transition', entity, machine, soleMachine)) {
    const fn = findRpcByName(tables, name);
    if (fn !== undefined) return fn;
  }
  return undefined;
}

/**
 * そのイベントで他の表に行う書き込み(`event_writes` に そのイベントがあればそれ、無ければ `also_writes` の全部)。
 *
 * @param fn 関数の宣言
 * @param event ドメインイベント ID(イベントに依らない読みなら null)
 * @returns 表 → 種類
 */
export function alsoWritesAt(fn: DataFunctionDecl, event: string | null): WriteKindsByTable {
  const perEvent = event === null ? undefined : fn.eventWrites?.[event];
  if (perEvent !== undefined) return perEvent;
  return Object.fromEntries(fn.alsoWrites.map((table) => [table, fn.alsoWriteKinds?.[table] ?? ['delete', 'scrub']]));
}

/** 呼び先の引き当て結果。 */
export interface Callees {
  /** 推移的に呼ばれる関数(初出の順・重複なし・自分を除く)。 */
  readonly found: readonly DataFunctionDecl[];
  /** 宣言されたのに data_table に無かった呼び先(T20 が名指しで error にする)。 */
  readonly missing: readonly string[];
}

/**
 * 本文が呼ぶ関数(`calls`)を推移的に引く。
 *
 * @param tables 全 data_table
 * @param fn 起点の関数
 * @returns 呼び先と、引けなかった名前
 */
export function calleesOf(tables: readonly DataTableSpec[], fn: DataFunctionDecl): Callees {
  const all = tables.flatMap((table) => table.functions);
  const found: DataFunctionDecl[] = [];
  const missing: string[] = [];
  const seen = new Set<string>([fn.name]);
  const queue = [...(fn.calls ?? [])];
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    const callee = all.find((candidate) => candidate.name === name && candidate.kind !== 'trigger');
    if (callee === undefined) {
      missing.push(name);
      continue;
    }
    found.push(callee);
    queue.push(...(callee.calls ?? []));
  }
  return { found, missing };
}

/**
 * その関数がそのイベントで**値を消す**表(自表・他の表・呼び先。`scrub` と `delete`)。
 *
 * 外部キーの連鎖で消える表は T21 が宣言へ載せさせるので、ここは宣言だけを読む。自表の宣言が無い関数は、形の既定のとおり `selfWriteKindsOf` が読む。
 *
 * @param tables 全 data_table
 * @param fn 起点の関数
 * @param event ドメインイベント ID
 * @returns 表の名前の集合
 */
export function erasedTablesAt(tables: readonly DataTableSpec[], fn: DataFunctionDecl, event: string): ReadonlySet<string> {
  const erased = new Set<string>();
  const erases = (kinds: readonly DataWriteKind[]): boolean => kinds.includes('scrub') || kinds.includes('delete');
  for (const source of [fn, ...calleesOf(tables, fn).found]) {
    const home = homeTableOf(tables, source);
    if (home !== undefined && erases(selfWriteKindsOf(source) ?? [])) erased.add(home);
    for (const [table, kinds] of Object.entries(alsoWritesAt(source, event))) if (erases(kinds)) erased.add(table);
  }
  return erased;
}
