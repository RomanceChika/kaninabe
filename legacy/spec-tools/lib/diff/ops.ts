/**
 * 軸「操作の増減」—— 操作 ID そのものの出入り。
 *
 * 元は 3 本である ——
 * - 結果表の元データの `ops`(**宣言された操作の全数**。計画が導出できなかったものも並ぶ)
 * - 実行計画の鍵(**計画が導出できた操作**)
 * - 保存点の実行計画の鍵(複数手順をまとめて実行する経路)
 *
 * 3 本を 1 つの集合に合併するのは、この軸の問いが「**操作が増えたか / 消えたか**」だけだから
 * である(どの経路で走るかは A15 が見る)。合併しないと、同じ操作が 2 本の元で 2 行になる。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { diffFacts, FactBuilder } from './facts.js';
import { changeText } from './messages.js';
import { asStrings, field } from './plain.js';
import { pathsWith, problemsOf, readJson, readKeys, unionPaths } from './reader.js';
import type { SideRead } from './reader.js';
import { isResultsPath, operationPlansPath, usecasePlansPath } from './sources.js';
import type { AxisInput, AxisResult, DiffProblem, SemanticChange, SideSnapshot } from './types.js';
import type { ProductRoots } from '../model/product/types.js';

/** 実行計画の export 名(生成物が持つ綴り)。 */
const OPERATION_PLANS = 'operationPlans';

/** 保存点の実行計画の export 名。 */
const USECASE_PLANS = 'usecasePlans';

/** 片側の操作 ID の全数と、読めなかったもの。 */
interface OpsSide {
  readonly ids: readonly string[];
  readonly problems: readonly DiffProblem[];
}

/** 結果表の元データが宣言する操作 ID(集約の形のファイルだけが `ops` を持つ)。 */
function opsFromResults(snapshot: SideSnapshot, side: DiffProblem['side'], roots: ProductRoots): OpsSide {
  const ids: string[] = [];
  const problems: DiffProblem[] = [];
  for (const path of pathsWith(snapshot, (path) => isResultsPath(path, roots))) {
    const read = readJson(snapshot, side, path);
    if (read.problem !== null) problems.push(read.problem);
    ids.push(...asStrings(field(read.value, 'ops')));
  }
  return { ids, problems };
}

/** 実行計画の鍵(素のデータではないので鍵だけを取る)。 */
function opsFromPlans(snapshot: SideSnapshot, side: DiffProblem['side'], roots: ProductRoots): OpsSide {
  const reads: SideRead<readonly string[]>[] = [
    readKeys(snapshot, side, operationPlansPath(roots), OPERATION_PLANS),
    readKeys(snapshot, side, usecasePlansPath(roots), USECASE_PLANS),
  ];
  return { ids: reads.flatMap((read) => read.value ?? []), problems: problemsOf(...reads) };
}

/** 片側の操作 ID の全数。 */
function opsOf(snapshot: SideSnapshot, side: DiffProblem['side'], roots: ProductRoots): OpsSide {
  const fromResults = opsFromResults(snapshot, side, roots);
  const fromPlans = opsFromPlans(snapshot, side, roots);
  return {
    ids: [...fromResults.ids, ...fromPlans.ids],
    problems: [...fromResults.problems, ...fromPlans.problems],
  };
}

/** 操作 ID の集合を事実の表にする(中身は ID そのもの = 出入りだけを見る)。 */
function tableOf(ids: readonly string[]): ReturnType<FactBuilder['table']> {
  const builder = new FactBuilder();
  for (const id of [...ids].sort()) builder.add(id, id);
  return builder.table();
}

/**
 * 軸「操作の増減」の差分。
 *
 * @param input 2 版の写しと表示名の帳面
 * @returns 行と、読めなかったもの
 */
export function operationChanges(input: AxisInput): AxisResult {
  const base = opsOf(input.base, 'base', input.roots);
  const head = opsOf(input.head, 'head', input.roots);
  const problems = [...base.problems, ...head.problems];
  const changes: SemanticChange[] = [];
  // **片側が読めないなら 1 行も出さない**(読めた側の操作がまるごと「増えた」に化ける)。
  if (problems.some((problem) => problem.kind === 'unreadable')) return { changes, problems };
  for (const delta of diffFacts(tableOf(base.ids), tableOf(head.ids))) {
    if (delta.kind === 'changed') continue;
    const slots = { subject: delta.key, ...(input.labels.operation(delta.key) === undefined ? {} : { subjectLabel: input.labels.operation(delta.key) ?? '' }) };
    changes.push({
      axis: 'operations',
      direction: delta.kind,
      subject: delta.key,
      before: delta.before,
      after: delta.after,
      text: changeText('operation', delta.kind, slots),
    });
  }
  return { changes, problems };
}

/** 両版に現れる結果表の元データのパス(権限の軸と本数の数えに使う)。 */
export function resultPaths(base: SideSnapshot, head: SideSnapshot, roots: ProductRoots): readonly string[] {
  return unionPaths(base, head, (path) => isResultsPath(path, roots));
}
