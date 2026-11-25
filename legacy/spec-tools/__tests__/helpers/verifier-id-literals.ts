/**
 * 検査 ID の綴り(`T8` のような英大文字 1〜2 字と数字)が、検査器のコードの文字列リテラルとして現れる集合を取る(**テストの道具**)。
 *
 * 検査 ID の実在の正は全検査の表(`lib/compose/all-checks.ts`)である。この走査は表の**登録漏れ**を見つけるための突き合わせ用で、
 * コードに ID として書かれている綴りが表に載っているかを構造テスト(`gates/check-registry.test.ts`)が見る
 * (検査を足したのに群の登録に足し忘れた形を捕る)。
 *
 * 純関数。ファイルを読むのは `verifier-id-scan.ts` である。
 */

import { VERIFIER_ID_SHAPE } from '../../lib/model/extension/parse-candidates.js';

/** 引用符で囲まれた英数字の短い綴り(検査 ID の候補)。 */
const QUOTED_ID = /(['"`])([A-Za-z0-9]{2,3})\1/g;

/**
 * ソースの本文の並びから、検査 ID の形をした文字列リテラルを集める。
 *
 * @param sources ソースの本文
 * @returns 検査 ID として現れた綴りの集合
 */
export function collectVerifierIds(sources: readonly string[]): ReadonlySet<string> {
  const found = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(QUOTED_ID)) {
      const word = match[2] ?? '';
      if (VERIFIER_ID_SHAPE.test(word)) found.add(word);
    }
  }
  return found;
}
