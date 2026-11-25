/**
 * RLS のオラクルが**境界(`reads[].filters`)の両辺の値**を引く部品(`oracle.mts` と `expect.mts` から読まれる)。
 *
 * 左辺は的の行の列(親の列なら参照列の鎖 `via` を実 DB の行で 1 段ずつ辿った先の列)、右辺は**実行者自身の行**の
 * 欄である —— セッションの写し(`claims`)ではない。生成するポリシーも同じ正(実行者の行を読む補助関数)を読む。
 *
 * **アプリの語彙は 1 語も持たない**(集約名・列名はすべて設計図から来る)。
 */

import type { RlsWorld, RlsWorldFilter } from './types.mjs';
import type { BuiltRlsRow, BuiltRlsWorld } from './world.mjs';

/** 境界の判定に要るもの(的の行と、実行者自身の行)。 */
export interface BoundarySubject {
  readonly built: BuiltRlsWorld;
  readonly row: BuiltRlsRow;
  /** 実行者自身の行(行を持たない人・未ログインなら undefined)。 */
  readonly actor: BuiltRlsRow | undefined;
  readonly actorId: string | null;
}

/** 実行者の集約にあるその人の行(実際にそこにある行)。 */
export function actorRowOf(world: RlsWorld, built: BuiltRlsWorld, actorId: string | null): BuiltRlsRow | undefined {
  if (actorId === null) return undefined;
  return [...built.rows.values()].find((row) => row.table === world.actorTable && row.id === actorId);
}

/** 実行者の欄の値(`id` は同一性そのもの。それ以外は実行者自身の行の欄)。 */
export function actorValue(subject: BoundarySubject, field: string): unknown {
  return field === 'id' ? subject.actorId : subject.actor?.values[field];
}

/**
 * 境界の列の値(親の列なら、参照列を 1 段ずつ実 DB の行で辿った先の列)。
 *
 * 辿った先の行が無ければ `undefined` を返し、比較は不成立になる(ポリシーのスカラー副問い合わせが
 * NULL を返して `coalesce(…, false)` で閉じるのと同じ)。
 *
 * @param built 実 DB の world
 * @param row 的の行
 * @param filter 境界 1 本
 * @returns 境界の列の値
 */
export function boundaryValue(built: BuiltRlsWorld, row: BuiltRlsRow, filter: RlsWorldFilter): unknown {
  let current: BuiltRlsRow | undefined = row;
  for (const column of filter.via) {
    const id: unknown = current?.values[column];
    current = typeof id === 'string' ? [...built.rows.values()].find((candidate) => candidate.id === id) : undefined;
  }
  return current?.values[filter.field];
}

/**
 * 実行者の欄の値を、実行者の名前から引く(境界の見張りテストが「境界の違う行」を見分けるのに使う)。
 *
 * @param world 設計図
 * @param built 実 DB の world
 * @param actorKey 実行者の名前
 * @param field 実行者の欄
 * @returns 値(実行者が行を持たなければ undefined)
 */
export function actorFieldValue(world: RlsWorld, built: BuiltRlsWorld, actorKey: string, field: string): unknown {
  const actorId = built.actors.get(actorKey)?.id ?? null;
  return field === 'id' ? actorId : actorRowOf(world, built, actorId)?.values[field];
}
