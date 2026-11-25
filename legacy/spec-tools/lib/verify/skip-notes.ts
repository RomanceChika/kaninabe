/**
 * 「検査の範囲が縮んだこと」を最後の 1 行まで運ぶための、進捗報告の横取り。
 *
 * **なぜ要るのか。** `app/` を読めない環境では 12 の下位検査が飛ぶ。飛んだことは各群の
 * 進捗行に出るが、**最後のサマリは `検証結果: 警告 25 件` としか言わない**
 * (検査の漏れ探し 2026-09-12 §3)。実行ログを流し読みする運用では、検査の範囲が縮んだまま緑になった
 * 実行と、全部を見て緑になった実行が見分けのつかない形になる。ここが数えて、サマリに 1 行足す。
 *
 * 判定の主は進捗行に `スキップ` の語が含まれるかである。群の実装をすべて書き換えず
 * に済ませるための割り切りであり、**この語を進捗行で他の意味に使わない**ことが規約になる
 * (現に「〜はスキップしました。」「〜はスキップ)」以外の用法はこの体系に無い)。
 *
 * もう 1 つ、入力の状態を報告する検査の**未実施 / 阻害**の行(`A13: 未実施 — …`。`check-run-report.ts`)も
 * 同じく範囲が縮んだ報告なので拾う(語は「スキップ」でなくてよい。行の頭の形で判定する)。
 */

import { isCheckRunNote } from './check-run-report.js';
import type { ProgressLog } from './group-contract.js';

/** 進捗行が「検査を飛ばした」と報告するときの語。 */
export const SKIP_MARK = 'スキップ';

/** 進捗行が飛ばしたことを報告しているか。 */
export function isSkipNote(line: string): boolean {
  return line.includes(SKIP_MARK) || isCheckRunNote(line);
}

/** collectSkipNotes の戻り値(横取りした報告先と、貯めた行)。 */
export interface SkipCollector {
  /** 群に渡す報告先(元の報告先へ素通しする)。 */
  readonly log: ProgressLog;
  /** 貯まったスキップの行(実行後に読む)。 */
  readonly notes: readonly string[];
}

/**
 * 進捗報告を横取りして、スキップを示す行だけを貯める。
 *
 * @param inner 元の報告先(CLI の console.log 等)
 * @returns 群に渡す報告先と、貯まった行を持つ入れ物
 */
export function collectSkipNotes(inner: ProgressLog): SkipCollector {
  const notes: string[] = [];
  return {
    log: (line: string): void => {
      if (isSkipNote(line)) notes.push(line);
      inner(line);
    },
    notes,
  };
}
