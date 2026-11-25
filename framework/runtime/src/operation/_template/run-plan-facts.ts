/**
 * 実行計画（`run-plan.ts`）が**判断材料を揃える**部分。
 *
 * 仕様: docs/rules/decisions/common/ADR-0011-usecase-layer-two-origins.md §4
 *       docs/rules/decisions/common/ADR-0012-db-as-authority.md ④
 *       生成物 `@/domain/generated/plan-types`（値の形の正）
 *
 * 「どの表のどの行のどの列を読むか」「その値をどの供給元から取るか」はすべて計画が運ぶ。
 * ここにあるのは**その指示の実行**だけで、集約の名前も列の名前も 1 つも現れない。
 *
 * **実 DB を読む段（`loadFacts`）は `./run-plan-reads.ts` にある。** 分けた理由は
 * 1 つで、ここは仕様側（legacy/spec-tools の結果表）からも import される **依存の無い芯**だから
 * である —— 読み取りの口（`../ports`）を抱えると、そこから境界の型（zod）まで引き連れる。
 */

import type { GuardValue } from '@kaninabe/runtime/engine';
import type { RunFactSource, RunPlan } from '@kaninabe/runtime/plan';
import type { SessionClaims } from '../../domain/bindings';

/** 計画への入力（保存点は手順の別名が鍵、単発の操作は欄がそのまま鍵）。 */
export type PlanInputMap = Readonly<Record<string, unknown>>;

/** 読んだ事実（鍵は `{entity}.{列}`）。 */
export type FactMap = Readonly<Record<string, GuardValue>>;

/** `permit` を立てるのに要る、計画ぜんたいで共有する値。 */
export interface Resolution {
  readonly facts: FactMap;
  readonly actorId: string | null;
  /**
   * 実行者自身の行のうち**セッションに載っている欄**（`session: true`）。未ログインは `null`。
   *
   * DB は読まない —— サインインが `app_metadata.profile` へ書いた値をそのまま受け取る
   * （auth-spec-writing.md §session 属性）。`claim` のロールと、ガード式の `actor.{欄}` の
   * どちらもここから立つ（**同じ 1 つの事実の入口を 2 つに割らない**）。
   */
  readonly session: SessionClaims | null;
  readonly input: PlanInputMap;
  /** 判断材料としての現在時刻（ISO 8601 の UTC 表記）。 */
  readonly now: string;
}

/**
 * その手順に対応する入力（保存点は手順の別名で引き、単発の操作は入力そのもの）。
 *
 * **単発の操作の入力は平たい**（`{ id, ... }`）。1 操作しか無いので別名で包む理由が無く、
 * 生成される入力スキーマ（`operation-inputs.ts`）もその形である。どちらかは計画の
 * `call.kind` が決めており、実行器に「保存点か単発か」の判定は無い。
 *
 * `repeat` の手順は先頭の要素を見る —— どの要素も同じ親を指す。
 */
export function stepInput(plan: RunPlan, input: PlanInputMap, step: number): PlanInputMap | null {
  if (plan.call.kind === 'named') return input;
  const alias = plan.steps[step]?.alias;
  if (alias === undefined) return null;
  const value = input[alias];
  const row = Array.isArray(value) ? (value as unknown[])[0] : value;
  if (typeof row !== 'object' || row === null) return null;
  return row as PlanInputMap;
}

/** 入力の 1 欄を取り出す。 */
export function inputField(
  plan: RunPlan,
  input: PlanInputMap,
  source: { readonly step: number; readonly field: string },
): unknown {
  return stepInput(plan, input, source.step)?.[source.field];
}

/** 供給元 1 つを値にする（この 6 つ以外の供給元は存在しない）。 */
export function factValue(plan: RunPlan, source: RunFactSource, resolution: Resolution): GuardValue {
  switch (source.kind) {
    case 'external':
      return resolution.facts[source.ref] ?? null;
    case 'predicted':
      return source.value;
    case 'actor':
      return resolution.actorId;
    // 実行者の属性は**セッションから**引く。対象の行を読んだ事実（`external`）とは別の値であり、
    // 混ぜると「対象の行の列 == 実行者の列」が同じ値どうしの比較になって常に真になる。
    case 'session':
      return sessionValue(resolution.session, source.field);
    case 'now':
      return resolution.now;
    default: {
      const value = inputField(plan, resolution.input, source);
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
      return null;
    }
  }
}

/**
 * セッションの profile の 1 欄（載っていない・未ログインは `null`）。
 *
 * 欄の名前を文字列で持たないのは `claim` の解決と同じ理由である —— 計画が名指しした 1 欄を
 * 引くだけで、どの欄がどういう意味かはこの定型の関知するところではない。
 */
function sessionValue(session: SessionClaims | null, field: string): GuardValue {
  if (session === null) return null;
  // 生成された型は欄が閉じている（`SESSION_FIELDS`）。ここでは名前で 1 つ引くだけなので、
  // 「欄名 → 値」の見え方に写してから引く（欄の名前をこの定型が文字列で持たないため）。
  const fields: Readonly<Record<string, GuardValue | undefined>> = { ...session };
  return fields[field] ?? null;
}

/** 結末の id（この計画が対象を作るなら冪等キー、動かすだけなら入力の id）。 */
export function resultId(plan: RunPlan, idempotencyKey: string, input: PlanInputMap): string {
  if (plan.result.idFrom.kind === 'idempotency') return idempotencyKey;
  const value = inputField(plan, input, plan.result.idFrom);
  return typeof value === 'string' ? value : idempotencyKey;
}

/** 複合 RPC に渡す「保存点の外の状態」。 */
export function expectedOf(plan: RunPlan, facts: FactMap): Readonly<Record<string, string | null>> {
  const expected: Record<string, string | null> = {};
  for (const key of plan.expectedKeys) {
    const value = facts[key];
    expected[key] = typeof value === 'string' ? value : null;
  }
  return expected;
}
