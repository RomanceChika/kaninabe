/**
 * 読む量の 4 枚と、章頭の数の約束(箇条)。
 *
 * 4 枚の材料(`BudgetCards`)は層に依らない形で、集約の章は `face-facts.ts` の集計から、タスク・通知・ジョブ・画面の章は
 * `block-reading.ts` の `chapterReading` から数を渡す。中身(箇条)の文は層ごとに違うので、呼ぶ側が書く。
 * 数えられないもの(検証の結果・基点が渡されていない)は「未集計」「—」と書き、0 とは書かない。
 */

import { requiredOf, type ReadingSum, type ReaderLoad } from './block-reading.js';

/** 読み手 1 人ぶんの受け入れの件数(理由つき + まだ通していない)。 */
export function acceptOf(load: ReaderLoad): number {
  return load.reasoned + (load.pending ?? 0);
}

/** 必読の中身のうち、読み手ごとの 2 行(業務 / 開発者)。 */
export function readerLines(sum: ReadingSum, notes: { readonly business: string; readonly developer: string }): string[] {
  const { business, developer } = sum.byReader;
  return [
    `業務 ${requiredOf(business)} 件。受け入れ ${acceptOf(business)} 件。${notes.business}`,
    `開発者 ${requiredOf(developer)} 件。受け入れ ${acceptOf(developer)} 件。${notes.developer}`,
  ];
}

/** まだ通していない分の言い方(件数が引けないときは未集計)。 */
export function pendingWords(pending: number | null): string {
  return pending === null ? 'まだ通していない分は未集計(検証の結果が渡されていない)' : `まだ通していない分 ${pending} 件`;
}

