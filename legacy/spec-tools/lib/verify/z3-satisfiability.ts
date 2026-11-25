/**
 * V9 / V10 の充足性判定を **Z3 に置き換える配線**(先読みと本走の 2 段)。
 *
 * 判定器そのものは既製品(`lib/guard/z3.ts`)であり、写像は `lib/guard/smt.ts` である。
 * ここが持つのは「**同期の検証器に非同期の判定をどう届けるか**」という段取りだけである。
 *
 * 検証器は「モデルを受け取り Finding を返す純粋関数」という契約(scripts-code-quality.md)で、
 * 戻り値が `Promise` になると全検証器の形が変わる。そこで **2 段**にする:
 *   1. 先読み … 充足性を問う検証器(V9 / V10)を**列挙器のまま 1 回実行し**、
 *      「どの式を、どの環境で問うたか」だけを記録する(Finding は捨てる)。
 *   2. 本走 … 記録した問いを **Z3 にまとめて解かせ**、答えの表を引くだけの
 *      `GuardServices` を作って、本番の実行に渡す。
 *
 * 記録に無い問い(将来、別の検証器が充足性を問い始めたとき)は**自作の列挙器に落ちる**。
 * 静かに検査の範囲が縮むのを防ぐため、「充足性を問う検証器は V9 / V10 だけ」という事実そのものを
 * 単体テスト(`z3-satisfiability.test.ts`)が実測する。
 */

import type { DomainEnv, GuardExpr, GuardServices, SatResult } from '../guard/ast.js';
import { translateToSmt } from '../guard/smt.js';
import { satisfiabilityByZ3, type Z3Options } from '../guard/z3.js';
import type { SpecModel } from '../model/types.js';
import type { VerifyContext } from '../check-api/contract.js';
import { ALL_VERIFIERS } from './verifiers/index.js';

/** 充足性を問う検証器の ID(先読みで実行する範囲)。 */
export const SATISFIABILITY_VERIFIER_IDS: readonly string[] = ['V9', 'V10'];

/** 記録した問い 1 件。 */
export interface SatQuery {
  readonly expr: GuardExpr;
  readonly env: DomainEnv;
}

/** 先読み用の記録器。 */
export interface SatRecorder {
  /** 記録しながら列挙器に委譲する GuardServices。 */
  readonly services: GuardServices;
  /** 記録された問い(出現順)。 */
  readonly queries: readonly SatQuery[];
}

/**
 * 充足性の問いを記録する GuardServices を作る(判定そのものは委譲先のまま)。
 *
 * @param base 委譲先(自作の列挙器を配線した GuardServices)
 * @returns 記録器
 */
export function recordSatisfiability(base: GuardServices): SatRecorder {
  const queries: SatQuery[] = [];
  return {
    queries,
    services: {
      ...base,
      satisfiability(expr: GuardExpr, env: DomainEnv): SatResult {
        queries.push({ expr, env });
        return base.satisfiability(expr, env);
      },
    },
  };
}

/**
 * 充足性を問う検証器を空走りさせ、問われた式を集める。
 *
 * @param model 構築済みのドメイン仕様モデル
 * @param ctx 本走と同じ文脈(guards は記録器に差し替えて使う)
 * @returns 問いの一覧(重複を含む)
 */
export function collectSatQueries(model: SpecModel, ctx: VerifyContext): readonly SatQuery[] {
  const recorder = recordSatisfiability(ctx.guards);
  const probeCtx: VerifyContext = { ...ctx, guards: recorder.services };
  for (const verifier of ALL_VERIFIERS) {
    if (SATISFIABILITY_VERIFIER_IDS.includes(verifier.id)) verifier.verify(model, probeCtx);
  }
  return recorder.queries;
}

/**
 * 問い 1 件を表の鍵にする(同じ意味の問いは同じ SMT-LIB になる)。
 *
 * **値の綴りまでを鍵に含める。** finite の値は SMT-LIB の上では採番した整数に潰れているので、
 * 「同じパス名で値域だけが違う」2 つの問い(`state in [draft, accepting]` と
 * `state in [pending, confirmed]`)は declarations と formula が一字一句同じになる。verdict は
 * 綴りの入れ替えで変わらないので判定は正しいが、**反例(witness)は先に解いた側の綴りが返る** ——
 * 「この集約には無い綴り」が反例として出る(束 ⑳-5c-b の実測)。反例の場所と根拠を正確に出すのが
 * この体系の売りなので、綴りの並びを鍵に混ぜて別の問いとして解く。
 */
function keyOf(query: SatQuery): string {
  const translation = translateToSmt(query.expr, query.env);
  const spelling = translation.variables
    .map((variable) => `${variable.path}:${[...(variable.valueByIndex?.values() ?? [])].join(',')}`)
    .join(';');
  return `${spelling}\n${translation.declarations}\n(assert ${translation.formula})`;
}

/**
 * 記録した問いを Z3 で解き、**答えの表を引くだけ**の GuardServices を返す。
 *
 * 表に無い問いは委譲先(自作の列挙器)に落ちる —— 判定が消えることはない。
 *
 * @param base 委譲先(自作の列挙器を配線した GuardServices)
 * @param queries 先読みで集めた問い
 * @returns Z3 の答えを引く GuardServices
 */
export async function z3Satisfiability(
  base: GuardServices,
  queries: readonly SatQuery[],
  options: Z3Options = {},
): Promise<GuardServices> {
  const answers = new Map<string, SatResult>();
  for (const query of queries) {
    const key = keyOf(query);
    if (answers.has(key)) continue;
    answers.set(key, await satisfiabilityByZ3(query.expr, query.env, options));
  }
  return {
    ...base,
    satisfiability(expr: GuardExpr, env: DomainEnv): SatResult {
      return answers.get(keyOf({ expr, env })) ?? base.satisfiability(expr, env);
    },
  };
}

/**
 * 先読み → Z3 → 本走用の文脈、を 1 本にした口(pipeline が呼ぶ)。
 *
 * @param model 構築済みのドメイン仕様モデル
 * @param ctx 本走の文脈
 * @param options 判定器の呼び出し口(既定は本物の Z3。差し替えるのはテストだけ)
 * @returns 充足性判定を Z3 に差し替えた文脈と、解いた問いの件数
 */
export async function withZ3Satisfiability(
  model: SpecModel,
  ctx: VerifyContext,
  options: Z3Options = {},
): Promise<{ readonly ctx: VerifyContext; readonly solved: number }> {
  const queries = collectSatQueries(model, ctx);
  const guards = await z3Satisfiability(ctx.guards, queries, options);
  const distinct = new Set(queries.map((query) => keyOf(query)));
  return { ctx: { ...ctx, guards }, solved: distinct.size };
}
