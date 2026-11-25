/**
 * 列の既定値の式が **`nextval('…')` で名指す器の名前**を取り出す 1 本。
 *
 * 置き場の判定(`ddl-placement.ts`)と接地の検査(T13)が同じ読み方をしなければならない ——
 * 別々に正規表現を持つと「検査は通るのに出る場所が違う」が起きる。だから名前の読み方は
 * ここ 1 か所にある。
 *
 * 印字の揺れを吸収する: `pg_get_expr` はスキーマ修飾や `::regclass` を付けて印字するので、
 * 宣言の側の素の名前と比べる前に落とす。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataTableSpec } from '../model/data/types.js';

/** `nextval('…')` / `nextval('…'::regclass)` から名前を取り出す。 */
const NEXTVAL = /nextval\(\s*'([^']+)'/g;

/**
 * スキーマ修飾と引用符を落として素の名前にする。
 *
 * @param raw `nextval('…')` の中身
 * @returns 宣言の側と比べられる素の名前
 */
export function bareSequenceName(raw: string): string {
  const withoutSchema = raw.includes('.') ? (raw.split('.').pop() ?? raw) : raw;
  return withoutSchema.replace(/"/g, '').trim();
}

/**
 * その表の `defaults` が名指す器の名前の全数(重複は畳む)。
 *
 * @param table テーブル仕様
 * @returns 名指された器の名前(現れた順)
 */
export function nextvalNames(table: DataTableSpec): readonly string[] {
  const names: string[] = [];
  for (const expression of Object.values(table.defaults)) {
    for (const match of expression.matchAll(NEXTVAL)) {
      const name = bareSequenceName(match[1] ?? '');
      if (name !== '' && !names.includes(name)) names.push(name);
    }
  }
  return names;
}
