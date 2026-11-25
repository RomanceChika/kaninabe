/**
 * 定型 RPC の先掴みのうち、**参照の欄が指す行を読む条件の相手の端**が掴む錨の行(点検 D25s2-1)。
 *
 * 相手の端の本文(`ddl-ref-check-ends.ts`)は、錨でない表の更新のコミット時に「その行を指す自表の行が指す錨の行」を id の順に掴む。
 * 錨は自表より前の名前の表なので、トリガの中で後から掴むと表名のバイト順に逆らう —— 定型 RPC は書く前にその行を同じ形で掴む。
 * ほかの経路(トリガの書き込み・連鎖・宣言の掴み)は `rpc-closure-locks.ts` が持ち、ここは錨の 1 経路だけを持つ(錨は直の外部キーで
 * 指す親とは限らないので、宣言の `locks` の口 —— 発火させた行が直に指す親 —— には載らない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { refCounterpartsOf } from '../model/data/ref-check-shape.js';
import { updatedColumnsOf } from '../model/trigger-fires.js';
import type { ClosureLockInput, ClosureLockRow } from './rpc-closure-locks.js';

/** 掴む行に付ける別名の前置(`rpc-closure-locks.ts` と同じ並びの続き番号)。 */
const CLOSURE_ALIAS_PREFIX = 'c';

/** 自表の行に付ける別名の後置。 */
const HOST_SUFFIX = '_h';

/**
 * 自表の更新が発火させる相手の端が、コミット時に掴む錨の行(点検 D25s2-1。本文は `ddl-ref-check-ends.ts`、錨の決め方は `ref-check-shape.ts`)。
 * 錨は自表より前の名前の表なので、トリガの中で後から掴むと逆順になる —— 先掴みに入れる。
 *
 * @param input 関数の宣言・自表・全 data_table・対象の行の id の式
 * @param start 別名の続き番号
 * @returns 掴む行(錨でない表の更新だけ)
 */
export function anchorRows(input: ClosureLockInput, start: number): readonly ClosureLockRow[] {
  if (input.domain === undefined || (input.shape !== 'update' && input.shape !== 'transition')) return [];
  const written = input.writtenColumns ?? null;
  return refCounterpartsOf(input.table, input.domain, input.tables).flatMap((end, index): ClosureLockRow[] => {
    const watched = updatedColumnsOf(end.fires);
    if (end.anchor === null || (written !== null && watched !== null && watched !== 'all' && !watched.some((column) => written.includes(column)))) return [];
    const alias = `${CLOSURE_ALIAS_PREFIX}${String(start + index)}`;
    const host = `${alias}${HOST_SUFFIX}`;
    return [
      {
        table: end.anchor.row.table,
        alias,
        from: [`public.${end.hostTable} ${host}`, `public.${end.anchor.row.table} ${alias}`],
        where: [`${host}.${end.row.column} = ${input.targetId}`, `${alias}.id = ${host}.${end.anchor.row.column}`],
        mode: end.anchor.strength,
        idKey: null,
        ordered: true,
      },
    ];
  });
}
