/**
 * 保存点の実行計画が積んだ読み取りを、**実行できる順**に並べる純粋モジュール。
 *
 * `plan-facts.ts` が積んだ読み取りの並べ替えだけを持つ。
 */

import type { UsecaseRead, UsecaseReadIdSource } from './plan-facts-types.js';

/** 組み立て中の読み取り 1 件(id の供給元が決まるまで null を持つ)。 */
export interface ReadEntry {
  readonly entity: string;
  readonly table: string;
  idFrom: UsecaseReadIdSource | null;
  readonly fields: Set<string>;
}

/** id の供給元が決まった読み取り。 */
type Resolved = ReadEntry & { idFrom: UsecaseReadIdSource };

/**
 * 読み取りを**実行できる順**に並べる(依存の無いものが先)。
 *
 * `context` 経由の読み取りは「先に読んだ行の参照列」を id にするので、依存先より後に来なければ
 * 実行器が値を持たない。依存は**段の数だけ連鎖する**(`{起点} → {中継} → {相手}` の 2 段。
 * 束 ⑲-2a で `context` の連鎖を許したため)ので、2 層に分けるだけでは足りず、依存の向きに
 * 沿って並べる。循環は起こらない —— `context` は前方参照だけを許す宣言であり(V2)、
 * それでも万一残ったものは末尾に置いて**黙って落とさない**(Y10 が別途 unreadable として見る)。
 *
 * @param reads 集約名 → 組み立て中の読み取り
 * @returns 実行順に並べた読み取り(id の供給元が決まらなかったものは落とす)
 */
export function orderedReads(reads: ReadonlyMap<string, ReadEntry>): readonly UsecaseRead[] {
  const rows = [...reads.values()].filter((read): read is Resolved => read.idFrom !== null);
  const emitted = new Set<string>();
  const ordered: Resolved[] = [];
  let remaining = rows;
  while (remaining.length > 0) {
    const ready = remaining.filter((read) => {
      const dependency = dependsOn(read);
      return dependency === null || emitted.has(dependency);
    });
    if (ready.length === 0) {
      // 依存先が読み取りとして存在しない(または循環している)。宣言順のまま残す。
      ordered.push(...remaining);
      break;
    }
    for (const read of ready) {
      ordered.push(read);
      emitted.add(read.entity);
    }
    remaining = remaining.filter((read) => !ready.includes(read));
  }
  return ordered.map((read) => ({
    entity: read.entity,
    table: read.table,
    idFrom: read.idFrom,
    fields: [...read.fields].sort((a, b) => a.localeCompare(b)),
  }));
}

/** その読み取りが値を要する先(`context` の参照元の集約。依存が無ければ null)。 */
function dependsOn(read: Resolved): string | null {
  return read.idFrom.kind === 'context' ? (read.idFrom.ref.split('.')[0] ?? null) : null;
}
