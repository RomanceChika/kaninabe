/**
 * 差分の行を **人が読む Markdown** にする段(`$GITHUB_STEP_SUMMARY` にそのまま貼れる形)。
 *
 * 節の順は「**見えていないもの** → 🔓 → 軸ごと」である。読めなかった生成物と、生成物が
 * 答えを出していない操作を**先頭**に置くのは、そこが「差分が出ないのに変わっているかもしれない」
 * 唯一の場所だからである —— 末尾に置くと 🔓 を読んだ時点で読むのをやめてしまう。
 *
 * 差分が 0 のときは**何本の生成物を突き合わせた結果の 0 か**を書き、見えていないものが
 * あるときは**言い切らない**(設計メモ §2)。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { byAxis } from './collect.js';
import { AXIOM_TITLE, axiomText, DERIVED_NOTE } from './axiom-messages.js';
import { AXIS_TITLE, DIRECTION_MARK } from './messages.js';
import type { ReadingChange } from '../semantics/reading-change.js';
import type { DiffOutcome, DiffProblem, SemanticChange } from './types.js';

/** 見出し。 */
const TITLE = '## 仕様の意味の差分';

/** 見えていない(読めなかった・答えが無い)ものがあるか。 */
function hasBlindSpot(outcome: DiffOutcome): boolean {
  return outcome.problems.some((problem) => problem.kind !== 'undeclared');
}

/**
 * 差分が 0 のときの文。
 *
 * **見えていないものがあるときは言い方を変える** —— 「意味の差分はありません」と言い切れる
 * のは全部を突き合わせられたときだけであり、そうでないのに言い切ると、見えていないことが
 * 「変わっていない」として通ってしまう。
 */
function nothing(outcome: DiffOutcome, base: string, axiomCount: number): string {
  const compared = `基点 ${base} / 生成物 ${outcome.comparedFiles} 本を比較`;
  // 公理の側に動きがあるときは、総括の文を言い切らない(見出しだけ読む人に「差分なし」と読ませない)。
  // 6 軸が見るのは導出の側だけで、公理の側は別の節が持つ。
  if (axiomCount > 0) {
    const scope = hasBlindSpot(outcome) ? '判定できた 6 軸' : '6 軸';
    return `${scope}(導出の側)に差分はありません。**公理の側の差分が ${axiomCount} 件**あります(${compared})`;
  }
  const scope = hasBlindSpot(outcome) ? '判定できた範囲に意味の差分はありません' : '意味の差分はありません';
  return `${scope}(${compared})`;
}

/** 行 1 つ(箇条書き)。 */
function bullet(change: SemanticChange): string {
  return `- ${change.text}`;
}

/** どちらの版の話かを示す(両版で同じことが起きていれば 1 行に畳む)。 */
function sideName(sides: ReadonlySet<DiffProblem['side']>): string {
  if (sides.size > 1) return '両版';
  return sides.has('base') ? '基点' : '比較先';
}

/**
 * 読めなかった・答えが無かったものを 1 節にする。
 *
 * 同じファイルの同じ理由は**両版で 1 行に畳む** —— 版をまたいで変わっていない事実を 2 回
 * 読ませても、見えていない範囲は 1 つぶんしか無いからである。
 */
function problemRows(problems: readonly DiffProblem[], kind: DiffProblem['kind'], title: string): readonly string[] {
  const folded = new Map<string, { problem: DiffProblem; sides: Set<DiffProblem['side']> }>();
  for (const problem of problems) {
    if (problem.kind !== kind) continue;
    const key = `${problem.path}\u0000${problem.reason}`;
    const found = folded.get(key);
    if (found === undefined) folded.set(key, { problem, sides: new Set([problem.side]) });
    else found.sides.add(problem.side);
  }
  if (folded.size === 0) return [];
  const lines = ['', `### ${title}(${folded.size} 件)`, ''];
  for (const { problem, sides } of folded.values()) {
    lines.push(`- [${sideName(sides)}] \`${problem.path}\` — ${problem.reason}`);
  }
  return lines;
}

/** **先頭に出す**節(見えていないもの)。 */
function blindSections(outcome: DiffOutcome): readonly string[] {
  const unreadable = problemRows(outcome.problems, 'unreadable', '判定できなかった生成物');
  const unanswered = problemRows(outcome.problems, 'unanswered', '権限の軸で結果表が答えていない操作');
  const lines = [...unreadable];
  if (unreadable.length > 0) {
    lines.push('', '生成物が読めないときは **`npm run generate:check` が先**です(鮮度はそちらが見ます)。');
  }
  lines.push(...unanswered);
  if (unanswered.length > 0) {
    lines.push(
      '',
      'この操作は**結果表では 1 件も判定されていません**(world を宣言から作れない集約)。' +
        '権限の軸は規則の表(作成 / 編集 / 削除 / 遷移の `by` と条件)で下限だけを見ています。',
    );
  }
  return lines;
}

/** 🔓 の節(レビューの主役。軸をまたいで先頭にまとめる)。 */
function widenedSection(changes: readonly SemanticChange[]): readonly string[] {
  const widened = changes.filter((change) => change.direction === 'widened');
  if (widened.length === 0) return [];
  return ['', `### ${DIRECTION_MARK.widened} 広がった変化(${widened.length} 件)`, '', ...widened.map(bullet)];
}

/** 公理の側の節(人が読むのはこちら。導出の側の前に置く)。 */
function axiomSection(changes: readonly ReadingChange[]): readonly string[] {
  if (changes.length === 0) return ['', `### ${AXIOM_TITLE}(0 件)`, '', '公理の側に動いたものはありません(言明・状態の表示名・イベントの呼び名・要約の文・計算の例を比べた結果)'];
  return ['', `### ${AXIOM_TITLE}(${changes.length} 件)`, '', ...changes.flatMap((change) => axiomText(change).map((line, index) => (index === 0 ? `- ${line}` : line)))];
}

/** 軸ごとの節(🔓 の行もここに再掲する —— 軸から辿る読み方を壊さないため)。 */
function axisSections(changes: readonly SemanticChange[]): readonly string[] {
  const lines: string[] = [];
  for (const [axis, rows] of byAxis(changes)) {
    lines.push('', `### ${AXIS_TITLE[axis]}(${rows.length} 件)`, '', ...rows.map(bullet));
  }
  return lines;
}

/**
 * 差分を Markdown にする。
 *
 * @param outcome 差分の結果
 * @param base 基点の表記(HEAD~1 に倒した場合はその先を含む)
 * @param notes 基点の決め方について残す 1 行(HEAD~1 に倒したこと・縮んだこと)
 * @param axiom 公理の側の差分(渡したときだけ「公理の側」の節を出し、6 軸を導出の側と呼ぶ。渡さなければ従来の出力)
 * @returns Markdown の行(改行で結合して出す)
 */
export function renderDiff(
  outcome: DiffOutcome,
  base: string,
  notes: readonly string[] = [],
  axiom?: readonly ReadingChange[],
): string {
  const lines: string[] = [TITLE, ''];
  for (const note of notes) lines.push(`> ${note}`, '');
  lines.push(
    outcome.changes.length === 0
      ? nothing(outcome, base, axiom?.length ?? 0)
      : `基点 ${base} と比べて **${outcome.changes.length} 件**の意味の差分があります(生成物 ${outcome.comparedFiles} 本を比較)。`,
  );
  lines.push(...blindSections(outcome));
  if (axiom !== undefined) lines.push(...axiomSection(axiom), '', DERIVED_NOTE);
  lines.push(...widenedSection(outcome.changes));
  lines.push(...axisSections(outcome.changes));
  lines.push(...problemRows(outcome.problems, 'undeclared', 'その版に宣言が無かったもの・判定していません'));
  return `${lines.join('\n')}\n`;
}
