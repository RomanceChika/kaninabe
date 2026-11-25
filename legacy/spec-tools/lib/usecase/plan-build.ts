/**
 * 保存点の実行計画を「接地 → 引数の解決 → 事実の解決」まで 1 度に組み立てる入口。
 *
 * 検査(Y10)と 4 つの生成器(plans / inputs / action・composition / フォーム)が**同じ 1 つの
 * 組み立て**を共有するための場所である。どれかが別経路で組み立てると、検査が通した仕様から
 * 生成器が落ちる(あるいはその逆)ことが起こりうる。
 *
 * ファイル I/O はしない純関数(scripts-code-quality.md)。
 */

import type { SpecModel } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type { ActionSpecModel } from '../model/trace/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { ResolvedParam } from './param-source.js';
import { resolveSaveParams } from './param-source.js';
import type { PlanProblem, SavePlan } from './step-plan.js';
import { planSave } from './step-plan.js';
import type { SaveFacts } from './plan-facts.js';
import { resolveSaveFacts } from './plan-facts.js';
import type { UsecaseSpec, UsecaseSpecModel } from '../model/usecase/types.js';
import { preconditionFailure } from '../kernel/generator-precondition.js';

/** 組み立て済みの保存点 1 つ。 */
export interface BuiltSave {
  readonly usecase: UsecaseSpec;
  readonly plan: SavePlan;
  /** 手順ごとの解決済み引数(`plan.steps` と同じ並び)。 */
  readonly params: readonly (readonly ResolvedParam[])[];
  readonly facts: SaveFacts;
}

/** 組み立てに要る入力。 */
export interface BuildInput {
  readonly domain: SpecModel;
  readonly guards: GuardServices;
  readonly actions: ActionSpecModel | null;
  readonly dataTables: DataTableSpecModel | undefined;
  readonly usecases: UsecaseSpecModel | undefined;
}

/** 組み立ての結果。1 つでも組み立てられなければ、その理由をユースケースごとに返す。 */
export interface BuildResult {
  readonly saves: readonly BuiltSave[];
  /** 組み立てられなかった保存点の理由(ユースケースごとにまとめてある)。 */
  readonly problems: readonly BuildProblem[];
}

/** どの段で止まったか(`ground` は Y1、`params` は Y8、`facts` は Y10 が同じ問いを見ている)。 */
export type BuildStage = 'ground' | 'params' | 'facts';

/** 組み立てられなかった 1 件(どのユースケースの何が決まらないか)。 */
export interface BuildProblem {
  readonly usecase: UsecaseSpec;
  readonly stage: BuildStage;
  readonly problem: PlanProblem;
}

/**
 * 全ユースケースの全保存点を組み立てる。
 *
 * @param input ドメイン仕様・ガード解析・action_spec・data_table・usecase_spec
 * @returns 組み立てられた保存点と、組み立てられなかった理由
 */
export function buildSavePlans(input: BuildInput): BuildResult {
  const model = input.usecases;
  if (model === undefined || !model.available) return { saves: [], problems: [] };
  if (input.dataTables === undefined || !input.dataTables.available) return { saves: [], problems: [] };

  const saves: BuiltSave[] = [];
  const problems: BuildProblem[] = [];
  for (const usecase of [...model.usecases].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const save of usecase.saves) {
      const planned = planSave(usecase, save, {
        domain: input.domain,
        actions: input.actions,
        dataTables: input.dataTables,
      });
      if (!planned.ok) {
        problems.push(...planned.problems.map((problem) => ({ usecase, stage: 'ground' as const, problem })));
        continue;
      }
      const resolved = resolveSaveParams(planned.plan, input.domain);
      if (!resolved.ok) {
        problems.push(...resolved.problems.map((problem) => ({ usecase, stage: 'params' as const, problem })));
        continue;
      }
      const facts = resolveSaveFacts({
        plan: planned.plan,
        params: resolved.steps,
        domain: input.domain,
        guards: input.guards,
      });
      if (!facts.ok) {
        problems.push(...facts.problems.map((problem) => ({ usecase, stage: 'facts' as const, problem })));
        continue;
      }
      saves.push({ usecase, plan: planned.plan, params: resolved.steps, facts: facts.facts });
    }
  }
  return { saves, problems };
}

/** 段 → その前提を先に見ている検査器の ID(生成器が報告する相手)。 */
const STAGE_VERIFIER: Readonly<Record<BuildStage, string>> = { ground: 'Y1', params: 'Y8', facts: 'Y10' };

/**
 * 組み立てられなかったので生成を中止する(**その前提を先に見るべき検査器**の ID を示す)。
 *
 * 生成器は素の `throw` を持たない(scripts-code-quality.md §生成器は throw しない)。
 * ここに来るのは仕様の問題ではなく**検査の穴**であり、示した検査器に判定を足すのが
 * 正しい直し方になる —— そのために段ごとの検査器 ID を Finding に載せる。
 *
 * @param problems 組み立てられなかった理由(1 件以上)
 * @returns 返らない
 */
export function stopOnBuildProblems(problems: readonly BuildProblem[]): never {
  return preconditionFailure(
    [...new Set(problems.map(({ stage }) => STAGE_VERIFIER[stage]))].join(' / '),
    problems.map(({ usecase, problem }) => ({
      message: `[${usecase.name}] ${problem.message}`,
      suggestion: problem.suggestion,
      counterexample: problem.counterexample,
      location: { file: usecase.location.file },
    })),
  );
}
