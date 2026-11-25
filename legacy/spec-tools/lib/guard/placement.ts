/**
 * 「その語をそこに書いてよいか」(置き場)の断り文と、その直し方(束 ㉒)。
 *
 * パーサー(具象)と検証器(DI 越しに `GuardServices` だけを知る側)の**両方**が同じ字面を
 * 使えるように、ここに置く —— 断り文を片方にだけ持つと、検証器は「どのパース失敗が置き場の
 * 誤りなのか」を文字列の当てずっぽうで見分けることになる。
 *
 * 置き場の規則そのものは `parser.ts`(既定で閉じた口)が執行する。ここが持つのは字面だけである。
 */

import type { GuardParseError } from './ast.js';

/**
 * `is null` / `is not null` を閉じている口で書かれたときの断り文。
 *
 * パーサーが `GuardParseError.message` にそのまま載せ、検証器はこの字面で
 * 「置き場の誤りである」ことを見分ける。
 */
export const NULL_TEST_CLOSED =
  'is null / is not null を書けるのは不変条件の formal だけです' +
  '(ガード・when・binding・読み取り経路の filters には書けません)';

/** 置き場の誤りだったときに、対処へ足す 1 文。 */
const NULL_TEST_HINT =
  '「空かどうか」を問う条件は、その集約の invariant_spec に不変条件として書いてください' +
  '(`formal: { type: check, expr: … is null }`)。' +
  'ここに書ける形に畳めるなら、状態や値の比較で書き直す道もあります。';

/**
 * パース失敗 1 件に対して、対処へ足す 1 文を返す。
 *
 * 置き場の誤り以外では空文字を返す —— どのパース失敗にも同じ注意書きを付けると、
 * 3 点セットの「対処」が読み飛ばされる側に寄る。
 *
 * @param error パース失敗の詳細
 * @returns 足す 1 文(足すものが無ければ空文字)
 */
export function placementHint(error: GuardParseError): string {
  return error.message === NULL_TEST_CLOSED ? ` ${NULL_TEST_HINT}` : '';
}
