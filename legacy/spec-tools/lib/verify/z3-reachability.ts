/**
 * V21 の有界到達性を **Z3 に解かせる配線**(先読みと本走の 2 段)。
 *
 * 判定器は既製品(`lib/guard/z3.ts` の `checkScript`)であり、写像は `lib/reach/**` である。
 * ここが持つのは「**同期の検証器に非同期の判定をどう届けるか**」という段取りだけで、
 * V9 / V10 の充足性(`z3-satisfiability.ts`)とまったく同じ形をしている:
 *   1. 先読み … V21 を**答えの表なしで 1 回実行し**、どの問いを問うたかだけを記録する
 *   2. 本走 … 記録した問いを世界ごとにまとめて Z3 に解かせ、**表を引くだけ**の
 *      `GuardServices` を作って本番の実行に渡す
 *
 * 記録に無い問いは委譲先(既定は `{ verdict: 'unknown', reason: 'no-solver' }`)に落ちる ——
 * **黙って「到達できる」には畳まない**。検査の範囲が縮んだら V21 が「判定できなかった」と報告する。
 *
 * **世界は機械の組ごとに 1 回だけ展開する。** 世界は問いの主語になる**状態機械**ごとに決まる
 * (関与するのは、その機械のガードが状態変数を読んでいる機械だけ)ので、機械ごとに世界を組み、
 * 同じ機械の組になったものはスクリプトを使い回す。
 */

import type { GuardServices, ReachProblem, ReachResult } from '../guard/ast.js';
import { checkScript, DEFAULT_TIMEOUT_MS, type Z3Options } from '../guard/z3.js';
import { buildWorld } from '../reach/world.js';
import { unrollWorld, type UnrolledWorld } from '../reach/unroll.js';
import type { SpecModel } from '../model/types.js';
import type { VerifyContext } from '../check-api/contract.js';
import { ALL_VERIFIERS } from './verifiers/index.js';

/** 有界到達性を問う検証器の ID(先読みで実行する範囲)。 */
export const REACHABILITY_VERIFIER_IDS: readonly string[] = ['V21'];

/** 先読み用の記録器。 */
export interface ReachRecorder {
  /** 記録しながら委譲先の答えを返す GuardServices。 */
  readonly services: GuardServices;
  /** 記録された問い(出現順)。 */
  readonly problems: readonly ReachProblem[];
}

/** 解いた規模(実行ログに出す)。 */
export interface ReachStats {
  /** 解いた問いの件数。 */
  readonly solved: number;
  /** 展開した世界(関与する機械の組)の数。 */
  readonly worlds: number;
  /** そのうち最大の K。 */
  readonly maxBound: number;
  /** 所要(ミリ秒)。 */
  readonly elapsedMs: number;
}

/**
 * 有界到達性の問いを記録する GuardServices を作る(判定そのものは委譲先のまま)。
 *
 * @param base 委譲先
 * @returns 記録器
 */
export function recordReachability(base: GuardServices): ReachRecorder {
  const problems: ReachProblem[] = [];
  return {
    problems,
    services: {
      ...base,
      boundedReachability(problem: ReachProblem): ReachResult {
        problems.push(problem);
        return base.boundedReachability(problem);
      },
    },
  };
}

/**
 * 有界到達性を問う検証器を空走りさせ、問われた問いを集める。
 *
 * @param model 構築済みのドメイン仕様モデル
 * @param ctx 本走と同じ文脈(guards は記録器に差し替えて使う)
 * @returns 問いの一覧(出現順)
 */
export function collectReachProblems(model: SpecModel, ctx: VerifyContext): readonly ReachProblem[] {
  const recorder = recordReachability(ctx.guards);
  const probeCtx: VerifyContext = { ...ctx, guards: recorder.services };
  for (const verifier of ALL_VERIFIERS) {
    if (REACHABILITY_VERIFIER_IDS.includes(verifier.id)) verifier.verify(model, probeCtx);
  }
  return recorder.problems;
}

/** 世界を機械ごとに組み、同じ機械の組になったものはスクリプトを使い回す。 */
class WorldCache {
  private readonly bySeed = new Map<string, UnrolledWorld>();
  private readonly byMachines = new Map<string, UnrolledWorld>();

  constructor(private readonly model: SpecModel) {}

  /** その機械から見た展開済みの世界。 */
  of(problem: ReachProblem): UnrolledWorld {
    const seed = `${problem.aggregate}.${problem.machine}`;
    const known = this.bySeed.get(seed);
    if (known !== undefined) return known;
    const world = buildWorld(this.model, problem.aggregate, problem.machine);
    const shared = this.byMachines.get(world.key) ?? unrollWorld(world);
    this.byMachines.set(world.key, shared);
    this.bySeed.set(seed, shared);
    return shared;
  }

  /** 展開した世界(機械の組)の数。 */
  get worlds(): number {
    return this.byMachines.size;
  }

  /** そのうち最大の K。 */
  get maxBound(): number {
    let max = 0;
    for (const world of this.byMachines.values()) max = Math.max(max, world.bound);
    return max;
  }
}

/** 判定器の答えを ReachResult に直す(世界の規模を必ず添える)。 */
function toResult(
  status: 'sat' | 'unsat' | 'unknown',
  failure: string | undefined,
  world: UnrolledWorld,
): ReachResult {
  const scope = { bound: world.bound, truncated: world.truncated, machines: world.machines };
  if (status === 'sat') return { verdict: 'reachable', ...scope };
  if (status === 'unsat') return { verdict: 'unreachable', ...scope };
  if (failure !== undefined) return { verdict: 'unknown', failure, ...scope };
  return { verdict: 'unknown', reason: 'timeout', ...scope };
}

/**
 * 記録した問いを Z3 で解き、**答えの表を引くだけ**の GuardServices を返す。
 *
 * @param base 委譲先(表に無い問いはここへ落ちる)
 * @param model 構築済みのドメイン仕様モデル(世界を組むのに使う)
 * @param problems 先読みで集めた問い
 * @param options 判定器の呼び出し口(既定は本物の Z3。差し替えるのはテストだけ)
 * @returns 表を引く GuardServices と、解いた規模
 */
export async function z3Reachability(
  base: GuardServices,
  model: SpecModel,
  problems: readonly ReachProblem[],
  options: Z3Options = {},
): Promise<{ readonly guards: GuardServices; readonly stats: ReachStats }> {
  const started = Date.now();
  const cache = new WorldCache(model);
  const answers = new Map<string, ReachResult>();
  for (const problem of problems) {
    if (answers.has(problem.key)) continue;
    const world = cache.of(problem);
    const question = world.questions.get(problem.key);
    if (question === undefined) continue;
    const solved = await checkScript(
      `${world.script}\n(assert ${question})`,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.solver,
    );
    answers.set(problem.key, toResult(solved.status, solved.failure, world));
  }
  const guards: GuardServices = {
    ...base,
    boundedReachability(problem: ReachProblem): ReachResult {
      return answers.get(problem.key) ?? base.boundedReachability(problem);
    },
  };
  return {
    guards,
    stats: {
      solved: answers.size,
      worlds: cache.worlds,
      maxBound: cache.maxBound,
      elapsedMs: Date.now() - started,
    },
  };
}

/**
 * 先読み → Z3 → 本走用の文脈、を 1 本にした口(V 群の配線が呼ぶ)。
 *
 * @param model 構築済みのドメイン仕様モデル
 * @param ctx 本走の文脈
 * @param options 判定器の呼び出し口(既定は本物の Z3。差し替えるのはテストだけ)
 * @returns 有界到達性の答えを引ける文脈と、解いた規模
 */
export async function withZ3Reachability(
  model: SpecModel,
  ctx: VerifyContext,
  options: Z3Options = {},
): Promise<{ readonly ctx: VerifyContext; readonly stats: ReachStats }> {
  const problems = collectReachProblems(model, ctx);
  const { guards, stats } = await z3Reachability(ctx.guards, model, problems, options);
  return { ctx: { ...ctx, guards }, stats };
}
