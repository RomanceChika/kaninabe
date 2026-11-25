/**
 * 公理の側の差分(`spec:diff` の「公理の側」の節と、章の「今回変わった」の元)。
 *
 * 6 軸(権限・操作・見える行・公開される欄・通知・画面)はどれも**導出**の側である —— 公理を変えた
 * 帰結として機械が出した結果で、読まなくても公理の判定は変わらない(book-human-face.md §7-2)。
 * 人が読むのは、帰結ではなく**公理そのものが動いたか**であり、ここがそれを出す。
 *
 * 公理のうち、生成物に写されて**意味だけを持つ**ものを比べる(書き方の差が文に化けない):
 *
 * - 不変条件の言明(`invariants.ts` の `invariantStatements`)
 * - 状態の表示名・イベントの呼び名(`{状態機械}.labels.ts`。状態の意味の写し)
 * - 章頭の 1 文・節の要約・段の場面(`summaries.json`。人が書く文の写し)
 * - 計算の例の表の行(`summaries.json` の `example`。「入力 → 値」の写し。人が外の世界と照らして判定する公理)
 *
 * それ以外の公理(`formal`・access の絞り込み・計算式・タスクの予算)は生成物の形で畳まれており、
 * 帰結は 6 軸(導出の側)に現れる。**足りない分は、導出の側の行が拾う**。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { ReadingChange } from '../semantics/reading-change.js';
import type { ActionSpec } from '../model/trace/types.js';
import { summaryTableOf } from '../semantics/reading-axioms.js';
import { diffFacts, FactBuilder } from './facts.js';
import type { FactTable } from './facts.js';
import { axiomNotRead, examplesNotRead } from './axiom-messages.js';
import type { AxiomFacts, BlindScope } from './axiom-read.js';
import { isBlind, PREFIX, SUMMARY_KINDS } from './axiom-read.js';
import type { DiffProblem } from './types.js';

/** 公理の側の事実の表を、仕様モデル(生成の入力)から作る。 */
export function axiomFactsOfModel(model: SpecModel, actions: readonly ActionSpec[]): FactTable {
  const builder = new FactBuilder();
  for (const specs of model.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) builder.add(`${PREFIX.invariant}${invariant.id}`, invariant.statement);
    for (const machine of specs.stateMachines) {
      for (const [state, label] of Object.entries(machine.stateLabels)) builder.add(`${PREFIX.state}${machine.machine}.${state}`, label);
      for (const event of machine.events) {
        if (event.label !== undefined) builder.add(`${PREFIX.event}${machine.machine}.${event.id}`, event.label);
      }
    }
  }
  const summaries = summaryTableOf(model, actions);
  for (const [kind, prefix] of SUMMARY_KINDS) {
    for (const [key, text] of Object.entries(summaries[kind])) builder.add(`${prefix}${key}`, text);
  }
  return builder.table();
}

/** 事実の鍵 → 要素の種類と素の鍵。 */
function elementOf(key: string): { readonly element: ReadingChange['element']; readonly key: string } {
  if (key.startsWith(PREFIX.entitySummary)) return { element: 'entity.summary', key: key.slice(PREFIX.entitySummary.length) };
  if (key.startsWith(PREFIX.machineSummary)) return { element: 'machine.summary', key: key.slice(PREFIX.machineSummary.length) };
  if (key.startsWith(PREFIX.stateSummary)) return { element: 'state.summary', key: key.slice(PREFIX.stateSummary.length) };
  if (key.startsWith(PREFIX.example)) return { element: 'computes.example', key: key.slice(PREFIX.example.length) };
  if (key.startsWith(PREFIX.state)) return { element: 'state.label', key: key.slice(PREFIX.state.length) };
  if (key.startsWith(PREFIX.event)) return { element: 'transition.meaning', key: key.slice(PREFIX.event.length) };
  return { element: 'invariant.statement', key: key.slice(PREFIX.invariant.length) };
}

/**
 * 2 版の事実の表から、公理の側の差分を出す。
 *
 * @param base 基点側の表
 * @param head 比較先の表
 * @returns 鍵の順の差分(要素の種類つき)
 */
export function axiomChanges(base: FactTable, head: FactTable): readonly ReadingChange[] {
  return diffFacts(base, head).map((delta) => ({
    ...elementOf(delta.key),
    kind: delta.kind,
    before: delta.before,
    after: delta.after,
  }));
}

/** 公理の側の差分と、比べられなかったものの報告(差分の行とは別に出す)。 */
export interface AxiomReading {
  /** 比べられた分の差分。 */
  readonly changes: readonly ReadingChange[];
  /** 比べられなかったもの(日本語の 1 文ずつ。無ければ空)。 */
  readonly notRead: readonly string[];
  /** 読めなかった(`unreadable`)・宣言が無かった(`undeclared`)源の報告(`spec:diff` の「見えていないもの」の節へ渡す)。 */
  readonly problems: readonly DiffProblem[];
}

/** 比較先の action_spec を読めないとき、計算の例が受け持つ範囲(比べない)。 */
const EXAMPLES: BlindScope = { elements: ['computes.example'], keyPrefix: '' };

/**
 * 公理の側の差分を、**読めなかった源の分を差分に混ぜずに**出す。
 *
 * 読めなかったことと、消した / 増やしたことは別である。片側の源が読めない(比較先の action_spec を読めない・
 * 生成物のファイルはあるが壊れている)と、その側の表にはその分の事実が 1 行も無く、反対側の中身が
 * ぜんぶ「消えた」「増えた」に見える。だからその源が受け持つ要素の差分は出さず、比べなかったことを
 * 報告の側に分けて返す。
 *
 * @param base 基点側の読み
 * @param head 比較先の読み
 * @param headRead 比較先で読めた要素(`actions`: action_spec を読めたか)
 * @param headRead.actions action_spec を読めたか
 */
export function axiomReading(base: AxiomFacts, head: AxiomFacts, headRead: { readonly actions: boolean } = { actions: true }): AxiomReading {
  const blind = [...base.blind, ...head.blind, ...(headRead.actions ? [] : [EXAMPLES])];
  const problems = [...base.problems, ...head.problems];
  const exampleRows = [...base.table.keys()].filter((key) => key.startsWith(PREFIX.example)).length;
  return {
    changes: axiomChanges(base.table, head.table).filter((change) => !isBlind(change, blind)),
    notRead: [
      ...(headRead.actions ? [] : [examplesNotRead(exampleRows)]),
      ...problems.filter((problem) => problem.kind === 'unreadable').map(axiomNotRead),
    ],
    problems,
  };
}
