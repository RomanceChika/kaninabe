/**
 * エンティティ名 → 物理テーブル名の既定規則(単純な英語の複数形化)。
 *
 * 規約の正は ARCH-SP-BE-0001「ポリシーの命名規約」。仕様のエンティティ名は単数形、
 * DB のテーブル名は複数形であり、規則で導けない名前だけ entity_spec の `table:` で上書きする。
 * RLS 期待表の生成(code-rls-expectations)と data_table の一貫性検査(T1)が同じ規則を
 * 共有するため、実装をここに 1 か所だけ置く(PRIN-0007)。
 */

/** 英語の複数形化で `-es` を付ける語尾(sibilant)。 */
const SIBILANT_SUFFIX = /(?:s|x|z|ch|sh)$/;

/** 子音 + y で終わる語尾(`-y` → `-ies`)。 */
const CONSONANT_Y_SUFFIX = /[^aeiou]y$/;

/**
 * エンティティ名をテーブル名にする既定の規則。
 *
 * @param entity エンティティ名(スネークケース・単数形)
 * @returns 複数形化したテーブル名
 */
export function pluralizeEntity(entity: string): string {
  if (SIBILANT_SUFFIX.test(entity)) return `${entity}es`;
  if (CONSONANT_Y_SUFFIX.test(entity)) return `${entity.slice(0, -1)}ies`;
  return `${entity}s`;
}
