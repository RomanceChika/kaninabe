/**
 * **有界到達性の問いの一覧**(V21 が何を問うか。純粋)。
 *
 * 問いは 2 種類しかない(設計の凍結メモ §1):
 *
 * | # | 問い | 何を捕るか |
 * |---|---|---|
 * | (a) 状態 | 機械の各状態に、初期状態から K 手以内に到達する実行列があるか | 書いたが決して起こらない状態(ガードと参照先の機械まで含めて) |
 * | (b) 遷移 | `state ∈ from(e) ∧ guard_e` が**同時に成り立つ瞬間**へ K 手以内に至れるか | ガード単体は充足可能だが、その瞬間が作れない遷移 |
 *
 * 一覧はモデルだけから決まる。**答えの表を引く側(z3-reachability)も V21 も同じここを呼ぶ**
 * ので、問いの集合が 2 か所でずれることはない。
 */

import type { ReachProblem } from '../guard/ast.js';
import { allMachines, type SourceLocation, type SpecModel } from '../model/types.js';

/** 問いに位置と文脈を添えたもの(Finding を組み立てるのは V21 の仕事)。 */
export interface LocatedReachProblem extends ReachProblem {
  /** どこに書かれているか(状態なら機械・遷移ならイベント)。 */
  readonly location: SourceLocation;
  /** 遷移の問いだけ: 遷移元の状態。 */
  readonly from?: readonly string[];
  /** 遷移の問いだけ: ガードの生文字列(書かれていれば)。 */
  readonly guard?: string;
}

/**
 * 問いの鍵。
 *
 * @param aggregate 集約名
 * @param machine 状態機械の名前
 * @param kind 状態を問うのか遷移を問うのか
 * @param id 状態 ID もしくはイベント ID
 * @returns `{集約}.{機械}.{state|event}.{id}`
 */
export function reachKey(
  aggregate: string,
  machine: string,
  kind: 'state' | 'event',
  id: string,
): string {
  return `${aggregate}.${machine}.${kind}.${id}`;
}

/**
 * モデル全体の問いを列挙する(機械 × 状態 / 機械 × イベント)。
 *
 * **初期状態も問う。** 自明に到達できるので必ず「ある」になるが、ここで省くと
 * 「初期状態が到達できないと言われる仕様」が現れたときに世界の写し方の壊れが見えない。
 *
 * @param model 構築済みのドメイン仕様モデル
 * @returns 問いの一覧(機械の宣言順 → 状態 → イベント)
 */
export function reachProblems(model: SpecModel): readonly LocatedReachProblem[] {
  const problems: LocatedReachProblem[] = [];
  for (const { aggregate, machine } of allMachines(model)) {
    for (const state of machine.states) {
      problems.push({
        key: reachKey(aggregate, machine.machine, 'state', state),
        aggregate,
        machine: machine.machine,
        kind: 'state',
        id: state,
        location: machine.location,
      });
    }
    for (const event of machine.events) {
      problems.push({
        key: reachKey(aggregate, machine.machine, 'event', event.id),
        aggregate,
        machine: machine.machine,
        kind: 'event',
        id: event.id,
        location: event.location,
        from: event.from,
        ...(event.guard === undefined ? {} : { guard: event.guard }),
      });
    }
  }
  return problems;
}
