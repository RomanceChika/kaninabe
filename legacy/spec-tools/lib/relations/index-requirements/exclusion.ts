/**
 * 既存の索引による除外(索引候補 → data_table に新たに宣言が要る索引)。
 *
 * 主キー(`id` 単体)・data_table が宣言する一意制約・FK 列 1 本だけの索引と**列がちょうど
 * 一致する**候補は、新たに要求しない(`excludeDeclared` が data_table モデルを見て行う。
 * 候補を作る `index-derivation.ts` は data_table の索引宣言を知らない — 要求元の宣言だけで閉じた計算にするため)。
 */

import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import { PRIMARY_KEY_COLUMN } from './index-derivation.js';
import type { IndexRequirement } from './types.js';

/** 指定した列の並びとちょうど一致する data_table の索引を探す。 */
function findMatchingDeclaredIndex(
  table: DataTableSpec | undefined,
  columns: readonly string[],
): { readonly unique: boolean; readonly isForeignKeyColumn: boolean } | null {
  if (table === undefined) return null;
  const index = table.indexes.find(
    (candidate) => candidate.on.length === columns.length && candidate.on.every((c, i) => c === columns[i]),
  );
  if (index === undefined) return null;
  const isForeignKeyColumn =
    index.on.length === 1 && table.foreignKeys.some((fk) => fk.column === index.on[0]);
  return { unique: index.unique, isForeignKeyColumn };
}

/** テーブル名で data_table を探す。 */
function findDataTable(dataTables: DataTableSpecModel, table: string): DataTableSpec | undefined {
  return dataTables.tables.find((spec) => spec.table === table);
}

/**
 * 候補の**先頭から連続する列**が、部分述語を持たない(全行に効く)一意な索引(主キー含む)と
 * ちょうど一致するか。
 *
 * 一致すれば、その一意な組がテーブル全体で高々 1 行にしか現れないということであり、
 * 残りの列(等値条件でも並び順のための列でも)は既に区別する必要が無い
 * (venues の例: `name` が一意なので `venue_list` の並び順 `name, id` は `id` を足さなくても
 * 同名の行が 2 つ以上現れず、並びは `name` だけで完全に決まる。`venues_name_unique` が
 * 既にこの役目を果たす)。**部分一意索引(`where` 付き)は対象外**(invitations の
 * `issuer_open_unique` は `state = 'issued'` の行だけを縛るので、閉じた窓口を含む
 * 全体では一意性が成り立たない)。
 */
function coveredByUniquePrefix(table: DataTableSpec | undefined, columns: readonly string[]): boolean {
  if (table === undefined) return false;
  if (columns[0] === PRIMARY_KEY_COLUMN) return true; // 主キー(id)は常に先頭で一意
  for (let length = 1; length <= columns.length; length += 1) {
    const prefix = columns.slice(0, length);
    const matches = table.indexes.some(
      (index) =>
        index.unique &&
        index.where === undefined &&
        index.on.length === prefix.length &&
        index.on.every((c, i) => c === prefix[i]),
    );
    if (matches) return true;
  }
  return false;
}

/**
 * 「主キー・一意制約・FK に既にある索引」による除外を適用し、data_table に新たに要る索引だけを返す。
 *
 * 除外は 2 種類ある:
 * 1. **先頭一致の一意性**(`coveredByUniquePrefix`): 候補の先頭何列かが既に一意なら、
 *    残りの列を含む複合索引は要らない。
 * 2. **列がちょうど一致する既存索引**: 候補の列並びがそのまま一意制約または
 *    FK 列 1 本だけの索引と一致するなら、新たに要らない(前方一致では除外しない —
 *    既存の単独索引が候補の先頭だけを覆っていても、並び順まで含めた複合索引は別に要る。
 *    例: workshops_organizer_id_idx(organizer_id)があっても workshop_my_list には
 *    (organizer_id, starts_at, id)が要る)。
 */
export function excludeDeclared(
  candidates: readonly IndexRequirement[],
  dataTables: DataTableSpecModel,
): readonly IndexRequirement[] {
  return candidates.filter((candidate) => {
    const table = findDataTable(dataTables, candidate.table);
    if (coveredByUniquePrefix(table, candidate.columns)) return false;
    const declared = findMatchingDeclaredIndex(table, candidate.columns);
    if (declared === null) return true;
    return !(declared.unique || declared.isForeignKeyColumn);
  });
}
