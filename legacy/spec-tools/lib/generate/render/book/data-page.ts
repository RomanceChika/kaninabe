
import type { SpecModel } from '../../../model/types.js';
import type { DataTableSpec, DataTableSpecModel } from '../../../model/data/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { bookLayout } from './face-scope.js';

/** 章の題。 */
export const DATA_TITLE = 'データの置き場(テーブル仕様)';

/** ページの導入(定型)。 */
export const LEAD =
  'テーブルごとの DB 固有の実装判断(インデックス・外部キーの ON DELETE・トリガ・関数の帰属)は' +
  'テーブル仕様(data_table)が持つ。列と型の正は entity_spec である。' +
  'ここは表の一覧と、各テーブル仕様に手書きで残された標識(異議を出す場所)を読む場所である。';

/** 集約の表の標識を章に寄せたとき(全章に展開しているとき)の補足。 */
export const NESTED_LEAD =
  '集約に結ばれた表の標識は、その集約の章の受け入れに置いた(従属する集約の表は、親の章に置く)。' +
  'ここに残るのは、仕組みの表と、集約に結ばれない表だけである。';

/** 節の見出しと、一覧の表の見出し(定型)。 */
export const LIST_HEADING = 'テーブル一覧';
export const LIST_HEADERS: readonly string[] = ['テーブル', '種類', '標識(本)', '仕様ファイル'];

/** 種類の列(集約の表・仕組みの表・集約ではない表)。 */
export function kindText(table: DataTableSpec): string {
  if (table.entity !== undefined) return `集約 ${table.entity} の表`;
  if (table.framework !== undefined) return `仕組みの表(${table.framework})`;
  return '集約ではない表';
}

/**
 * この章が持つ表(仕組みの表と、集約に結ばれない表)。集約に結ばれた表は、その集約の章が持つ(全章に展開しているとき)。
 *
 * @param available 読み込み済みのテーブル仕様
 */
export function ownTables(model: SpecModel, ctx: GenerateContext, available: DataTableSpecModel): readonly DataTableSpec[] {
  const layout = bookLayout(model, ctx);
  return available.tables.filter((table) => layout.tableAggregateOf(table.location.file) === undefined);
}
