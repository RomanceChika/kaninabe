/**
 * 正規表現に入れる値の特殊文字をエスケープする(ASVS V1.2.9)。
 *
 * 利用者の値から正規表現を組むときは、**必ずこの部品を通す**。lint の `layer/no-dynamic-regexp` は、`new RegExp(…)` の
 * パターンが静的(リテラル・固定の定数)か、`${escapeRegExp(…)}` の置換だけで組まれている形だけを通す。
 */

/**
 * 正規表現の特殊文字(`\ ^ $ . * + ? ( ) [ ] { } |` と `-` `/`)を、その文字そのものに一致するようにエスケープする。
 *
 * `-` は文字クラスの中で範囲になるので、`u` フラグの下でも通る `\x2d` にする。
 *
 * @param value - 正規表現の一部にそのまま入れたい文字列
 * @returns 特殊文字をエスケープした文字列
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&').replace(/-/g, '\\x2d');
}
