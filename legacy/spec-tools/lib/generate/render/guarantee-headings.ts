/**
 * 保証台帳(guarantees.md)の生成ブロックの見出し。
 *
 * 見出しの綴りの正は**ここ 1 か所**である。保証台帳の本文を出す生成器(`guarantee-body.ts`)と、
 * その表を「書き方の例」の章に引く目録(`book/examples-page-catalog-rest.ts`)の両方がこれを参照する。
 * 別々に書くと、片方だけ直したときに章の抜粋が見出しを見失う。
 */

/** 保証の全数の表の見出し(`### ` を除いた本文)。 */
export const GUARANTEE_TABLE_HEADING = '保証の全数(見張りテストを宣言していない保証は無い — enforced は canaries が必ず 1 つ以上ある)';
