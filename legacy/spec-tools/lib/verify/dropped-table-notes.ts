/**
 * 読めずに落とした data_table の名前(操作の属性の導出に使う検査が**見ていない**ことを、表の名前つきで言うための材料)。
 *
 * 画面・ユースケース・UX の検査は、確認が要るか(`confirmRequired`)を操作の属性の導出から引く。導出は集約の「唯一の複合 RPC」
 * (data_table の `functions`)を読むので、**落とした表**(行を落としてモデルへ入れなかった表・ファイル全体が読めなかった表)の
 * 宣言はここに届かない。届かない表を「複合 RPC は無い」と読んで導出すると、確認が要る操作を要らないと数える。
 * 検査は部分のモデル(読めた表)のまま回し、**落とした表の分は見ていない**ことを行で言う(`operation-input-notes.ts`。
 * 他の材料の阻害と同じ 1 本の口)。ここはその行が対象に挙げる表の名前だけを持つ。
 */

import type { CatalogInput } from '../kernel/input-state.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import { droppedTableName } from '../model/data/dropped-tables.js';

/**
 * 落とした表の名前(阻害のうち、読めずにモデルへ入れなかった表があるときだけ。無ければ空)。
 *
 * @param dataTables テーブル仕様の入力の状態
 */
export function droppedTableSubjects(dataTables: CatalogInput<DataTableSpecModel>): readonly string[] {
  const files = dataTables.state === 'blocked' ? (dataTables.partial?.droppedTables ?? []) : [];
  return files.map(droppedTableName);
}
