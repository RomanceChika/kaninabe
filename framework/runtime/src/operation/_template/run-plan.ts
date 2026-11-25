/**
 * **実行計画を実行する**唯一の関数（ADR-0011 §4「1 保存 = 1 トランザクション」/ ADR-0012 ④）。
 *
 * 仕様: docs/rules/decisions/common/ADR-0011-usecase-layer-two-origins.md
 *       docs/rules/decisions/common/ADR-0012-db-as-authority.md
 *       docs/rules/process/backend/system/standards/conventions/server-actions.md（定型 4 手順）
 *       生成物 `@/domain/generated/{usecase-plans,operation-plans}`（計画そのもの）
 *
 * ## 保存点も単発の操作も同じ関数で走る
 *
 * **1 操作は「手順が 1 つの保存点」にすぎない**（束 ⑰ 設計 §0）。読む → 手順ごとに `permit` →
 * hooks → RPC を 1 回 → 拒否の写像、という並びは形によらず同じであり、形ごとに違うのは
 * 「②の照会先」（`canFire` / `canCreate` / `canDelete` / `canWrite`）と「RPC の呼び方」だけである。
 * 前者は `./run-plan-decide.ts`、後者は `./run-plan-args.ts` が計画の宣言どおりに扱う。
 *
 * 違いは 2 点だけで、どちらも**計画が運ぶ**（実行器に「保存点か単発か」の判定は無い）。
 *   - 保存点は「まだ書いていない手順」の状態を**仕様から予測**する（作成 = `initial` /
 *     遷移 = 直前の `to`）。単発は先行手順が無いので、読んだ値が実際の状態そのものである。
 *   - 保存点は複合 RPC を 1 回（引数 4 本固定）、単発は定型 RPC を 1 回（署名どおりの名前付き）。
 *
 * **何を予測し、何を読み、どのロールをどう解決し、どの引数に何を渡すかはこの関数に書かれて
 * いない。** すべて実行計画（仕様からの生成物）が運んでくる。ここにあるのは手順の順序と
 * 拒否の写像だけである（PRIN-0007 / PRIN-0008）。
 */

import type { RunPlan } from '@kaninabe/runtime/plan';
import type { ActionError, ActionResult } from '@kaninabe/runtime/result';
import { err, ok } from '@kaninabe/runtime/result';
import type { Clock, RpcCaller, RpcReturn, SettledOutcome, UsecaseFactReader, UsecaseRepository } from '@kaninabe/runtime/ports';
import { settle } from '@kaninabe/runtime/ports';
import type { ActorRoles } from './actor';
import { rejectedRole } from './actor';
import { resolveActorRolesWith } from './actor-roles';
import type { ActorClaims, DecideContext } from './run-plan-decide';
import { changedFields, decideStep, planActorRoles } from './run-plan-decide';
import type { ComputeRefsOf, ComputesArgs, PlanComputes } from './run-plan-args';
import { assertComputesWired, namedArgs } from './run-plan-args';
import type { PlanInputMap, Resolution } from './run-plan-facts';
import { expectedOf, resultId } from './run-plan-facts';
import { loadFacts } from './run-plan-reads';
import { mfaRefusal } from './mfa-requirement';
import { toWireInput } from './wire';
import type { RuntimeBindings } from '../../domain/bindings';

export type { PlanInputMap } from './run-plan-facts';
export type { ComputeRefsOf, ComputesArgs, PlanComputes } from './run-plan-args';
export type { ActorClaims } from './run-plan-decide';

/** 計画の成功値。結末の集約の id と、その後の状態。 */
export interface PlanResult {
  readonly id: string;
  /** 状態を持たない集約なら `null`。 */
  readonly state: string | null;
}

/**
 * application 執行の不変条件のチェック（計画の実行で手書きする唯一の場所）。
 *
 * 鍵は計画の `invariantHooks`（invariant_spec が `application` の執行点を宣言し、かつこの計画の
 * 手順を `guard` の執行点として名指ししている不変条件）である。**型がキーの全数を要求する**ので、
 * 不変条件を足したのに実行し忘れる、という状態になれない。
 */
export type PlanHooks<TIds extends string, TInput extends PlanInputMap> = Readonly<
  Record<TIds, (input: TInput) => boolean>
>;

/** 実行器が要る外部依存。 */
export interface RunPlanDeps {
  readonly facts: UsecaseFactReader;
  /** 複合 RPC（保存点）を呼び出す口。 */
  readonly usecases: UsecaseRepository;
  /** 定型 RPC（単発の操作）を呼び出す口。 */
  readonly rpc: RpcCaller;
  /** ガード式の予約語 `now` の供給元。 */
  readonly clock: Clock;
  /**
   * 製品が渡す宣言の束(ADR-0013)。
   *
   * 実行器はロール ID を 1 つも持たないので、解決の表はここから受ける —— 配線
   * (Composition Root)が生成物 `runtime-bindings.ts` を渡す。**`deps` に置くのは、ここが
   * 既にこの層の唯一の注入点だからである**(新しい口を作らない)。
   */
  readonly bindings: RuntimeBindings;
}

/** 計画への入力。actor はサーバー側のセッションから導いた値であり、入力ではない。 */
export interface RunPlanCommand<TInput extends PlanInputMap> {
  readonly actorId: string | null;
  /**
   * 実行者自身の行のうち**セッションに載っている欄**（role_spec の `claim` の根拠）。
   *
   * DB は読まない —— サインインが `app_metadata.profile` へ書いた値をそのまま受け取る
   * （auth-spec-writing.md §session 属性）。未ログインは `null`。
   */
  readonly actorClaims: ActorClaims;
  /**
   * **システム起点の呼び出し**か(Cron / OAuth コールバック / Webhook)。既定は人の入口。
   *
   * 実行者 ID を持たない経路は未ログインと区別が付かないので、宣言できるのは呼び出し側だけで
   * ある(`./actor.ts` の `globalRole` の JSDoc)。生成された Server Action はこれを渡さない
   * —— 人の入口だからである。渡すのは `scans` に宣言された system 起点の口だけであり、
   * その操作の `by` に `system` が並んでいなければ結局 `forbidden` になる(規則は仕様が持つ)。
   */
  readonly system?: boolean;
  /**
   * セッションが**多要素認証を済ませているか**(認証フロー仕様の `mfa`。要求の範囲は `deps.bindings.mfa`)。
   * 要求する製品の生成された Server Action だけが渡す。渡さなければ済ませていないとして扱う(`./mfa-requirement.ts`)。
   */
  readonly actorMfa?: boolean;
  readonly input: TInput;
  /**
   * **送信の意図の冪等キー**(点検 20 回目 B20-1。画面の実行器が作り、生成された Server Action が形を確かめて渡す)。押し直しで
   * 同じ鍵が届くので、作成の 2 回目は 1 回目の行を返す。渡されなければこの呼び出しで 1 回だけ作る(意図を持たない呼び手)。
   */
  readonly idempotencyKey?: string | undefined;
}

/**
 * 判断から書き込みまでの間に前提が崩れていたときの理由文字列。
 *
 * どの形でも同じ事象なので文言も 1 つにする（5 形の定型が形ごとに `conflictReason` を
 * 受け取っていたのは、0 行の意味が形によって違うことを各操作に書かせるためだった。計画からは
 * 「どの手順で崩れたか」が `event` として出るので、文言を分ける必要が無くなった）。
 */
const CONFLICT_REASON = 'conflict: state changed after the decision';

/**
 * RPC 側のガードが成立しなかったときの理由文字列（束 ⑳-3）。
 *
 * 先読み（engine）を通っていればここには来ない —— 人が読む理由は先読みが `guardSource` つきで
 * 返すので、ここが出るのは「判断のときの事実と書き込みのときの DB が食い違った」ときだけである。
 */
const GUARD_REASON = 'guard: not satisfied at write time';

/** 「変更が 1 つも無い」の指摘に載せる宛先（境界の zod の `path` と同じ名前）。 */
const EMPTY_CHANGES_FIELD = 'changes';

/** 同上のコード（zod 由来のコード語彙には無い状況なので、定型が出す 1 語を固定する）。 */
const EMPTY_CHANGES_CODE = 'empty';

/**
 * 実行計画を実行する操作を組み立てる。
 *
 * @param plan - 実行計画（`usecase-plans.ts` / `operation-plans.ts` の 1 エントリ）
 * @param hooks - application 執行の不変条件のチェック（計画が要求する ID の全数）
 * @param computesArgs - 計算値の純関数の表 1 つ（計画が要求する名前の全数）。**要求が 1 つでもある計画では
 *   型が必須にする**（`ComputesArgs`）。型が広がっていて漏れを型が見逃したときは、ここ（配線時）で
 *   例外にする —— 呼び出しごとに RPC の引数が黙って落ちるのを許さない
 * @returns 依存と入力を受け取り、`Result` を返す操作関数
 * @throws 計画が要求する純関数が `computes` に無いとき（配線のバグ。業務上の拒否ではない）
 */
export function runPlanOperation<TPlan extends RunPlan, TInput extends PlanInputMap>(
  plan: TPlan,
  hooks: PlanHooks<TPlan['invariantHooks'][number], TInput>,
  ...computesArgs: ComputesArgs<ComputeRefsOf<TPlan>>
): (deps: RunPlanDeps, command: RunPlanCommand<TInput>) => Promise<ActionResult<PlanResult>> {
  const computes: PlanComputes<string> = computesArgs[0] ?? {};
  assertComputesWired(plan, computes);
  // 計画そのものを表すイベント ID。単発の操作ではこれが操作 ID と一致する。
  const planEvent = `${plan.usecase}.${plan.save}`;

  return async (deps, command) => {
    // 冪等キーは送信の意図の鍵(押し直しで同じ値が届く)。無ければこの呼び出しで 1 回だけ作る(点検 20 回目 B20-1)。
    const idempotencyKey = command.idempotencyKey ?? crypto.randomUUID();
    // 事実を読まずに立つ解決（binding は成立しない —— グローバルロール 1 つだけ）。拒否に載せるロールを
    // 必ず「判断に使った解決結果」から作るためにここで通す（`./actor.ts` の `rejectedRole`）。
    const unbound = rejectedRole(
      resolveActorRolesWith(deps.bindings.roleTables, command.actorId, command.actorClaims, {}, command.system === true),
    );
    const mfa = { actorId: command.actorId, actorMfa: command.actorMfa, system: command.system === true };
    // 多要素認証の要求（範囲が全員なら、対象の有無を読む前にここで止める）。
    const beforeFacts = mfaRefusal(deps.bindings.mfa, mfa, null, unbound, planEvent);
    if (beforeFacts !== null) return err(beforeFacts);
    const facts = await loadFacts(plan, deps.facts, command.actorId, command.input);
    if (facts === null) return err({ kind: 'forbidden', event: planEvent, role: unbound });
    // 判断材料としての時刻は 1 回の実行の中で 1 つに固定する（手順ごとにずれない）。
    const resolution: Resolution = {
      facts,
      actorId: command.actorId,
      session: command.actorClaims,
      input: command.input,
      now: deps.clock.now().toISOString(),
    };
    const ctx: DecideContext = { resolution, system: command.system === true };
    // DB が `by` を照合するのに使う集合（束 ⑳-3）。判断に使ったのと同じ 1 つの解決結果であり、
    // 先読みと DB が別々にロールを解決することはない。
    const actorRoles = planActorRoles(deps.bindings.roleTables, plan, ctx);
    // 多要素認証の要求（範囲がロールなら、この操作の判断に立ったロールで見る）。
    const byRoles = mfaRefusal(deps.bindings.mfa, mfa, actorRoles, unbound, planEvent);
    if (byRoles !== null) return err(byRoles);

    // #region example:operation-run-plan
    const empty = emptyChanges(plan, resolution.input);
    if (empty !== null) return err(empty);

    const writeEffects: string[] = [];
    for (const step of plan.steps) {
      const decision = decideStep(deps.bindings.roleTables, plan, step, ctx);
      if (!decision.allowed) return err(decision.error);
      // 重複は起こらない —— 編集の手順は計画に 1 つしか置けず（複合 RPC の中から定型の
      // 編集 RPC は呼べない）、その 1 手順の中の重複は判断の側が既に畳んである。
      writeEffects.push(...decision.writeEffects);
    }

    for (const invariant of plan.invariantHooks) {
      const check = hooks[invariant as TPlan['invariantHooks'][number]];
      if (!check(command.input)) return err({ kind: 'invariant_violated', invariant });
    }

    const outcome = await call(plan, deps, resolution, { idempotencyKey, actorRoles, writeEffects, computes });
    const refused = refusalError(planEvent, outcome, actorRoles);
    if (refused !== null) return err(refused);
    return ok({ id: resultId(plan, idempotencyKey, command.input), state: plan.result.state });
    // #endregion
  };
}

/**
 * RPC の結末を拒否に写す（書けたなら `null`）。
 *
 * **DB が返した分類をそのまま使う**（束 ⑳-3）。先読み（engine）を通っていれば `forbidden` /
 * `guard_unsatisfied` はここに来ない —— 来たということは、判断に使った事実が書き込みまでに
 * 動いたか、engine を通らない経路から実行されたかであり、どちらも DB の判定が正である。
 *
 * @param planEvent - 計画そのものを表すイベント ID（DB が操作を返さなかったときの既定）
 * @param outcome - RPC の結末(通信の失敗・想定外の失敗は `settle` が投げ済み)
 * @param actorRoles - 判断に使った解決済みロール（拒否に載せるロールの出どころ）
 * @returns 拒否。書けていれば `null`
 */
function refusalError(
  planEvent: string,
  outcome: SettledOutcome<RpcReturn>,
  actorRoles: ActorRoles,
): ActionError | null {
  if (outcome.kind === 'saved') return null;
  if (outcome.kind === 'invariant_violated') {
    return outcome.edge === undefined ? { kind: 'invariant_violated', invariant: outcome.invariant } : { kind: 'invariant_violated', invariant: outcome.invariant, edge: outcome.edge };
  }
  const event = outcome.op === '' ? planEvent : outcome.op;
  if (outcome.kind === 'forbidden') {
    return { kind: 'forbidden', event, role: rejectedRole(actorRoles) };
  }
  const guard = outcome.kind === 'guard_unsatisfied';
  return {
    kind: 'guard_unsatisfied',
    event,
    blockedBy: guard ? 'guard' : 'state',
    // DB が拒否の語を載せたら、それを理由にする(画面が閉じた表の語の文言を出す。wording の refusalWordText)。無ければ従来の診断の文字列。
    reason: outcome.word ?? (guard ? GUARD_REASON : CONFLICT_REASON), // 競合の語は同じ鍵の押し直し(resend_already_saved)だけ
  };
}

/** RPC の呼び出しに要る、判断が終わってから決まる値。 */
interface CallContext {
  readonly idempotencyKey: string;
  readonly actorRoles: readonly string[];
  readonly writeEffects: readonly string[];
  readonly computes: PlanComputes<string>;
}

/**
 * 計画が言う呼び方で RPC を 1 回呼び出す。
 *
 * 通信の失敗・想定外の失敗は `ActionResult` に現れない —— `settle` が `DbInfrastructureError` として
 * 投げる(コミットの状態を欄に残す。ARCH-BE-0013)。投げる場所はそこ 1 か所で、単発も保存点も通る。
 */
async function call(
  plan: RunPlan,
  deps: RunPlanDeps,
  resolution: Resolution,
  ctx: CallContext,
): Promise<SettledOutcome<RpcReturn>> {
  const outcome =
    plan.call.kind === 'composite'
      ? await deps.usecases.call(plan.rpc, {
          id: ctx.idempotencyKey,
          actorId: resolution.actorId,
          actorRoles: ctx.actorRoles,
          expected: expectedOf(plan, resolution.facts),
          input: toWireInput(resolution.input),
        })
      : await deps.rpc.call(plan.rpc, namedArgs(plan.call.params, { resolution, ...ctx }));
  return settle(plan.rpc, outcome);
}

/**
 * 編集の手順が「変更を 1 つも運んでいない」なら `invalid_input`（それ以外は `null`）。
 *
 * 何も起きない要求は送った側から見て成功とも失敗とも読めないので、業務上の拒否ではなく
 * **入力そのものの不正**としてエラーにする（境界の zod が同じことを見ているが、そこを通らない
 * 呼び出し経路が将来増えても空の更新が DB に届かないよう二段で塞ぐ）。
 */
function emptyChanges(plan: RunPlan, input: PlanInputMap): ActionError | null {
  for (const step of plan.steps) {
    if (step.kind !== 'update') continue;
    if (changedFields(plan, step, input).length > 0) continue;
    return { kind: 'invalid_input', issues: [{ field: EMPTY_CHANGES_FIELD, code: EMPTY_CHANGES_CODE }] };
  }
  return null;
}
