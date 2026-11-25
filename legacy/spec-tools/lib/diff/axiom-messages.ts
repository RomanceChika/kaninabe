/**
 * 公理の側の差分の文(日本語)。6 軸の文(`messages.ts`)と同じく、仕組み側の日本語を 1 か所に閉じる。
 *
 * 文に出る名詞は不変条件の ID・状態とイベントの鍵・仕様の中身で、アプリの語彙は 1 語も書かない。
 */

import type { ReadingChange } from '../semantics/reading-change.js';
import type { DiffProblem } from './types.js';
import { DIRECTION_MARK } from './messages.js';

/** 公理の側の節の見出し。 */
export const AXIOM_TITLE = '公理の側の差分(人が読む)';

/** 導出の側(6 軸)の前置き。公理を変えた帰結であり、読まなくても公理の判定は変わらない。 */
export const DERIVED_NOTE =
  '以下の 6 軸は導出の側です。公理を変えた帰結として機械が出した結果で、公理の側の行に対応する行があれば、そちらが原因です';

/**
 * 比較先の仕様が読めなかった要素の報告(「読めなかった」を「消えた」と混ぜない)。
 *
 * @param count 基点側にあった計算の例の行数(比べられなかった分)
 */
export function examplesNotRead(count: number): string {
  return `計算の例の表は比較先の action_spec を読めなかったため比べていません(基点の ${count} 行を「消えた」とは数えていない)`;
}

/**
 * 公理の側の源が読めなかったことの報告(「読めなかった」を「消えた」「増えた」と混ぜない)。
 *
 * @param problem 読めなかった源(どちらの版の、どのファイルの、なぜ)
 */
export function axiomNotRead(problem: DiffProblem): string {
  const side = problem.side === 'base' ? '基点' : '比較先';
  return `公理の側の \`${problem.path}\` が${side}で読めなかったため、その源の分は比べていません(「消えた」「増えた」とは数えていない): ${problem.reason}`;
}

/** 公理の側の 1 件の見出しの型(要素の種類ごとの呼び名)。 */
const AXIOM_SUBJECT: Readonly<Record<ReadingChange['element'], string>> = {
  'invariant.statement': '不変条件',
  'state.label': '状態の表示名',
  'transition.meaning': 'イベントの呼び名',
  'state.summary': '段の場面の文',
  'machine.summary': '節の要約の文',
  'entity.summary': '章頭の 1 文',
  'computes.example': '計算の例',
};

/** 公理の側の 1 件の日本語(見出し 1 行 + 前後の中身)。 */
export function axiomText(change: ReadingChange): readonly string[] {
  const subject = `${AXIOM_SUBJECT[change.element]} \`${change.key}\``;
  const head =
    change.kind === 'added'
      ? `${DIRECTION_MARK.added} ${subject} が増えた`
      : change.kind === 'removed'
        ? `${DIRECTION_MARK.removed} ${subject} が消えた`
        : `${DIRECTION_MARK.changed} ${subject} の中身が変わった`;
  return [
    head,
    ...(change.before === null ? [] : [`  - 前: ${change.before}`]),
    ...(change.after === null ? [] : [`  - 後: ${change.after}`]),
  ];
}
