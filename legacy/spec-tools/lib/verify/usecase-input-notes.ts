/**
 * ユースケース検証(Y 群)が読むテーブル仕様(data_table)が使えなかったことの報告(Y8・Y10・Y12)。
 *
 * Y8(引数が規約で解決できる)・Y10(実行計画が仕様から決まる)・Y12(複合 RPC に写せる)は、保存点の手順が呼ぶ RPC を
 * data_table から引く。以前は `UsecaseContext.dataTables?` が任意の欄で、欄が無い・読めないのどちらでも**何も言わずに通った**。
 * 今は入力の状態(未選択 / 阻害 / 読込済み)で持ち、使えないとき 3 つとも判定を出さず(RPC は data_table にしか無く、
 * 無い入力から「RPC が無い」を導くと見ていないものを見たと報告する)、見ていないことをここで行にして言う。
 *
 * **未選択も行を出す**(阻害と同じ)。判定の母集合は保存点(usecase_spec)で、data_table はその**裏づけを見る先**なので、
 * 採っていなければ母集合が空なのではなく「見られない」(`domain-input-notes.ts` の V17 / V19 と同じ側。取り違えると
 * 「保存点があるのに RPC の接地を見ていない」緑が、採っていない製品で黙って出る)。
 * **ただし保存点が 1 件も無ければ行は出ない**(見ていないものが無い)。出すときは対象の保存点(`{ユースケース名}.{保存点 ID}`)を並べる。
 * **読み込みの error は各種類のローダーの 0 番(T0)が 1 回だけ出す**ので、ここは進捗の行であって Finding ではない。
 *
 * 群が動くとき(ユースケース仕様が読み込めているとき)だけ呼ぶ。読めていなければ Y 群自体が「スキップしました」と言う。
 */

import { unusableOf, type CatalogInput, type InputGapNote } from '../kernel/input-state.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';
import { describeInputGapNote } from './check-run-report.js';
import type { ProgressLog } from './group-contract.js';

/** data_table に依る Y 群の検査 1 本(検査器 ID と、data_table が使えないと見ていないこと。文末の句点は付けない)。 */
export interface UsecaseDataTableDependent {
  readonly id: string;
  readonly consequence: string;
}

/** data_table に依る Y 群の検査(ID 順)。 */
export const USECASE_DATA_TABLE_DEPENDENTS: readonly UsecaseDataTableDependent[] = [
  { id: 'Y8', consequence: '保存点の手順が呼ぶ RPC の実在と、その全引数が規約で解決できるかは見ていません' },
  { id: 'Y10', consequence: '保存点の実行計画(permit が要る事実の供給元)が決まるかと、不変条件の実行漏れは見ていません' },
  { id: 'Y12', consequence: '保存点が複合 RPC に写せるか(供給元と再送の読み直し)は見ていません' },
];

/** 保存点の鍵(`{ユースケース名}.{保存点 ID}`。画面の `usecases:` と同じ綴り)の全数。 */
function saveKeys(usecases: UsecaseSpecModel): string[] {
  return usecases.usecases.flatMap((usecase) => usecase.saves.map((save) => `${usecase.name}.${save.id}`));
}

/**
 * data_table が使えなかったことを、読む検査ごとの記録にする(使えるなら・保存点が 1 件も無ければ空)。
 *
 * @param usecases 読み込んだユースケース仕様
 * @param dataTables テーブル仕様の入力の状態
 */
export function usecaseInputGapNotes(
  usecases: UsecaseSpecModel,
  dataTables: CatalogInput<DataTableSpecModel>,
): readonly { readonly id: string; readonly note: InputGapNote }[] {
  const gap = unusableOf(dataTables, 'data_tables');
  const subjects = saveKeys(usecases);
  if (gap === null || subjects.length === 0) return [];
  return USECASE_DATA_TABLE_DEPENDENTS.map((dependent) => ({
    id: dependent.id,
    note: { gap, consequence: dependent.consequence, subjects },
  }));
}

/**
 * data_table が使えなかったことを実行ログへ残す(使えるなら何も言わない)。
 *
 * @param usecases 読み込んだユースケース仕様
 * @param dataTables テーブル仕様の入力の状態
 * @param log 実行ログ
 */
export function logUsecaseInputGaps(
  usecases: UsecaseSpecModel,
  dataTables: CatalogInput<DataTableSpecModel>,
  log: ProgressLog,
): void {
  for (const entry of usecaseInputGapNotes(usecases, dataTables)) log(describeInputGapNote(entry.id, entry.note));
}
