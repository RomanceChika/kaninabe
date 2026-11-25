/**
 * V5 到達可能性。
 *
 * initial から全状態へ至る遷移経路があるかを検査する
 * (domain-spec-writing.md V1〜V12 表 V5 行)。到達できない状態は
 * 「書いたが決して起こらない状態」であり、仕様の書き損じか設計の欠落を示す。
 *
 * ## 「到達可能」には 3 段ある —— ここが見るのは 2 段目である
 *
 * | 段 | 問い | いま何が見ているか |
 * |---|---|---|
 * | ① 宣言の網羅 | 宣言した状態 × イベントに、定義か理由付き禁止があるか | V3(遷移)・V4(読み取り)。有限の宣言の突合 |
 * | ② **ガードを無視した到達性** | 遷移グラフ(from → to)の辺だけを辿って届くか | **V5(ここ)**。グラフの BFS |
 * | ③ 実行列としての到達性 | ガードを満たしながら、**複数集約の状態が同時に噛み合う**実行列が存在するか | **V21**(有界 K 手・1 行ずつの世界・誰が実行するかと不変条件は見ない)。遷移を時間軸に展開した SMT |
 *
 * ② が緑でも ③ は言えない。ここが辿る辺は `guard` を一切読まないので、**どの実行列でも
 * ガードが成立しない辺**が経路に混じっていても到達可能と判定する。ガード式そのものが
 * 恒偽でないことは V9(判定器は Z3)が式ごとに見るが、V9 も**式 1 本の充足性**であって、
 * 「その式が真になる状態へ実際に至れるか」「別の集約の状態と両立するか」は見ていない。
 * ③ はそこを見る —— ただし **K 手の有界**であり、「K 手以内に無い」までしか言わない
 * (無限の実行列まで言い切るにはモデル検査(TLA+)が要る。why-formal-spec.md §4)。
 *
 * したがって V5 の findings は「**辺を辿っても届かない**」の指摘であり、
 * 「届く」側は保証ではない(偽陰性がありうる)。
 */

import { allMachines, type SpecModel, type StateMachineSpec } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext, Verifier } from '../../check-api/contract.js';

/**
 * initial から到達できる状態の集合を BFS で求める。
 *
 * **ガード条件は読まない**(上の 3 段の②)。辺は `events[].from → events[].to` だけで作る。
 *
 * @returns 辺を辿って届く状態 ID の集合(initial 自身を含む)
 */
function reachableStates(machine: StateMachineSpec): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const event of machine.events) {
    for (const from of event.from) {
      const targets = outgoing.get(from);
      if (targets === undefined) outgoing.set(from, [event.to]);
      else targets.push(event.to);
    }
  }

  const reached = new Set<string>([machine.initial]);
  const queue: string[] = [machine.initial];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of outgoing.get(current) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

/**
 * 全状態の到達可能性を検査する検証器(上の 3 段の②)。
 * 辺を辿っても届かない状態ごとに 1 件の Finding を返す。
 */
export const reachabilityVerifier: Verifier = {
  id: 'V5',
  title: '到達可能性 — initial から全状態への経路がある(ガードは見ない)',

  verify(model: SpecModel, _ctx: VerifyContext): Finding[] {
    const findings: Finding[] = [];

    for (const { machine } of allMachines(model)) {
      const reached = reachableStates(machine);
      for (const state of machine.states) {
        if (reached.has(state)) continue;
        findings.push({
          verifier: 'V5',
          severity: 'error',
          message: `${machine.machine}: 状態 ${state} へ到達する遷移がありません`,
          location: machine.location,
          suggestion: `到達可能な状態から ${state} へ遷移するイベント(to: ${state})を追加するか、使われていない状態 ${state} を states から削除してください。initial は ${machine.initial} です。`,
          counterexample: { machine: machine.machine, state, initial: machine.initial },
        });
      }
    }

    return findings;
  },
};
