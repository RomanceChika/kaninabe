/**
 * 読めずにモデルへ入れなかった data_table(`DataTableSpecModel.droppedTables`)の**名前の扱い**。
 *
 * 落とした表の中身(test_cases など)は、一部でも信用しない(欠けた表の宣言から「無いこと」を言うと偽の指摘になる)。
 * 代わりに**名前だけ**を使う: 表のファイルは `{table}.md`(複数形の表名)、フロントマターの `entity` は単数形の entity 名で、
 * その表に属するテストケース ID は、**表の ID の系統の接頭辞**のあとに表名か entity 名(大文字)を 1 区切りとして含む。
 *
 *   - `TC-TABLE-{TABLE}-001` / `TC-DDL-{TABLE}-001` / `TC-RLS-{TABLE}-001` — 表名(複数形)
 *   - `TC-EQ-{ENTITY}-0001` — entity 名(単数形。同値の見張りの宣言)
 *
 * 検査は、この名前空間の `@tc` を「宣言を見られていない」として扱い、偽の orphan にも「宣言が無い」にもしない。
 * **接頭辞で絞る**のは、別の系統の ID(保証台帳の `TC-GUAR-{名前}-…`・画面の `TC-SCREEN-{名前}-…` など)が、
 * たまたま同じ綴りの区切りを持つだけで表の名前空間に吸われないため。
 */

/**
 * 表の ID の系統の接頭辞(大文字)。`entity` が真の系統は、表名に加えて entity 名も名前空間の名前になる。
 * 表の仕様ファイルの `test_cases` の ID の系統の全数と一致することをテストが見る(系統が増えたのにここに足し忘れると、その系統の `@tc` が落とした表の名前空間に入らない)。
 */
export const TABLE_ID_FAMILIES: readonly { readonly prefix: string; readonly entity: boolean }[] = [
  { prefix: 'TC-TABLE-', entity: false },
  { prefix: 'TC-DDL-', entity: false },
  { prefix: 'TC-RLS-', entity: false },
  { prefix: 'TC-EQ-', entity: true },
];

/**
 * 落とした表のファイル(置き場からの相対パス)から表の名前を取り出す(`sub/gadgets.md` → `gadgets`)。
 *
 * @param file 落とした表のファイル
 */
export function droppedTableName(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -'.md'.length) : base;
}

/**
 * テストケース ID が、落とした表のどれかの名前空間に入るか(入るなら、その表の名前)。
 *
 * 表の ID の系統の接頭辞(`TC-TABLE-` / `TC-DDL-` / `TC-RLS-` / `TC-EQ-`)を持つ ID だけを見る。接頭辞のあとに、
 * 表名(`TC-EQ-` は entity 名も)を `-` で区切られた 1 区切りとして含む ID を、その表のものとみなす
 * (`gadget` の名前空間に `gadget_parts` の ID は入らない)。
 *
 * @param tcId テストケース ID
 * @param droppedFiles 落とした表のファイル
 * @param entities 落とした表のファイル → フロントマターの entity 名(`DataTableSpecModel.droppedEntities`。読めなかった表は載らない)
 */
export function droppedTableOfTcId(
  tcId: string,
  droppedFiles: readonly string[],
  entities: Readonly<Record<string, string>> = {},
): string | null {
  const upper = tcId.toUpperCase();
  const family = TABLE_ID_FAMILIES.find((candidate) => upper.startsWith(candidate.prefix));
  if (family === undefined) return null;
  const padded = `-${upper.slice(family.prefix.length)}-`;
  for (const file of droppedFiles) {
    const name = droppedTableName(file);
    const names = family.entity ? [name, entities[file] ?? ''] : [name];
    if (names.some((candidate) => candidate !== '' && padded.includes(`-${candidate.toUpperCase()}-`))) return name;
  }
  return null;
}
