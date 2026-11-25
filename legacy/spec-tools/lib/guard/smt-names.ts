/**
 * SMT-LIB 上の**名前の付け方**(引用記号・リテラル定数・自由な原子)。
 *
 * smt.ts と別に置くのは、名前の付け方が**写像の呼び出し側が差し替えられる唯一の軸**だからである。ガード式 1 本を判定するとき
 * (V9 / V10)は仕様のパスがそのまま名前でよいが、遷移を時間軸に展開するとき(lib/reach)は
 * 同じパスが手ごとに別の変数になる(`workshop.state` → `workshop.state@3`)。その差は
 * `SmtRename` 1 つに閉じる。
 *
 * **リテラル定数には付け替えを適用しない。** 同じ綴り(`2026-04-01`)は、どの手で現れても
 * 同じ 1 つの定数でなければ「時刻の綴りが手ごとに別の値を指す」世界になってしまう。
 */

/** SMT 上の名前の付け替え(変数のパスと、自由な `Bool` に逃がした原子の鍵に適用する)。 */
export type SmtRename = (name: string) => string;

/** 付け替えない(既定)。 */
export const IDENTITY_RENAME: SmtRename = (name) => name;

/**
 * SMT の引用記号で包む。`|` と `\` は引用記号の中に置けないので別の字に逃がす。
 *
 * @param name 包む名前
 * @returns 引用記号つきのシンボル
 */
export function symbol(name: string): string {
  return `|${name.replace(/\|/g, '⎮').replace(/\\/g, '⧵')}|`;
}

/**
 * 数値でないリテラルに割り当てる自由定数の名前(付け替えの対象外)。
 *
 * @param text リテラルの綴り
 * @returns シンボル
 */
export function literalSymbol(text: string): string {
  return symbol(`lit!${text}`);
}

/**
 * 自由な `Bool` に逃がした原子の名前。
 *
 * @param key 原子の正規化キー
 * @param rename 名前の付け替え(展開するときは手ごとに別の名前になる)
 * @returns シンボル
 */
export function atomSymbol(key: string, rename: SmtRename): string {
  return symbol(`atom!${rename(key)}`);
}

/**
 * 欄が**空である**ことを表す相棒の `Bool` の名前(束 ㉒)。
 *
 * 値の変数(`|workshop.venue_id|`)とは別の軸であり、値の側のドメインには手を入れない ——
 * 「空」はドメインの値ではないからである。付け替えは変数と同じく適用する(時間軸に展開する
 * ときは手ごとに別の相棒になる)。
 *
 * @param path 欄のパス
 * @param rename 名前の付け替え
 * @returns シンボル
 */
export function nullSymbol(path: string, rename: SmtRename): string {
  return symbol(`null!${rename(path)}`);
}
