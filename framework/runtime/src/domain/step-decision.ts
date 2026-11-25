/**
 * **形ごとの照会そのもの**（作成・遷移・削除・編集の 4 分岐。束 ⑳-5b-b）。
 *
 * 仕様: docs/rules/process/backend/system/standards/conventions/server-actions.md（5 形の定型）
 *       docs/rules/architecture/system/backend/ARCH-BE-0013-server-action-structure.md
 *
 * 「どの形がどの規則表をどう引くか」を写した関数が 2 つあると、その写し間違いがそのまま穴に
 * なる。読む相手は 3 つある。
 *
 *   1. 実行器（`operation/_template/run-plan-decide-core.ts`）
 *   2. 一致の証明の期待（`@kaninabe/runtime/testing/equivalence/oracle`）
 *   3. ハンドブックの結果表（`legacy/spec-tools/lib/results/`）
 *
 * 2 は infrastructure 層にあり、**operation 層の関数本体を呼べない**（ARCH-BE-0001 の依存
 * 方向）。3 つが同じ 1 本を読める置き場は domain 層だけなので、ここに置いてある。
 *
 * このファイルは**判断を持たない** —— 可否を決めるのはエンジンの表であり、ここがするのは
 * 「その形に対応する照会を選んで渡すこと」だけである。
 */

import type {
  CreateRejected,
  DeleteRejected,
  FireRejected,
  GuardEnv,
  WriteRejected,
} from '@kaninabe/runtime/engine';
import { canCreate, canDelete, canFire, canWrite } from '@kaninabe/runtime/engine';
import type { RunFactSource, RunRowCondition, RunStepPlan } from '@kaninabe/runtime/plan';

/** エンジンが返した拒否（形ごとに中身が違うので、形を見分ける `kind` を付けて運ぶ）。 */
export type StepRejection =
  | { readonly kind: 'transition'; readonly rejected: FireRejected }
  | { readonly kind: 'create'; readonly rejected: CreateRejected }
  | { readonly kind: 'delete'; readonly rejected: DeleteRejected }
  | { readonly kind: 'update'; readonly rejected: WriteRejected };

/** 形ごとの照会 1 回の結果（許可なら規則が宣言した副作用、拒否ならエンジンの診断そのもの）。 */
export type ShapeDecision =
  | { readonly allowed: true; readonly writeEffects: readonly string[] }
  | { readonly allowed: false; readonly rejection: StepRejection };

/** 許可（副作用なし）。 */
const ALLOWED: ShapeDecision = { allowed: true, writeEffects: [] };

/** 形ごとの照会 1 回に要るもの（判断の前の姿）。 */
export interface StepQuery {
  /**
   * 実行者に立ったロール。
   *
   * **閉包を取るかどうかは呼び側が決める** —— 実行器はセッションから解決した閉包を渡し、
   * 一致の証明は RPC が受け取る配列をそのまま渡す（空でありうる）。
   */
  readonly roles: readonly string[];
  /** ガード式の変数の割り当て。 */
  readonly env: GuardEnv;
  /** 遷移元の状態（遷移以外では使わない）。 */
  readonly state: string;
  /** 編集で動かす欄（編集以外・欄が決まらないときは null）。 */
  readonly field: string | null;
}

/**
 * **形ごとの照会そのもの**（このリポジトリで唯一の 4 分岐）。
 *
 * 実行器（`decideStepWith`）も、一致の証明の期待（`@kaninabe/runtime/testing/equivalence/oracle`）も、
 * ハンドブックの結果表も、可否を採るときはここを通る —— 「どの形がどの規則表をどう引くか」を
 * 写した関数が 2 つあると、その写し間違いがそのまま穴になる。
 *
 * 規則表を持たない形（誰も作れない集約・状態機械の無い手順）は許可を返す。それらは計画に
 * 置けないか、導出の段で止まっているものであり、ここで可否を決めているわけではない。
 *
 * @param step - その手順（規則表・遷移表を運ぶ）
 * @param query - 立ったロール・ガード変数・遷移元の状態・動かす欄
 * @returns 許可（編集は規則が宣言した副作用つき）または拒否（エンジンの診断つき）
 */
// #region example:operation-decide
export function decideShape(step: RunStepPlan, query: StepQuery): ShapeDecision {
  const context = { actorRoles: query.roles, env: query.env };
  if (step.kind === 'transition') {
    // 状態機械もイベントも無い遷移は計画として組み立てられない（導出の段で止まる）。
    if (step.machine === null || step.event === null) return ALLOWED;
    const decision = canFire(step.machine, { state: query.state, ...context }, step.event);
    return decision.allowed ? ALLOWED : { allowed: false, rejection: { kind: 'transition', rejected: decision } };
  }
  if (step.kind === 'create') {
    // 作成規則を持たない集約（誰も作れない）はそもそも計画に置けない（Y1 / A1 が見る）。
    if (step.createRules === null) return ALLOWED;
    const decision = canCreate(step.createRules, context);
    return decision.allowed ? ALLOWED : { allowed: false, rejection: { kind: 'create', rejected: decision } };
  }
  if (step.kind === 'delete') {
    if (step.deleteRules === null) return ALLOWED;
    const decision = canDelete(step.deleteRules, context);
    return decision.allowed ? ALLOWED : { allowed: false, rejection: { kind: 'delete', rejected: decision } };
  }
  if (step.writeRules === null || query.field === null) return ALLOWED;
  const decision = canWrite(step.writeRules, { field: query.field, ...context });
  if (!decision.allowed) return { allowed: false, rejection: { kind: 'update', rejected: decision } };
  return { allowed: true, writeEffects: decision.effects ?? [] };
}
// #endregion

/**
 * 実行者自身の行の条件(role_spec の `claim`。ADR-0018)がその行で成り立つか。
 *
 * boolean の欄(`values` が無い)は真であること、state / enum の欄は値の集合のどれかであること。
 * 欄が無い・型が合わない(boolean の欄が真偽でない・集合の欄が文字列でない)は成り立たない ——
 * DB の述語(`exists (… and a.{欄} in (…))`)が行の無い人や NULL の欄で偽になるのと同じ向きである。
 * 実行器(セッションの写し)と一致の証明(DB から読んだ行)が**同じ 1 本**を呼ぶ。
 *
 * @param condition 欄と値の集合
 * @param row 実行者自身の行(またはセッションの写し)。行が無い人は空
 * @returns 成り立つなら true
 */
export function rowConditionHolds(condition: RunRowCondition, row: Readonly<Record<string, unknown>>): boolean {
  const value = Object.hasOwn(row, condition.field) ? row[condition.field] : undefined;
  if (condition.values === undefined) return value === true;
  return typeof value === 'string' && condition.values.includes(value);
}

/**
 * **ロール配列**を出発点に、その手順で実行者に立つロールを数える（一致の証明・結果表の単発の形）。
 *
 * 実行器（`rolesOfWith`）との違いは出発点だけである —— あちらはセッションから解決した
 * グローバルロールから始め、ここは RPC が実際に受け取る配列（`p_actor_roles`）から始める。
 * DB は配列の中身をそのまま見るので、**閉じていない配列を渡した実行者に対しても**先読みと
 * DB は同じ判定を下さなければならない（束 ⑳-3 の構え）。したがって `implies` の閉包はここで
 * 取らない。
 *
 * 足すのは**行から立つもの**だけである —— `claim` は実行者自身の行の欄、`binding` は対象の行の
 * 列であり、DB の本文も同じ 3 か所を見る（`roles-to-sql.ts`）。行から立つロールは**配列に入っていても
 * 行で決める**（成り立たなければ配列にあっても落とす。DB は配列を見ない）。そのうえで、手順が運ぶ
 * 行の条件（`roleGates`。既定のログインロール自身の条件と、`claim` を持つロールを含意する側の
 * 含意の先の条件。ADR-0018 の E2）を満たさないロールは**配列から来たものも含めて**落とす ——
 * DB の述語が `自分の根拠 AND 含意の先の行の条件` だからである。
 *
 * @param step - その手順
 * @param arrayRoles - RPC に渡す配列の中身
 * @param actorId - 実行者の識別子
 * @param actorRow - 実行者自身の行の値（行が無い人では空）
 * @param valueOf - 供給元 1 つを値にする関数（world の読み方は呼び側が持つ）
 * @returns 立ったロール（宣言順・重複なし）
 */
export function arrayActorRoles(
  step: RunStepPlan,
  arrayRoles: readonly string[],
  actorId: string,
  actorRow: Readonly<Record<string, unknown>>,
  valueOf: (source: RunFactSource) => unknown,
): readonly string[] {
  const roles = new Set<string>(arrayRoles);
  // 行から立つロール(claim・束縛)は**行で決める** —— 配列に入っていても、行の条件・束縛が成り立たなければ立たない
  // (DB の述語は配列を見ない。古い配列や偽の配列に claim のロールが入っていても同じ)。
  for (const claim of step.claimFacts) {
    if (rowConditionHolds(claim, actorRow)) roles.add(claim.role);
    else roles.delete(claim.role);
  }
  for (const fact of step.roleFacts) {
    if (valueOf(fact.source) === actorId) roles.add(fact.role);
    else roles.delete(fact.role);
  }
  for (const [role, gates] of Object.entries(step.roleGates ?? {})) {
    if (!gates.every((gate) => rowConditionHolds(gate, actorRow))) roles.delete(role);
  }
  return [...roles];
}
