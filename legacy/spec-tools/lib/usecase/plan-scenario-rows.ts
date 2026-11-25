/**
 * plan-scenario.ts が使う、**場面の材料**(固定の id・読む行の型・場面を組むための `ScenarioContext`)。
 *
 * 実行計画 1 本から、場面を組み立てるのに要るもの —— 読む行・ガード式の変数・権限規則・ロールを
 * 立てる手 —— を取り出す(`contextOf`)。行と入力に具体化するのは plan-scenario-materialize.ts である。
 */

import type { EventDef, SpecModel } from '../model/types.js';
import type { FieldType } from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import { findField } from '../semantics/domain-index.js';
import { actorEntity } from './param-source-facts.js';
import type { BuiltOperation } from './operation-plan.js';
import type { StepKind } from './step-plan.js';
import type { UsecaseRead } from './plan-facts-types.js';
import type { FieldBounds } from './field-bounds.js';
import { boundsOf } from './field-bounds.js';
import type { Assignment, ScenarioValue } from './plan-scenario-values.js';
import { SCENARIO_NOW } from './plan-scenario-values.js';
import { OPERATION_VERBS, operationSubject } from '../messages/messages.js';
import { selfFieldsByRole } from './actor-bound.js';

/** 成功する実行者の id。 */
export const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

/**
 * **実行者ではない誰か**の id(成立させたくないロールの根拠になる列に載せる値)。
 *
 * 拒否される実行者(`DENIED_ID`)とは別の値でなければならない —— 同じにすると
 * 「ロールが立たないはずの実行者」に文脈ロールが立ってしまい、権限の拒否の場面が
 * 成立しない(実測: 28 操作で成功に化けた)。
 */
export const OTHER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

/** ロールが 1 つも立たない実行者の id(権限の拒否の場面の主役)。 */
export const DENIED_ID = '99999999-9999-4999-8999-999999999999';

/** 操作の対象になる行の id(集約ごとに連番で振る)。 */
export const TARGET_ID = 'dddddddd-0000-4000-8000-000000000001';

/** 読んだ行 1 つ(fake の `FactReader` が `表:id` で引く)。 */
export interface ScenarioRow {
  readonly table: string;
  readonly id: string;
  readonly values: Readonly<Record<string, ScenarioValue>>;
}

/** ガード式の変数 1 本と、その値が載る列。 */
export interface ScenarioVariableRef {
  readonly key: string;
  /** `{entity}.{列}`(読んだ行の鍵)。 */
  readonly ref: string;
  readonly type: FieldType | null;
  /** `state(...)` 型のときの状態の全集合。 */
  readonly states: readonly string[];
  /**
   * その欄が宣言した値の範囲(`min` / `max`)。
   *
   * **候補を切るために要る。** 種(式の数値リテラル)から `seed - 1` を作る規則は、
   * `min: 0` の欄で `-1` を候補にしてしまい、entity_spec から導出した CHECK
   * (`{表}_{列}_range`)に当たる —— 下限 0 の金額の欄で実測した
   * (束 ③-2。engine は許可するのに DB が 23514 で落ちるので、一致の証明が赤になる)。
   */
  readonly bounds: FieldBounds;
}

/** 実行者の属性の変数 1 本(ガード式のパスと、セッションの欄)。 */
export interface ScenarioSessionVariable extends ScenarioVariableRef {
  /** セッションの欄の名前(`actor.{欄}` の `{欄}`)。 */
  readonly field: string;
}

/** 権限規則 1 本(作成 / 削除 / 編集に共通の形)。 */
export interface ScenarioRule {
  readonly by: string;
  readonly when?: string;
  readonly fields: readonly string[];
}

/** 場面を組み立てるための、計画から取り出した materials。 */
export interface ScenarioContext {
  readonly op: string;
  /** テスト名に出る主語(遷移はイベントの label、それ以外は「{集約の label}の{作成/削除/編集}」)。 */
  readonly label: string;
  readonly kind: StepKind;
  /** 結末の id が入力から決まるなら、その欄(冪等キーなら null)。 */
  readonly resultIdField: string | null;
  readonly entity: string;
  /** 遷移なら state_spec のイベント宣言そのもの(遷移でなければ null)。 */
  readonly event: EventDef | null;
  readonly domain: SpecModel;
  readonly reads: readonly UsecaseRead[];
  readonly allowedRoles: readonly string[];
  readonly guardSource: string | null;
  readonly variables: readonly ScenarioVariableRef[];
  /**
   * ガード式の**実行者の属性**(`actor.{欄}`。供給元はセッション)の変数。`ref` は実行者の集約の欄(`{実行者の集約}.{欄}`)。
   *
   * 対象の行の列とは別の事実である(`plan-facts-types.ts` の `session`)。値は行ではなく**セッションの欄**に置く
   * (`sessionClaimsOf`)—— テナント境界のガード(`{集約}.company_id == actor.company_id`)の成功と拒否の場面を、
   * 行の値とセッションの値の組で作れるようにするためである(以前は解けずに場面が 1 つも作られなかった)。
   */
  readonly sessionVariables: readonly ScenarioSessionVariable[];
  /** 予約語 `now` の割当(固定の現在時刻)。 */
  readonly nowVariables: Assignment;
  /** 遷移元の状態が載る列と、その値をガード式も見るか。 */
  readonly stateVariable: { readonly key: string; readonly ref: string; readonly inGuard: boolean } | null;
  readonly fromStates: readonly string[];
  readonly outsideStates: readonly string[];
  readonly resultState: string | null;
  readonly claimFields: readonly string[];
  /** `claim` で立つロール(手順が認めるもの。宣言順)。 */
  readonly claimRoles: readonly string[];
  /** 不変条件違反の場面で RPC が返す不変条件 ID。 */
  readonly invariant: string | null;
  /** ロール ID → その根拠になる列(`{entity}.{列}`)。 */
  readonly roleRefs: ReadonlyMap<string, string>;
  readonly inputKeys: readonly string[];
  readonly rules: readonly ScenarioRule[];
  /**
   * 作成の規則ごとの「実行者そのものと一致しなければならない変数」(`self`。ロール → `{集約}.{欄}`)。成功の場面は、成立させるロールの
   * この欄の入力に実行者の id を載せる(載せないとエンジンが規則を当てはめず、成功の場面が forbidden になる。題材 library の生成テストを
   * 実行して見つかった。fix27 A2)。
   */
  readonly selfRefs: ReadonlyMap<string, readonly string[]>;
  readonly rpc: string;
}

/** 計画 1 本から場面の materials を取り出す。 */
export function contextOf(
  operation: BuiltOperation,
  domain: SpecModel,
  _guards: GuardServices,
): ScenarioContext {
  const step = operation.plan.steps[0];
  const facts = operation.facts.steps[0];
  if (step === undefined || facts === undefined) throw new Error('手順を持たない計画は組み立てられません');
  const machineStates = step.machine?.states ?? [];
  const from = step.event?.from ?? [];
  const stateRef = facts.stateFrom?.kind === 'external' ? facts.stateFrom.ref : null;
  const variables = facts.guardFacts
    .filter((fact) => fact.source.kind === 'external')
    .map((fact) => variableOf(domain, fact.variable, fact.source.kind === 'external' ? fact.source.ref : ''));
  const inGuard = variables.find((variable) => variable.ref === stateRef);
  const actor = actorEntity(domain);
  const sessionVariables = facts.guardFacts.flatMap((fact): ScenarioSessionVariable[] => {
    if (fact.source.kind !== 'session' || actor === null) return [];
    return [{ ...variableOf(domain, fact.variable, `${actor}.${fact.source.field}`), field: fact.source.field }];
  });
  return {
    op: operation.op,
    label: subjectOf(step.kind, step.label),
    kind: step.kind,
    resultIdField: operation.facts.result.idFrom.kind === 'input' ? operation.facts.result.idFrom.field : null,
    entity: step.entity,
    event: step.event,
    domain,
    reads: operation.facts.reads,
    allowedRoles: rolesOfStep(domain, step.kind, step.entity, step.event?.by ?? []),
    guardSource: step.event?.guard ?? null,
    variables,
    sessionVariables,
    nowVariables: Object.fromEntries(
      facts.guardFacts.filter((fact) => fact.source.kind === 'now').map((fact) => [fact.variable, SCENARIO_NOW]),
    ),
    stateVariable:
      stateRef === null
        ? null
        : { key: inGuard?.key ?? `#${stateRef}`, ref: stateRef, inGuard: inGuard !== undefined },
    fromStates: from,
    outsideStates: machineStates.filter((state) => !from.includes(state)),
    resultState: operation.facts.result.state,
    claimFields: facts.claimFacts.map((claim) => claim.field),
    claimRoles: facts.claimFacts.map((claim) => claim.role),
    invariant: invariantOf(domain, step.entity),
    roleRefs: new Map(
      facts.roleFacts
        .filter((fact) => fact.source.kind === 'external')
        .map((fact) => [fact.role, fact.source.kind === 'external' ? fact.source.ref : '']),
    ),
    inputKeys: facts.inputKeys,
    rules: accessRules(domain, step.kind, step.entity),
    selfRefs: step.kind === 'create' ? selfFieldsByRole(domain, step.entity, facts.inputKeys) : new Map(),
    rpc: operation.plan.rpcName,
  };
}

/** テスト名の主語(動作の名前の正は文言表。遷移はイベントの label が既に動作を示している)。 */
function subjectOf(kind: StepKind, label: string): string {
  return kind === 'transition' ? label : operationSubject(label, OPERATION_VERBS[kind]);
}

/** ガード式の変数 1 本を、値の候補が作れる形にする。 */
function variableOf(domain: SpecModel, key: string, ref: string): ScenarioVariableRef {
  const [entity, field] = ref.split('.');
  const def = entity === undefined || field === undefined ? null : findField(domain, entity, field);
  const type = def?.type ?? null;
  const states = type?.kind === 'state' ? statesOf(domain, type.machine) : [];
  return { key, ref, type, states, bounds: boundsOf(def) };
}

/** 状態機械の状態の全集合。 */
function statesOf(domain: SpecModel, machine: string): readonly string[] {
  for (const specs of domain.aggregates.values()) {
    for (const spec of specs.stateMachines) {
      if (spec.machine === machine) return spec.states;
    }
  }
  return [];
}

/** その操作を許すロール(遷移はイベントの `by`、それ以外は規則の `by` の和)。 */
function rolesOfStep(
  domain: SpecModel,
  kind: StepKind,
  entity: string,
  by: readonly string[],
): readonly string[] {
  if (kind === 'transition') return by;
  return [...new Set(accessRules(domain, kind, entity).map((rule) => rule.by))];
}

/** 形に対応する access_spec の規則(作成 / 削除 / 編集)。 */
function accessRules(domain: SpecModel, kind: StepKind, entity: string): readonly ScenarioRule[] {
  for (const specs of domain.aggregates.values()) {
    const access = specs.access;
    if (access?.entity !== entity) continue;
    if (kind === 'delete') return access.deletes.map((rule) => ({ ...rule, fields: [] }));
    if (kind === 'update') return access.writes;
    if (kind === 'create') return access.creates.map((rule) => ({ ...rule, fields: [] }));
  }
  return [];
}

/**
 * **RPC が実際に返しうる**不変条件を 1 つ(不変条件違反の場面が載せる ID)。
 *
 * 引き方は A7 が `invariant` の義務を配るときと同じである(`invariantsEnforcedOn`)——
 * **自分の集約の invariant_spec に書かれていて、執行点が DB 側(`db_constraint` / `trigger`)の
 * もの**だけを見る。RPC が返せない ID を載せる場面は**反実仮想**であり、確かめているのは
 * 「fake が返した文字列がそのまま返ること」だけになる。それでいて action_spec の
 * `test_cases` には `spec_ids: [その ID]` と出るので、**仕様が「この不変条件を守っている
 * テストがある」と嘘をつく**(A8 は実在しか見ない。独立レビュー 1-A)。
 *
 * 該当が無ければ `null` を返し、場面そのものを作らない —— そのとき A7 が「不変条件の
 * 宣言が足りない」と鳴るのが正しい姿である(義務の引きが同じなので、両者はずれない)。
 */
function invariantOf(domain: SpecModel, entity: string): string | null {
  for (const specs of domain.aggregates.values()) {
    if (specs.access?.entity !== entity) continue;
    for (const invariant of specs.invariants?.invariants ?? []) {
      if (!(invariant.entities ?? []).includes(entity)) continue;
      const byDb = invariant.enforcedBy.some(
        (enforcement) => enforcement.kind === 'db_constraint' || enforcement.kind === 'trigger',
      );
      if (byDb) return invariant.id;
    }
  }
  return null;
}

/** そのロールに効く規則(宣言順)。 */
export function accessRulesOf(ctx: ScenarioContext, role: string): readonly ScenarioRule[] {
  return ctx.rules.filter((rule) => rule.by === role);
}

/**
 * 解いた割当のうち、実行者の属性の変数の値をセッションの欄に写す(行に置けない値 = 空は写さない)。
 *
 * @param ctx 場面の materials
 * @param env 解いた割当
 * @returns セッションの欄 → 値
 */
export function sessionClaimsOf(ctx: ScenarioContext, env: Assignment): Readonly<Record<string, string | boolean>> {
  const claims: Record<string, string | boolean> = {};
  for (const variable of ctx.sessionVariables) {
    const value = env[variable.key];
    if (typeof value === 'string' || typeof value === 'boolean') claims[variable.field] = value;
    else if (typeof value === 'number') claims[variable.field] = String(value);
  }
  return claims;
}

/** 計画が列で立てられるロール(binding の根拠を持つもの)。 */
export function roleHolders(ctx: ScenarioContext): ReadonlySet<string> {
  return new Set(ctx.roleRefs.keys());
}
