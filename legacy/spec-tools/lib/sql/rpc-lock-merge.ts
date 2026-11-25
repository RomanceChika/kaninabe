/**
 * 先掴みの計画(`rpc-body-lock.ts` の `lockPlan`)の**同じ表の文の畳み**(点検 fix26 5 回目 D26e-1。持ち主は lockPlan で、ここはその 1 段の部品)。
 *
 * 同じ表の 2 行を別の文で掴むと、掴む順が id ではなく文の順で決まる。2 本の txn が互いの行を逆の文の順で持つと 40P01 の輪になる
 * (実例: 参照の列の付け替えの編集が、トリガの掴みの宣言で書いた後の新しい親を排他で、ガードで書く前の古い親を共有で、別の文で掴んだ。
 * F1 → F2 と F2 → F1 の同時)。同じ表に文が 2 つ以上あれば、**強さを問わず 1 文に畳む** —— その表の行を各文の選び方の和で選び、
 * id の昇順に、強い方(どれかが排他なら排他、全部が共有なら共有)で掴む。共有だけの文どうしは互いに待たないが、別の txn の排他(2 行を
 * 1 文で id の順)を間に挟むと輪になる(点検 fix26 6 回目 D26f-1: 招待の遷移が発行者と実行者の 2 行を共有の 2 文で掴み、実行者と対象の
 * 2 行を 1 文で排他に掴むメンバーの編集と、実行者の id が発行者より小さいときに 40P01)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { LockTarget } from './rpc-body-lock.js';

/** 畳んだ文の別名の前置(`lm0` / `lm1` …。ほかのどの別名とも衝突しない)。 */
const MERGED_ALIAS_PREFIX = 'lm';

/**
 * 同じ表の文を畳む(強さを問わず。並びは最初に現れた文の位置。表名の順の並べ替えは呼ぶ側)。
 *
 * @param targets 同じ行を畳んだ後の計画
 * @returns 同じ表に文が 2 つ以上あれば 1 つに畳んだ計画
 */
export function mergeSameTable(targets: readonly LockTarget[]): readonly LockTarget[] {
  const groups = new Map<string, LockTarget[]>();
  for (const target of targets) groups.set(target.table, [...(groups.get(target.table) ?? []), target]);
  let merged = 0;
  const out: LockTarget[] = [];
  for (const target of targets) {
    const group = groups.get(target.table) ?? [target];
    if (group.length < 2) {
      out.push(target);
      continue;
    }
    if (group[0] !== target) continue; // 畳んだ文は最初の文の位置に 1 つだけ置く
    const alias = `${MERGED_ALIAS_PREFIX}${String(merged)}`;
    merged += 1;
    const picks = group.map((row) => `select ${row.alias}.id from ${row.from.join(', ')} where ${row.where.join(' and ')}`);
    out.push({
      table: target.table,
      key: group.map((row) => row.key).join('+'),
      alias,
      from: [`public.${target.table} ${alias}`],
      where: [`${alias}.id in (${picks.join(' union ')})`],
      order: `${alias}.id`,
      mode: group.some((row) => row.mode === 'update') ? 'update' : 'share',
      ids: group.flatMap((row) => row.ids),
      ...(group.every((row) => row.createKey === true) ? { createKey: true as const } : {}),
    });
  }
  return out;
}
