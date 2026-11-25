/**
 * 保存点の**実行計画**(app 側の `permit` が要る事実の供給元)の解決。束 ⑯c-2 設計 §5'。
 *
 * c-1 の `param-source.ts` が「複合 RPC の引数の供給元」を決めるのに対し、ここは
 * **実行前の `permit`(canCreate / canFire)が要る値の供給元**を決める —— ガード式に現れる
 * 変数・文脈ロールの binding・予測状態・保存点の外から読む事実である。
 *
 * どちらも同じ解決器(`step-plan.ts` / `param-source.ts`)の結果を入力にするので、SQL と
 * TS が食い違わない。**決まらないものは生成時エラー**(Y10)にして仕様の問題として止める
 * ——実行時に推測しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef } from '../model/types.js';
import { findField } from '../semantics/domain-index.js';
import type { ParamSource, ResolvedParam } from './param-source.js';
import { allowedOrigins, ORIGIN_ORDER, originSource } from './param-source-fields.js';
import type { PlanProblem, SaveStepPlan } from './step-plan.js';
import type {
  FactsInput,
  SaveFactsResult,
  UsecaseClaimFact,
  UsecaseFactSource,
  UsecaseGuardFact,
  UsecaseRoleFact,
  UsecaseStepFacts,
} from './plan-facts-types.js';
import { gatesOf } from './plan-facts-gates.js';
import { createdRef, entityOf, repeatOnlyReference, stateFieldOf } from './param-source-facts.js';
import { actorFields } from '../model/path-resolve.js';
import { tableOf } from '../semantics/query-window-columns.js';
import { computeReadFact, expectedKeysOf, readIdSourceOf, resultPlanOf, withContextHint } from './plan-facts-reads.js';
import { orderedReads, type ReadEntry } from './plan-facts-order.js';
import {
  collectGuardPaths,
  inputKeysOf,
  invariantHooksOf,
  isResolvableRole,
  predictState,
  noResolvableRole,
  roleBindingOf,
  roleClaimOf,
  rolesOf,
  ungroundedPath,
  unreadable,
  unsupportedBinding,
} from './plan-facts-parts.js';

/**
 * 保存点の実行計画に要る事実を解決する。
 *
 * @param input 接地済みの保存点・解決済みの引数・ドメイン仕様・ガード解析
 * @returns 解決できた事実、または理由つきの失敗(Y10 / 生成時エラー)
 */
export function resolveSaveFacts(input: FactsInput): SaveFactsResult {
  const problems: PlanProblem[] = [];
  const reads = new Map<string, ReadEntry>();

  /**
   * 保存点の外の 1 欄を読む予約を積み、鍵(`{entity}.{field}`)を返す。
   *
   * `optional` は **`computes[].reads` の材料だけ**が立てる旗である。読めない材料は計画を
   * 止めない —— 止めると A15 が「実行計画が決まりません」と言い、**計算の材料が足りない**と
   * いう本当の理由が別の検査の文面に埋もれる。材料が届かないことは A19 が計画の `reads` と
   * 宣言を突き合わせて報告する(束 ㉒)。
   */
  const readExternal = (
    step: SaveStepPlan,
    entity: string,
    field: string,
    optional = false,
  ): UsecaseFactSource | null => {
    const known = reads.get(entity);
    if (known !== undefined) {
      known.fields.add(field);
      return { kind: 'external', ref: `${entity}.${field}` };
    }
    // 先に器を置いてから id の供給元を決める。`context` 経由の解決は「対象の行の参照列を読む」
    // 予約をここへ積み返すので、器が無いと同じ集約の読み取りが 2 つに割れる。
    const table = tableOf(input.domain, entity);
    const entry: ReadEntry = { entity, table, idFrom: null, fields: new Set<string>([field]) };
    reads.set(entity, entry);
    const idFrom = readIdSourceOf(input, entity, readExternal, step);
    if (idFrom === null) {
      reads.delete(entity);
      if (!optional) problems.push(withContextHint(unreadable(input.plan, step, entity, field), step, entity));
      return null;
    }
    entry.idFrom = idFrom;
    return { kind: 'external', ref: `${entity}.${field}` };
  };

  const steps = input.plan.steps.map((step, index) =>
    stepFacts(input, step, input.params[index] ?? [], readExternal, problems),
  );
  const expectedKeys = expectedKeysOf(input.params, readExternal, input.plan.steps);
  // 計算の材料は**ほかの事実を全部積んだあと**に積む。読み取りの器は 1 集約 1 つなので、
  // 先に積むと「材料がその集約の器を作った」ことになり、ガードやロールの読み取りが
  // 材料の都合で並び替わる。材料は既にある器に欄を足すだけにしておく。
  for (const step of input.plan.steps) {
    for (const path of step.computeReads) computeReadFact(input, step, path, readExternal);
  }
  const result = resultPlanOf(input, problems);
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    facts: {
      reads: orderedReads(reads),
      expectedKeys,
      steps,
      invariantHooks: invariantHooksOf(input.plan, input.domain),
      result,
    },
  };
}

/** 1 手順ぶんの事実(ガード変数・文脈ロール・入力欄)。 */
function stepFacts(
  input: FactsInput,
  step: SaveStepPlan,
  params: readonly ResolvedParam[],
  readExternal: (step: SaveStepPlan, entity: string, field: string) => UsecaseFactSource | null,
  problems: PlanProblem[],
): UsecaseStepFacts {
  const guardFacts: UsecaseGuardFact[] = [];
  for (const variable of collectGuardPaths(input.domain, input.guards, step)) {
    const source = variableSource(input, step, variable, readExternal, problems);
    if (source !== null) guardFacts.push({ variable, source });
  }
  const roleFacts: UsecaseRoleFact[] = [];
  const claimFacts: UsecaseClaimFact[] = [];
  const roles = rolesOf(input.domain, step);
  const unresolvableRoles = roles.filter((role) => !isResolvableRole(input.domain, role));
  // 1 つも立たない手順は「誰も通れない保存点」である —— 黙って forbidden にせず仕様の問題として止める。
  if (roles.length > 0 && unresolvableRoles.length === roles.length) {
    problems.push(noResolvableRole(input.plan, step, roles));
  }
  for (const role of roles) {
    // 実行者自身の行の欄が根拠のロールは、セッションの profile から立つ(束 ⑰ 設計 §4)。
    const claim = roleClaimOf(input.domain, role);
    if (claim !== null) {
      claimFacts.push(claim.values === null ? { role, field: claim.field } : { role, field: claim.field, values: claim.values });
      continue;
    }
    const binding = roleBindingOf(input.domain, role);
    if (binding === null) continue; // グローバルロールは実行者の素性から解決される。
    if (binding.problem) {
      problems.push(unsupportedBinding(input.plan, step, role));
      continue;
    }
    const source = variableSource(input, step, `${binding.entity}.${binding.field}`, readExternal, problems);
    if (source !== null) roleFacts.push({ role, source });
  }
  return {
    stateFrom: stateFromOf(input, step, readExternal, problems),
    guardFacts,
    roleFacts,
    claimFacts,
    ...gatesOf(input.domain, roles),
    unresolvableRoles,
    inputKeys: inputKeysOf(params),
  };
}

/** 遷移の遷移元の状態の供給元(作成では null。状態列が無ければ Y10 のエラー)。 */
function stateFromOf(
  input: FactsInput,
  step: SaveStepPlan,
  readExternal: (step: SaveStepPlan, entity: string, field: string) => UsecaseFactSource | null,
  problems: PlanProblem[],
): UsecaseFactSource | null {
  if (step.kind !== 'transition') return null;
  const field = stateFieldOf(input.domain, step.entity, step.machine?.machine ?? null);
  if (field === null) {
    problems.push(ungroundedPath(input.plan, step, `${step.entity}.state`));
    return null;
  }
  return variableSource(input, step, `${step.entity}.${field.name}`, readExternal, problems);
}

/** `{entity}.{field}` 形のパス 1 本の供給元(予測 / 入力 / 実行者 / 外部 / 判断時刻)。 */
function variableSource(
  input: FactsInput,
  step: SaveStepPlan,
  variable: string,
  readExternal: (step: SaveStepPlan, entity: string, field: string) => UsecaseFactSource | null,
  problems: PlanProblem[],
): UsecaseFactSource | null {
  if (variable === NOW) return { kind: 'now' };
  const [head, ...rest] = variable.split('.');
  if (head === ACTOR) return actorSource(input, step, rest.join('.'), problems);
  // 接頭辞の無いパスは**対象自身の列**である(access_spec の `when: state == draft` がその形)。
  // エンジンは生のパスを鍵に環境を引くので、鍵(`variable`)はそのまま・供給元だけを接地させる。
  // `context` の連鎖(2 段。`{起点}.{中継}.{相手}.{欄}`)は、**最後の段のエンティティの
  // 1 欄**を指している。途中の段は「その行をどの id で読むか」を決めるための経路であり、
  // 読む予約は `readIdSourceOf` が段ごとに積む(FactReader が段の数だけ読む)。
  const entity = rest.length === 0 ? step.entity : entityOf(input.domain, rest.length === 1 ? (head ?? '') : (rest[rest.length - 2] ?? ''));
  const field = rest.length === 0 ? (head ?? '') : (rest[rest.length - 1] ?? '');
  if (entity === null || field === '') {
    problems.push(ungroundedPath(input.plan, step, variable));
    return null;
  }
  // **これから作る行自身**の欄をガードが見ることがある(テナント境界の
  // `{対象}.{テナント列} == actor.{欄}` がその形)。その値は読み取りではなく、この手順の
  // 入力にある —— `createdRef` は「自分より前の手順」しか見ないので、ここで先に畳む。
  if (step.kind === 'create' && entity === step.entity) {
    return insideSource(input, step, entity, field, step.index, problems);
  }
  const created = createdRef(input.plan, step, entity);
  if (created.kind === 'repeatOnly') {
    problems.push(repeatOnlyReference(input.plan, step, entity, created));
    return null;
  }
  if (created.kind === 'none') return readExternal(step, entity, field);
  return insideSource(input, step, entity, field, created.index, problems);
}

/**
 * 実行者を指すパス(`actor.{欄}`)の供給元。
 *
 * `actor.id` は実行者の id そのもの。それ以外は **`session: true` を宣言した欄**
 * (V2 が接地を見ている)であり、**セッションの profile から読む** —— `claim` とまったく
 * 同じ経路であり、DB は 1 行も読まない。
 *
 * **実行者の集約の行を読む形に畳んではならない。** 読みの予約は集約ごとに 1 つで、その id は
 * 「この計画が書き換える行を入力から指せるならそれ」(`targetRowIdSourceOf`)が先に立つ。
 * したがって実行者の集約がその計画の対象でもあると、`actor.{欄}` は**入力が名指した行**から
 * 読まれ、`{対象}.{列} == actor.{列}` が黙って恒真になる(束 ⑲-2a レビューが実測)。
 * 実行者の属性と対象の行の属性は**別の事実**なので、供給元も別にする。
 *
 * セッションに載る欄でなければ決まらないので Y10 の問題として積む —— 黙って id で埋める枝や、
 * 行を読んで代わりにする枝は持たない。
 */
function actorSource(
  input: FactsInput,
  step: SaveStepPlan,
  field: string,
  problems: PlanProblem[],
): UsecaseFactSource | null {
  if (field === ACTOR_ID_FIELD) return { kind: 'actor' };
  if (!actorFields(input.domain).has(field)) {
    problems.push(ungroundedPath(input.plan, step, `${ACTOR}.${field}`));
    return null;
  }
  return { kind: 'session', field };
}

/** 保存点の中で作った集約の 1 欄(予測状態 / 実行者 / 入力)。 */
function insideSource(
  input: FactsInput,
  step: SaveStepPlan,
  entity: string,
  field: string,
  created: number,
  problems: PlanProblem[],
): UsecaseFactSource | null {
  const creator = input.plan.steps[created];
  const def = findField(input.domain, entity, field);
  if (creator === undefined || def === null) {
    problems.push(ungroundedPath(input.plan, step, `${entity}.${field}`));
    return null;
  }
  if (def.type.kind === 'state') {
    const predicted = predictState(input.plan, step, input.domain, entity, def);
    if (predicted !== null) return { kind: 'predicted', value: predicted };
  }
  if (creatorSource(input, creator, def)?.kind === 'actor') return { kind: 'actor' };
  if (creator.inputFields.includes(field)) return { kind: 'input', step: created, field };
  problems.push(ungroundedPath(input.plan, step, `${entity}.${field}`));
  return null;
}

/**
 * その作成手順が、この欄の引数をどこから供給するか(実行計画の引数と同じ答え。決まらなければ null)。
 *
 * **判定は `param-source-fields.ts` の出どころの許可表と `originSource` をそのまま呼ぶ** —— 同じ 1 つの事実
 * (この欄は実行者そのもので埋まるか)を 2 か所で違うふうに読まない。実行者で埋まるのは「自分として」の宣言
 * (`defaults.self`)と、action_spec の `owner` で明示した持ち主の欄だけである。以前はここだけに「必須で入力に無い
 * 実行者への参照は作成者」の推測が残り(点検 10 回目 A10-3。9 回目に計画の側からは無くした推測)、`computes` で決まる
 * 欄も実行者と読んで、後の手順の binding / ガードの予測が DB の判定とずれた。計算値の欄は呼び手が接地できない道(Y10)として止める。
 */
function creatorSource(input: FactsInput, creator: SaveStepPlan, field: FieldDef): ParamSource | null {
  const allowed = allowedOrigins(input.plan, creator);
  for (const origin of ORIGIN_ORDER) {
    if (!allowed.includes(origin)) continue;
    const source = originSource(origin, field, input.plan, creator, input.domain);
    if (source !== null) return source;
  }
  return null;
}

/** ガード式が予約語として認める「判断時刻」と「実行者」。 */
const NOW = 'now';
const ACTOR = 'actor';

/** `actor` の後ろの、同一性を指す 1 語(これだけは行を読まずに実行者の id で埋まる)。 */
const ACTOR_ID_FIELD = 'id';

// 型は plan-facts-types.ts、補助(ガード式のパス収集・ロールの読み取り・不変条件の引き当て・
// Y10 の反例)は plan-facts-parts.ts にある。
export type * from './plan-facts-types.js';
