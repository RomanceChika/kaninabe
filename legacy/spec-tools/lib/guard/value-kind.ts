/**
 * 比較のときに問題になる**値の種別**(値域。lang 層 — ガード式の言語の一部)。
 *
 * ガード式の型検査(`comparison-typing.ts`)が読み、フィールド型からの写像
 * (`lib/model/field-values.ts` = model)も読む。model は lang を読めるので、この語彙は
 * ガード式の言語の側に置く(kernel と lang は互いを読まないので、kernel には置けない)。
 * `field-values.ts` は同じ名前で型だけを再輸出する(読む側の import は変わらない)。
 */

/**
 * 比較のときに問題になる**値の種別**(値域)。
 *
 * `FieldType` は 11 種あるが、「その欄を何と比べられるか」「SQL に写したとき同じ判定になるか」
 * の観点では 5 つに畳める。ガード式の型検査(V2)と SQL 翻訳(lib/sql)の両方がこの 1 つの
 * 分類だけを見る —— 型の対応表を 2 か所に書くと、片方だけが直る事故になる。
 *
 * - `boolean` … `==` / `!=` だけ。順序も `in` も TS の評価器が**常に不明**にする(= 常に不成立)
 * - `number`  … 数値リテラルとだけ比べられる
 * - `datetime`… ISO 8601 の日付・日時リテラルとだけ比べられる(SQL では timestamptz / date)
 * - `text`    … 記号・文字列リテラルと比べられる。**順序比較は照合順序に依る**(SQL は `collate "C"`)
 * - `opaque`  … 同一性しか無い値(uuid / ref)。順序で比べても意味が無く、SQL では照合順序も持たない
 */
export const VALUE_KINDS = ['boolean', 'number', 'datetime', 'text', 'opaque'] as const;

/** 値の種別。 */
export type ValueKind = (typeof VALUE_KINDS)[number];
