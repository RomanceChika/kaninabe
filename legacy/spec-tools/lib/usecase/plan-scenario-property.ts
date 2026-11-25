/**
 * plan-scenario.ts が使う、**性質(fast-check)で振る値**の組み立て(束 ⑰-3)。
 *
 * 場面が「その意味クラスになる 1 点」を選ぶのに対し、性質は「判断に効く列の候補を全部」
 * 並べる。振るのは実行時(fast-check)であり、ここが決めるのは**何を振るか**だけである。
 */

import type { ScenarioValue } from './plan-scenario-values.js';
import { candidatesOf } from './plan-scenario-values.js';
import type { ScenarioContext } from './plan-scenario-rows.js';
import { ACTOR_ID, OTHER_ID, contextOf } from './plan-scenario-rows.js';
import { materialize } from './plan-scenario-materialize.js';
import { claimsOfAll, pickRole } from './plan-scenario-actors.js';
import type { ScenarioInput } from './plan-scenario.js';
import { solve } from './plan-scenario.js';

/**
 * 性質(fast-check)で振る行 1 つ —— 列ごとの**候補の全部**。
 *
 * 場面が 1 点を選ぶのに対し、性質はこの候補をランダムに振る。候補は仕様から作る:
 * 状態列は状態の全部、ロールの根拠になる列は「実行者 / 別人」、日時は現在時刻の前後、
 * 列挙は値の全部である(`plan-scenario-values.ts`)。
 */
export interface PropertyRow {
  readonly table: string;
  readonly id: string;
  readonly values: Readonly<Record<string, readonly ScenarioValue[]>>;
}

/** 性質の確認 1 本ぶん(操作 1 本に 1 つ)。 */
export interface PlanProperty {
  readonly rows: readonly PropertyRow[];
  readonly actorId: string;
  /** 既定の一式の上から置くセッションの欄(性質の実行者は手順が認める `claim` のロールを全部持つ)。 */
  readonly claims: Readonly<Record<string, string | boolean>>;
  readonly input: Readonly<Record<string, ScenarioValue>>;
}

/**
 * その計画の性質(振る値の候補と、固定する実行者・入力)を組み立てる。
 *
 * 実行者は**ログイン済みで、claim を持つ**ものに固定する —— ロールの根拠は列の値として
 * 振るので、実行者そのものを振る必要が無い。
 *
 * @param input 計画・ドメイン仕様・ガード解析・A7 の要求
 * @returns 振る行と固定する値(行を 1 つも読まない計画では null)
 */
export function buildPlanProperty(input: ScenarioInput): PlanProperty | null {
  const ctx = contextOf(input.operation, input.domain, input.guards);
  const role = pickRole(input, ctx);
  if (role === null || ctx.reads.length === 0) return null;
  const solved = solve(input, ctx, role, { guard: true, insideFrom: true });
  if (solved === null) return null;
  const base = materialize(ctx, {
    env: solved.env,
    boundRoles: [role],
    actorId: ACTOR_ID,
    changeField: solved.changeField,
  });
  return {
    rows: base.rows.map((row) => ({
      table: row.table,
      id: row.id,
      values: Object.fromEntries(
        Object.keys(row.values).map((field) => [field, drawsOf(ctx, row.table, field, row.values[field] ?? null)]),
      ),
    })),
    actorId: ACTOR_ID,
    claims: { ...claimsOfAll(input, ctx), ...solved.claims },
    input: base.input,
  };
}

/**
 * 列 1 つの候補。
 *
 * 判断に効く列(状態・ガード式の変数・ロールの根拠)だけを振り、それ以外は場面が決めた値に
 * 固定する —— 効かない列を振っても試行が無駄になるだけで、反例の縮小も鈍る。
 */
function drawsOf(
  ctx: ScenarioContext,
  table: string,
  field: string,
  fixed: ScenarioValue,
): readonly ScenarioValue[] {
  const read = ctx.reads.find((candidate) => candidate.table === table);
  const ref = `${read?.entity ?? ''}.${field}`;
  if ([...ctx.roleRefs.values()].includes(ref)) return [ACTOR_ID, OTHER_ID];
  const variable = ctx.variables.find((candidate) => candidate.ref === ref);
  if (variable !== undefined) return candidatesOf(variable.type, variable.states, [], variable.bounds);
  if (ctx.stateVariable?.ref === ref) return [...ctx.fromStates, ...ctx.outsideStates];
  return [fixed];
}
