/**
 * `permit` が要る事実を**仕様から拾い出す**部分(plan-facts.ts が使う)。
 *
 * 持つのは「その手順のガード式に現れる変数はどれか」「そのロールの binding はどの欄を指すか」
 * 「保存点を通り終えた時点の状態は何か」という**仕様への問い合わせ**だけで、結果をどの事実の
 * 供給元に使うかの判断は持たない(それは plan-facts.ts と plan-facts-reads.ts が決める)。
 */

import { ACTOR_ID_VARIABLE, boundFieldsOfCreate } from './actor-bound.js';
import type { FieldDef, SpecModel } from '../model/types.js';
import type { GuardExpr, GuardServices } from '../guard/ast.js';
import type { ResolvedParam } from './param-source.js';
import type { SavePlan, SaveStepPlan } from './step-plan.js';
import { createdRef, initialOf, stateFieldOf } from './param-source-facts.js';
import { claimPartsOf } from '../model/role-claim.js';

/**
 * 保存点を通り終えた時点の予測状態(状態フィールドを持たない集約なら null)。
 *
 * 作った手順で initial に、その行の遷移で `to` に動く —— 下の `predictState` と同じ規則を、
 * **最後の手順まで含めて**適用したものである(どの行の話かの見分け方もそちらと同じ)。
 *
 * @param domain ドメイン仕様
 * @param plan 接地済みの保存点
 * @param entity 結末の集約のエンティティ名
 * @returns 予測した最終状態(状態フィールドを持たない集約なら null)
 */
export function finalStateOf(domain: SpecModel, plan: SavePlan, entity: string): string | null {
  // 単発の遷移では、動かす機械を**その手順が宣言している**。既定の `state` 列の機械だけを見ると、
  // 1 つの集約が直交する 2 つの状態機械を持つとき(催しの進行と掲載)、もう一方の機械の遷移が
  // 「状態を動かさない」に見える —— 束 ⑰-2 の切り替えで実測した(掲載の結末が null になった)。
  const single = plan.single ? plan.steps[0] : undefined;
  if (single !== undefined && single.kind === 'transition') return single.event?.to ?? null;
  const field = stateFieldOf(domain, entity);
  if (field === null) return null;
  const machine = field.type.kind === 'state' ? field.type.machine : null;
  // 結末の行 = この保存点が作るなら最初の「繰り返さない作成」、作らないなら外から来た行。
  const born = plan.steps.find((step) => step.kind === 'create' && !step.repeat && step.entity === entity)?.index ?? -1;
  let predicted: string | null = null;
  for (const step of plan.steps) {
    if (step.entity !== entity) continue;
    if (step.kind === 'create') {
      if (step.index === born) predicted = initialOf(domain, machine);
      continue;
    }
    if (step.index > born && step.machine?.machine === machine) predicted = step.event?.to ?? predicted;
  }
  return predicted;
}

/**
 * その手順の時点でのその集約の状態を仕様から予測する。
 *
 * その行に起きた遷移が最後に置いた `to` を優先し、無ければ生まれたときの `initial`。どちらでも
 * ない(外から来て動かしてもいない行)なら null =「呼び側が読んだ値を使う」。
 *
 * **予測は集約ではなく「その手順が指している行」に対して行う**(束⑯g)。同じ集約を複数の
 * 手順で作れる(別名 `as`)ので、集約の名前だけで走査すると別の行の生成・遷移を拾う。指して
 * いる行は `createdRef` と同じ規則(直前の、繰り返さない作成)で決まる。
 *
 * @param field 見る状態フィールド(集約が複数の直交した状態軸を持つので、軸まで指定して引く)
 */
export function predictState(
  plan: SavePlan,
  step: SaveStepPlan,
  domain: SpecModel,
  entity: string,
  field: FieldDef,
): string | null {
  // 単発の操作には「まだ書いていない先行手順」が無いので、予測するものが無い ——
  // 読んだ値が実際の状態そのものである(束 ⑰ 設計 §2)。
  if (plan.single) return null;
  const machine = field.type.kind === 'state' ? field.type.machine : null;
  const created = createdRef(plan, step, entity);
  // その行が生まれた手順(保存点の外から来た行は -1 = 生まれを持たない)。
  const born = created.kind === 'none' ? -1 : created.index;
  let predicted: string | null = null;
  for (const candidate of plan.steps) {
    if (candidate.index >= step.index) break;
    if (candidate.entity !== entity) continue;
    // 別の行を作る手順は、この行の状態を動かさない(集約で走査すると初期状態に戻してしまう)。
    if (candidate.kind === 'create') {
      if (candidate.index === born) predicted = initialOf(domain, machine);
      continue;
    }
    if (candidate.index > born && candidate.machine?.machine === machine) {
      predicted = candidate.event?.to ?? predicted;
    }
  }
  return predicted;
}

/**
 * そのロールが**保存点の経路で立つ**か。
 *
 * 立つのは 3 種類だけである ——(1)`kind` を持つグローバルロール(未ログイン / 認証ユーザーの
 * 既定 / システム。セッションから立つ)(2)`binding` を持つ文脈ロール(計画が供給元を持つ)
 * (3)`claim` を持つグローバルロール(実行者自身の行の欄。セッションの profile から立つ。束 ⑰)。
 * どれも持たないロールは、機械可読な根拠が仕様に無いので実行器が立てられない —— 仕組み側が
 * 「その属性を読めばよい」と勝手に知ることは「軸は仕組み・語はアプリ」を破る
 * (dsl-extension-triage.md §軸と語)。
 *
 * @param domain ドメイン仕様
 * @param role ロール ID
 * @returns 立つなら true(未知のロール ID は Y1 が別に落とすので、ここでは立たない扱い)
 */
export function isResolvableRole(domain: SpecModel, role: string): boolean {
  const def = domain.roles.roles.find((candidate) => candidate.id === role);
  if (def === undefined) return false;
  return def.kind !== undefined || def.binding !== undefined || def.claim !== undefined;
}

/** `claim` が根拠のロールが指す、実行者自身の行の欄と条件。 */
export interface RoleClaim {
  readonly entity: string;
  readonly field: string;
  /** 値の集合(state / enum の欄)。boolean の欄(従来の形)なら `null`。 */
  readonly values: readonly string[] | null;
}

/**
 * そのロールの `claim` が指す欄(`{entity}.{field}` を分けたもの)と値の集合。`claim` が根拠でなければ null。
 *
 * 実行器はこの欄名でセッションの profile(`SessionProfile`)を引く —— 集約名は使わない
 * (`session: true` は 1 集約に閉じているので、欄名だけで一意である。V13)。
 *
 * **`kind` を併記したロール(既定のログインロール)は null を返す。** そのロールの根拠は
 * 「ログインしていること(実行者の行がある)」であり、`claim` はそれに足す条件である
 * (実行時は `RoleTables.authenticatedWhen`・DB は `配列の照合 AND 行の条件`)。`claim` だけを根拠にする
 * ロールと同じ口で扱うと、配列に無い実行者にもロールが立ってしまう(ADR-0018)。
 *
 * @param domain ドメイン仕様
 * @param role ロール ID
 * @returns 欄の集約名・欄名・値の集合。`claim` だけが根拠でないロールなら null
 */
export function roleClaimOf(domain: SpecModel, role: string): RoleClaim | null {
  const def = domain.roles.roles.find((candidate) => candidate.id === role);
  if (def === undefined || def.kind !== undefined) return null;
  const parts = claimPartsOf(def);
  return parts === null ? null : { entity: parts.entity, field: parts.field, values: parts.values };
}

/** binding の右辺に置ける唯一のパス。 */
const ACTOR_ID = 'actor.id';

/**
 * その手順の `permit` が評価するガード式に現れる、変数(パス)の一覧。
 *
 * 作成は `creates[].when` の**全規則ぶん**と、規則の縛り(実行者の参照の欄 + `actor.id`)を集める —— 実行者がどのロールで通るかは
 * 実行時にしか決まらないので、環境にはどの規則の変数も載っていなければならない
 * (載っていない変数があると `canCreate` が `guard_unknown` を返す)。遷移はそのイベントの
 * ガード 1 本だけである。
 *
 * @param domain ドメイン仕様
 * @param guards ガード式のパース(`when` / `guard` は生文字列で持たれている)
 * @param step 接地済みの手順
 * @returns 変数(ドット区切りのパス)。重複なし・出現順
 */
export function collectGuardPaths(
  domain: SpecModel,
  guards: GuardServices,
  step: SaveStepPlan,
): readonly string[] {
  const sources = step.kind === 'transition' ? [step.event?.guard] : accessWhens(domain, step);
  const paths: string[] = [];
  for (const source of sources) {
    if (source === undefined) continue;
    const parsed = guards.parse(source);
    if (!parsed.ok) continue; // パース不能は V1 / V2 が先に落とす。
    for (const path of guards.collectPaths(parsed.expr)) paths.push(path.segments.join('.'));
  }
  // 作成の規則の縛り(`self`)が読む変数(縛られる欄と実行者の id。engine は `by` の段で見る。actor-bound.ts)。
  if (step.kind === 'create') {
    const bound = boundFieldsOfCreate(domain, step.entity, step.inputFields);
    if (bound.length > 0) paths.push(...bound.map((field) => `${step.entity}.${field.name}`), ACTOR_ID_VARIABLE);
  }
  return [...new Set(paths)];
}

/**
 * その手順の access_spec の規則が持つガード式の生文字列(条件の無い規則は現れない)。
 *
 * **形ごとに見る規則が違う** —— 作成は `creates`、削除は `deletes`、編集は `writes` である。
 * 遷移はイベントのガード 1 本なので呼び側が先に分岐している。
 */
function accessWhens(domain: SpecModel, step: SaveStepPlan): readonly (string | undefined)[] {
  return accessRules(domain, step).map((rule) => rule.when);
}

/** その手順の形に対応する access_spec の規則(作成 / 削除 / 編集)。 */
function accessRules(
  domain: SpecModel,
  step: SaveStepPlan,
): readonly { readonly by: string; readonly when?: string }[] {
  for (const specs of domain.aggregates.values()) {
    const access = specs.access;
    if (access?.entity !== step.entity) continue;
    if (step.kind === 'delete') return access.deletes;
    if (step.kind === 'update') return access.writes;
    return access.creates;
  }
  return [];
}

/** 文脈ロールの binding の読み取り結果。 */
export type RoleBinding =
  | { readonly problem: false; readonly entity: string; readonly field: string }
  /** binding はあるが `{entity}.{field} == actor.id` の形ではない。 */
  | { readonly problem: true };

/**
 * ロールの binding を「どの集約のどの欄が実行者と一致するか」に読む。
 *
 * @param domain ドメイン仕様
 * @param role ロール ID
 * @returns グローバルロール(binding 無し)なら null。読めた形か、形が違う旨
 */
export function roleBindingOf(domain: SpecModel, role: string): RoleBinding | null {
  const def = domain.roles.roles.find((candidate) => candidate.id === role);
  if (def?.binding === undefined) return null;
  const target = actorEqualityPath(def.binding);
  if (target === null) return { problem: true };
  return target;
}

/** `{entity}.{field} == actor.id` の 1 本だけを、集約と欄に分ける(それ以外は null)。 */
function actorEqualityPath(source: string): { readonly problem: false; readonly entity: string; readonly field: string } | null {
  // binding はガード式と同じ文法だが、ここで要るのは「左辺の 2 セグメント」だけであり、
  // パーサーを起こさずに読める形に限る(読めない形は呼び側が Y10 として止める)。
  const [left, right] = source.split('==').map((part) => part.trim());
  if (left === undefined || right !== ACTOR_ID) return null;
  const segments = left.split('.');
  if (segments.length !== 2) return null;
  const [entity, field] = segments;
  if (entity === undefined || field === undefined || entity === '' || field === '') return null;
  return { problem: false, entity, field };
}

/**
 * 保存点が触る集約の集合(手順のエンティティの和)。
 *
 * @param steps 接地済みの手順
 * @returns エンティティ名の集合
 */
export function saveEntities(steps: readonly SaveStepPlan[]): ReadonlySet<string> {
  return new Set(steps.map((step) => step.entity));
}

/**
 * その手順が認めるロール(遷移はイベントの宣言、それ以外は access_spec の規則の集合)。
 *
 * **形ごとに見る規則が違う** —— 作成は `creates`、削除は `deletes`、編集は `writes` である
 * (どの形でも `creates` を見ていた間、削除・編集の計画は作成のロールで判断していた)。
 */
export function rolesOf(domain: SpecModel, step: SaveStepPlan): readonly string[] {
  if (step.kind === 'transition') return step.event?.by ?? [];
  return [...new Set(accessRules(domain, step).map((rule) => rule.by))];
}

/** 入力から受け取る欄(解決済み引数から拾う。宣言順・重複なし)。 */
export function inputKeysOf(params: readonly ResolvedParam[]): readonly string[] {
  const keys: string[] = [];
  for (const param of params) {
    if (param.source.kind === 'input_field') keys.push(param.source.field);
    if (param.source.kind === 'input_target_id') keys.push('id');
    if (param.source.kind === 'input_values') keys.push(...param.source.fields.map((field) => field.name));
    if (param.source.kind === 'input_changes') keys.push(...param.source.fields.map((field) => field.name));
  }
  // 計算値(`computed`)は入力に現れない —— それが `computes` の意味の全部である。
  return [...new Set(keys)];
}

/**
 * 適用が要る application 執行の不変条件 ID。
 *
 * 母集合は「`application` の執行点を持ち、かつ **この保存点の手順そのもの**を
 * `guard` の執行点として宣言している」不変条件である。複合 RPC はその手順の operation を
 * 通らないので、宣言された執行点をここで実行し直さないと執行が消える。逆に、この保存点の
 * 手順を執行点として宣言していない不変条件(別の操作で守るもの)はこの保存点の責務ではない。
 */
export function invariantHooksOf(plan: SavePlan, domain: SpecModel): readonly string[] {
  const ops = new Set(plan.steps.map((step) => step.op));
  const ids: string[] = [];
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      const hasApplication = invariant.enforcedBy.some((enforcement) => enforcement.kind === 'application');
      const atStep = invariant.enforcedBy.some(
        (enforcement) => enforcement.kind === 'guard' && ops.has(enforcement.ref),
      );
      if (hasApplication && atStep) ids.push(invariant.id);
    }
  }
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/** ガード式(パース済み)の型の再輸出(呼び側が guard/ast.js を直接見ないため)。 */
export type { GuardExpr };

// 反例(Y10 の 3 点セット)は plan-facts-problems.ts にある。
export { noResolvableRole, ungroundedPath, unreadable, unsupportedBinding } from './plan-facts-problems.js';
