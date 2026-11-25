/**
 * 操作 1 つの組み合わせの軸のうち、**world と計画の材料から並びを決めるだけの部分**(`eq-cases.ts` から分けた)。
 *
 * 状態・実行者・ロール配列・編集の欄の並びと、実行者自身の行から読む集約。どれも純関数で、throw しない。
 * **アプリの語彙は 1 語も持たない。**
 */

import type { ScenarioContext } from '../usecase/plan-scenario-rows.js';
import type { EqRoleArrayName, EqWorld } from './eq-world-types.js';
import type { EqAxis } from './eq-cases.js';
import { boundFieldsOfCreate } from '../usecase/actor-bound.js';
import { STALE_ARRAY_NAME } from './eq-world-types.js';

/** 実行者自身の行から読む集約(対象の集約を除く。宣言順・重複なし)。 */
export function actorReadsOf(ctx: ScenarioContext): readonly string[] {
  return [
    ...new Set(
      ctx.reads
        .filter((read) => read.idFrom.kind === 'actor' && read.entity !== ctx.entity)
        .map((read) => read.entity),
    ),
  ];
}

/** 対象の状態の並び(遷移だけが持つ。宣言された遷移元が先)。 */
export function statesOf(ctx: ScenarioContext): readonly (string | null)[] {
  if (ctx.stateVariable === null) return [null];
  const states = [...ctx.fromStates, ...ctx.outsideStates];
  return states.length === 0 ? [null] : states;
}

/**
 * 実行する実行者の並び。
 *
 * 実行者自身の行を判断材料として読む操作では、**行が無い人を外す** —— 読めなかった行の値を
 * 他人の行で代用すると、DB が見ている world と期待が見ている world が別物になる(実測: 他人の
 * メンバー状態を条件に渡して、DB だけが「条件に合う行が無い」と答えた)。
 */
export function actorsOf(world: EqWorld, ctx: ScenarioContext): readonly string[] {
  const readsActor = ctx.reads.some((read) => read.idFrom.kind === 'actor');
  return world.actors
    .filter((actor) => !readsActor || actor.row !== null)
    .map((actor) => actor.key);
}

/** ロール配列の並び(world の実行者はみな同じ 3 種類を持つ。条件を満たさない人だけが持つ古いロール一覧は最後)。 */
export function arrayNamesOf(world: EqWorld): readonly EqRoleArrayName[] {
  // 全員が持つ配列に加え、条件を満たさない人だけが持つ古いロール一覧(`from_stale`)があれば最後に足す。
  const names = world.actors[0]?.arrays.map((array) => array.name) ?? [];
  const extra = world.actors.some((actor) => actor.arrays.some((array) => array.name === STALE_ARRAY_NAME));
  return extra ? [...names, STALE_ARRAY_NAME] : names;
}

/**
 * 編集で動かす欄の並び(編集以外は 1 本だけの `null`)。
 *
 * **`writes` の欄ではなく、その操作が受け取る欄である。** 同じ集約の `writes` に並んでいても、
 * その action_spec の `input` に無い欄は**この操作からは動かせない** —— 実行器が `canWrite` を
 * 回すのも RPC が `p_changes` から取り出すのも、受け取った欄だけだからである
 * (`run-plan-decide.ts` の `changedFields`)。受け取らない欄を送ると、RPC は「変更する
 * フィールドがありません」として engine の判定より手前で落ちる。
 */
export function fieldsOf(ctx: ScenarioContext): readonly (string | null)[] {
  if (ctx.kind !== 'update') return [null];
  const found = ctx.inputKeys.filter((key) => key !== 'id');
  return found.length === 0 ? [null] : found;
}


/**
 * 実行者 × ロール配列の組の数(実行者がその配列を持つものだけ)。
 *
 * 実行者ごとに持つ配列が違う(条件を満たさない人だけが古いロール一覧を持つ)ので、全員が全配列を持つとして
 * 掛けてはならない —— 実行する側の直積(`enumerate`)は持つ配列だけを回す。
 */
export function actorArrayPairs(
  world: EqWorld,
  actors: readonly string[],
  arrays: readonly EqRoleArrayName[],
): number {
  return actors.reduce(
    (total, key) =>
      total +
      arrays.filter((name) =>
        world.actors.find((actor) => actor.key === key)?.arrays.some((array) => array.name === name),
      ).length,
    0,
  );
}

/** 実行者本人の値の字面(食い違いの報告に出る)。 */
const SELF_LABEL = '実行者本人';

/** 実行者でない人の値の字面。 */
const OTHER_LABEL = '他人';

/**
 * 作成の規則が縛る**入力の欄**(B)ごとの軸 —— 実行者本人と他人の両方を振る。
 *
 * 雛形の値だけだと、その欄は系統の行が指す誰か 1 人に決まる(実測: 他人の値しか試されず、正しく縛られた
 * 利用者の成功が 1 度も実行されなかった)。入力に無い欄(A)は実行器も一致の証明も実行者そのもので埋めるので、
 * 軸を持たない。
 */
export function boundAxesOf(ctx: ScenarioContext): readonly EqAxis[] {
  if (ctx.kind !== 'create') return [];
  return boundFieldsOfCreate(ctx.domain, ctx.entity, ctx.inputKeys)
    .filter((field) => field.inInput)
    .map((field) => ({
      key: `${ctx.entity}.${field.name}`,
      values: (['self', 'other'] as const).map((who) => ({
        label: who === 'self' ? SELF_LABEL : OTHER_LABEL,
        placements: [],
        actorInputs: [{ column: field.name, who }],
      })),
    }));
}
