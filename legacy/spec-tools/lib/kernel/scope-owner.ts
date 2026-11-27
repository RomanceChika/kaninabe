/**
 * 実装の範囲(`product.md` の `implemented`)の**持ち主**と、不在の指摘に付ける印(kernel 層 — 全層が読む共通語)。
 *
 * 印は「仕様 X が名指す Y が無い」という**純粋な不在の error**だけに付け、仕様の持ち主(`kind` と `id`)を載せる。
 * 最後の仕分け(`scope/partition.ts`)が、範囲の外の持ち主の印つき error を報告へ移す。印の無い指摘は絶対に移らない
 * (付け忘れは error のまま = 厳しい側に倒れる)。
 *
 * **印の欄を書くのはこの `absentFor()` だけ**で、検査はこれを呼んで付ける(値の export もこの 1 つに固定。
 * `scope-sites-parity.test.ts` が見張る)。
 */

import type { Finding } from './finding.js';

/** 持ち主の種類(仕様の id の空間)。`catalog` は 1 枚のカタログ(`job-catalog` など)全体。 */
export type ScopeOwnerKind = 'action' | 'query' | 'screen' | 'table' | 'usecase' | 'scan' | 'invariant' | 'catalog';

/** 実装の範囲の持ち主 1 つ(`implemented` に書く id と対応する)。 */
export interface ScopeOwner {
  readonly kind: ScopeOwnerKind;
  readonly id: string;
}

/**
 * 不在の指摘に、範囲の持ち主の印を付ける(印を書く唯一の入口)。
 *
 * @param owner 不在を名指している仕様の持ち主
 * @param finding 不在の指摘(error)
 * @returns 印つきの指摘(元は変えない)
 */
export function absentFor(owner: ScopeOwner, finding: Finding): Finding {
  return { ...finding, absentFor: { kind: owner.kind, id: owner.id } };
}
