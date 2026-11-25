/**
 * 仕様が書く**生成 TS にそのまま置かれる名前**の文法(読み込みで検査する純粋関数。R17)。
 *
 * SQL に置かれる識別子と断片の文法は `sql-fragment.ts` が持つ。ここは生成される TS の識別子・import の指定子・
 * 経路の文字列に置かれる名前を閉じる —— 生成器はこれらを引用符で囲まず(識別子)、または `'…'` の中にそのまま
 * 置く(import の指定子)ので、`'` や `;` を含む値が仕様に書けると、敵対的な仕様の PR が生成物にコードを入れられる。
 *
 * どれも違反の**理由を 1 行**で返す(null なら書いてよい)。**アプリの語彙は 1 語も持たない。**
 */

/** 型・ポートの名前(PascalCase)。 */
const TYPE_NAME = /^[A-Z][A-Za-z0-9]*$/u;

/** 値・関数の名前(camelCase)。 */
const VALUE_NAME = /^[a-z][A-Za-z0-9]*$/u;

/** HTTP の入口の経路(`/` で区切った小文字・数字・`_`・`-` の段)。 */
const ROUTE_PATH = /^(?:\/[a-z0-9][a-z0-9_-]*)+$/u;

/** リポジトリ内の TS モジュールの相対パス(段は英数字・`_`・`-`・`.` で、英数字か `_` から始まる)。 */
const MODULE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*\.ts$/u;

/** 型・ポートの名前の違反の理由。 */
export function typeNameProblem(value: string): string | null {
  return TYPE_NAME.test(value) ? null : '型の名前は英大文字から始まる英数字だけで書きます(^[A-Z][A-Za-z0-9]*$)';
}

/** 値・関数の名前の違反の理由。 */
export function valueNameProblem(value: string): string | null {
  return VALUE_NAME.test(value) ? null : '関数の名前は英小文字から始まる英数字だけで書きます(^[a-z][A-Za-z0-9]*$)';
}

/** HTTP の入口の経路の違反の理由。 */
export function routePathProblem(value: string): string | null {
  return ROUTE_PATH.test(value) ? null : '経路は /段/段 の形で、段は小文字・数字・_・- だけで書きます(引用符・空白・? # は書けません)';
}

/** TS モジュールの相対パスの違反の理由。 */
export function modulePathProblem(value: string): string | null {
  // 段は英数字か _ から始まるので、. や .. の段も書けない。
  return MODULE_PATH.test(value) ? null : 'モジュールのパスは英数字か _ から始まる段を / で区切り、.ts で終えます(引用符・空白・先頭の /・. や .. の段は書けません)';
}
