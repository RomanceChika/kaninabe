/**
 * V21 有界到達性。
 *
 * 「到達可能」には 3 段あり(v5-reachability.ts の表)、ここが見るのは **③ 実行列としての
 * 到達性**である —— ただし **K 手の有界**で。問いは 2 つ:
 *
 * | # | 問い | 何を捕るか |
 * |---|---|---|
 * | (a) 状態 | 機械の各状態に、初期状態から K 手以内に到達する実行列があるか | 書いたが決して起こらない状態 |
 * | (b) 遷移 | `state ∈ from(e) ∧ guard_e` が**同時に成り立つ瞬間**へ K 手以内に至れるか | ガード単体は充足可能だが、その瞬間が作れない遷移 |
 *
 * V5 はガードを 1 つも読まない BFS であり、V9 はガード**単体**の充足性である。その間に
 * 「ガードを満たしながら、参照先の集約の状態と噛み合う実行列があるか」という穴が空いていた
 * ——「ボタンがいつ押しても効かない」が verify 緑で通る形である。
 *
 * **報告するのは「無い」側だけ。** 世界は実行列を多めに認める写し(`by` も不変条件も見ない・
 * 書ける欄はいつでも変わる)なので、「K 手以内に無い」は**本当に無い**(= 仕様の問題)だが、
 * 「ある」は保証ではない。したがって severity は **warning** である。
 *
 * 判定そのものは `ctx.guards.boundedReachability`(既製品の Z3。配線は z3-reachability.ts)に
 * 委譲し、ここは「何を問い、どう Finding に翻訳するか」だけを持つ。**答えの表が無いときは
 * 黙って通さず「判定できなかった」と報告する** —— 配線し忘れた瞬間に検査の範囲が静かに縮むのを防ぐ。
 */

import type { ReachResult } from '../../guard/ast.js';
import { reachProblems, type LocatedReachProblem } from '../../reach/problems.js';
import { MAX_BOUND } from '../../reach/world.js';
import type { SourceLocation, SpecModel } from '../../model/types.js';
import { undecidedText } from '../satisfiability-findings.js';
import type { Finding } from '../../kernel/finding.js';
import type { Verifier, VerifyContext } from '../../check-api/contract.js';

/** 問いの名前(メッセージの主語)。 */
function subjectOf(problem: LocatedReachProblem): string {
  if (problem.kind === 'state') return `${problem.machine}: 状態 ${problem.id}`;
  return `${problem.machine}.${problem.id}`;
}

/**
 * 世界の射程(何を考慮し、何を仮定して「無い」と言っているか)。
 *
 * **縮める側の仮定を必ず報告する。** 世界は「1 行ずつ」であり、`writes` に無い欄は実行中不変と
 * みなす —— どちらも実際より実行列を**少なく**見積もる向きの仮定なので、この 2 つを言わずに
 * 「無い」とだけ報告すると、読み手は断定の射程を取り違える(2 行目・3 行目を同じ集約の 2 行目で
 * 解く仕様や、遷移だけが書く欄で解く仕様は、ここでは「無い」側に出る)。
 */
function scopeOf(result: ReachResult): string {
  const others = (result.machines ?? []).join(' / ');
  const truncated = result.truncated === true ? `。K=${MAX_BOUND} で打ち切り` : '';
  return (
    `ガード・関与する状態機械(${others.length === 0 ? '不明' : others})・時刻の単調性を考慮。` +
    `世界は 1 行ずつ(各集約 1 行)で、access_spec の writes に無い欄は実行中不変とみなす` +
    `(遷移だけが書く欄も不変扱い)。誰が起こすか・不変条件は考慮しない = それでも無い${truncated}`
  );
}

/** 反例に載せる世界の規模。 */
function scopeFields(problem: LocatedReachProblem, result: ReachResult): Record<string, string> {
  return {
    machine: `${problem.aggregate}.${problem.machine}`,
    [problem.kind]: problem.id,
    ...(result.bound === undefined ? {} : { bound: String(result.bound) }),
    ...(result.truncated === true ? { truncated: `K=${MAX_BOUND} で打ち切り` } : {}),
    ...(result.machines === undefined ? {} : { involves: result.machines.join(' / ') }),
    ...(problem.from === undefined ? {} : { from: problem.from.join(' / ') }),
    ...(problem.guard === undefined ? {} : { guard: problem.guard }),
  };
}

/** 状態へ至る実行列が無いときの Finding。 */
function unreachableStateFinding(problem: LocatedReachProblem, result: ReachResult): Finding {
  return {
    verifier: 'V21',
    severity: 'warning',
    message:
      `${subjectOf(problem)} へ初期状態から ${result.bound ?? 0} 手以内に到達する実行列がありません` +
      `(${scopeOf(result)})`,
    location: problem.location,
    suggestion:
      `この状態へ入る遷移のガードと、そのガードが参照する集約の状態機械を見直してください。` +
      `到達できないのが意図どおりなら状態 ${problem.id} を states から削り、意図でないなら` +
      `経路上のどこかのガード(または参照先の集約の遷移)を直します`,
    counterexample: scopeFields(problem, result),
  };
}

/** 遷移が起こせる瞬間へ至れないときの Finding。 */
function unreachableEventFinding(problem: LocatedReachProblem, result: ReachResult): Finding {
  return {
    verifier: 'V21',
    severity: 'warning',
    message:
      `${subjectOf(problem)} は from の状態とガードが同時に成り立つ瞬間へ、` +
      `初期状態から ${result.bound ?? 0} 手以内に至る実行列がありません(${scopeOf(result)})`,
    location: problem.location,
    suggestion:
      `ガードが要求する他集約の状態が、この遷移の from に居る間に成り立ちうるかを見直してください。` +
      `ガード単体が充足可能でも(V9 は緑でも)、その瞬間を作れないことがあります。` +
      `意図どおりに実行できないなら、この遷移を forbidden として理由つきで宣言します`,
    counterexample: scopeFields(problem, result),
  };
}

/**
 * **答えの表が配線されていない**ことを報告する Finding(モデルに 1 件だけ)。
 *
 * 問いごとに出さないのは意図である —— `no-solver` は仕様ではなく**配線**の話なので、
 * 文面に機械名・状態 ID・イベント ID を入れると、状態やイベントを足す / 消す / 改名する
 * だけで `verify` の出力が動く。変異テストの指紋はその字面を見るので、**執行の挙動が
 * 1 ビットも変わっていない変異が「verify が捕った」に化ける**(A 群を指紋から外したのと
 * 同じ構図。lib/mutation/detectors.ts)。だから 1 モデル 1 件・名前を含まない文面にする。
 *
 * @param location 報告する場所(最初の問いの位置)
 * @param count 判定できなかった問いの数(反例にだけ載せる。文面には入れない)
 * @returns 配線が無いことの warning
 */
function unwiredFinding(location: SourceLocation, count: number): Finding {
  return {
    verifier: 'V21',
    severity: 'warning',
    message:
      '有界到達性の答えの表が配線されていません(判定器を通していないので、' +
      '到達できない状態・起こせない遷移があってもここでは気づけません)',
    location,
    suggestion:
      '`verify` は V 群の前に答えの表を配線します(lib/verify/domain-group.ts の runDomainWithZ3)。' +
      'この経路でも到達性を見るなら withZ3Reachability を通してください。見ないのが意図なら、' +
      'その経路の検証器の母集合から V21 を外し、外した理由をそこに書いてください',
    counterexample: { reachability: 'no-solver', problems: String(count) },
  };
}

/** 判定できなかったことを報告する Finding(黙って「到達できる」に畳まない)。 */
function undecidedFinding(problem: LocatedReachProblem, result: ReachResult): Finding {
  const text = undecidedText(subjectOf(problem), result, scopeFields(problem, result), {
    noun: '到達性',
    counterKey: 'reachability',
    suggestion:
      'この状態・この遷移に至る操作の並びを 1 つ手で書けるかを確かめてください。' +
      '関与する状態機械が多いと展開が大きくなります(上限は lib/reach/world.ts の MAX_BOUND)',
  });
  return {
    verifier: 'V21',
    severity: text.severity,
    message: text.message,
    location: problem.location,
    suggestion: text.suggestion,
    counterexample: text.counterexample,
  };
}

/**
 * V21: 各状態・各遷移に K 手以内で至る実行列があるかを検証する。
 *
 * 「ある」は 1 件も報告しない(世界は緩い写しなので保証にならない)。
 */
export const boundedReachabilityVerifier: Verifier = {
  id: 'V21',
  title: '有界到達性 — 各状態・各遷移へ K 手以内に至る実行列がある(ガードと参照先の機械を見る)',

  verify(model: SpecModel, ctx: VerifyContext): Finding[] {
    const findings: Finding[] = [];
    const problems = reachProblems(model);
    let unwired = 0;
    for (const problem of problems) {
      const result = ctx.guards.boundedReachability(problem);
      if (result.verdict === 'reachable') continue;
      if (result.reason === 'no-solver') unwired += 1;
      else if (result.verdict === 'unknown') findings.push(undecidedFinding(problem, result));
      else if (problem.kind === 'state') findings.push(unreachableStateFinding(problem, result));
      else findings.push(unreachableEventFinding(problem, result));
    }
    const first = problems[0];
    if (unwired === 0 || first === undefined) return findings;
    return [unwiredFinding(first.location, unwired), ...findings];
  },
};
