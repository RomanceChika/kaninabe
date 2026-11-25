/**
 * 状態遷移の定型（ARCH-BE-0013 の**定型 4 手順**の②〜④）。
 *
 * 仕様: docs/rules/architecture/system/backend/ARCH-BE-0013-server-action-structure.md
 *       docs/rules/process/backend/system/standards/conventions/server-actions.md（定型 4 手順）
 *
 * **手順の順序はこの関数の中に 1 回だけ存在する**。②照会 → ③永続化 → ④結果の写像という並びは
 * 各操作の書き方の問題ではなく、この定型そのものである（規約の文章だけで守らせていたものが、
 * ここで構造として執行される）。各操作が渡すのは「読み取り」「ロールの解決」「ガード評価に使う値」
 * 「永続化の呼び出し」という集約ごとの個性だけで、**判断（`canFire`）と拒否の写像（`toActionError`）と
 * 楽観的並行制御の結末（`conflict`）はここが持つ**。
 *
 * 遷移の許可（`FireAllowed`）はエンジンだけが作れる型なので、この定型を通っても
 * 「判定を通さずに状態を書き換える」呼び出しは型として書けない（`@kaninabe/runtime/engine`（`machine.ts`））。
 */

import { toActionError } from '@kaninabe/runtime/action-error';
import type { FireAllowed, GuardEnv, MachineTable } from '@kaninabe/runtime/engine';
import { canFire } from '@kaninabe/runtime/engine';
import type { ActionResult } from '@kaninabe/runtime/result';
import { err, ok } from '@kaninabe/runtime/result';
import type { ActorCommand, ActorProfile, ActorRoles } from './actor';
import { rejectedRole } from './actor';
import type { FactsLoaded } from './facts';
import type { Conflict, InvariantViolated } from './outcome';

/**
 * 判断から書き込みまでの間に他者が状態を動かしたときの理由文字列。
 *
 * どの遷移でも同じ事象なので文言も 1 つにする（操作ごとに書き分けると、同じ結末が
 * 操作ごとに違う形で返る）。
 */
const CONFLICT_REASON = 'conflict: state changed after the decision';

/**
 * 状態遷移の適用結果。
 *
 * 成功のときに何が返るか（更新後の射影の形）は集約ごとに違うため、その部分だけを型引数にする。
 * `conflict` は楽観的並行制御の 0 行更新、`invariant_violated` は DB 制約が検出した不変条件違反。
 */
export type TransitionOutcome<TApplied> =
  | ({ readonly kind: 'applied' } & TApplied)
  | Conflict<'transition'>
  | InvariantViolated<'transition'>;

/**
 * 遷移操作の設定。ここに現れるのは**集約ごとに違う部分だけ**である。
 *
 * 判断そのもの（どの状態からどのロールが実行できるか）は生成された遷移テーブルが持ち、
 * この設定には現れない。`if` で可否を判定する隙間が構造的に無いのはそのためである。
 * ドメインイベントID も設定に書かない（生成物の `machine` と `event` から導く）。
 */
export interface TransitionSpec<TDeps, TCommand extends ActorCommand, TFacts, TApplied, TResult> {
  /** 状態機械の中でのイベント名（例: `entry.submit` の `submit` の部分）。 */
  readonly event: string;
  /** 生成された遷移テーブル（`domain/generated/{machine}.transitions.ts`）。 */
  readonly machine: MachineTable;
  /**
   * 判断に要る事実を読む（②の読み取り）。
   *
   * 答えるのは「読めたか」だけである。`not_visible` は一律に `forbidden` になる
   * （存在の有無を漏らさないため。`./facts.ts`）。ここに可否の判断を書いてはならない。
   */
  readonly loadFacts: (deps: TDeps, command: TCommand) => Promise<FactsLoaded<TFacts>>;
  /** 読んだ事実のうち、遷移元となる状態はどれか。 */
  readonly stateOf: (facts: TFacts) => string;
  /**
   * 実行者に解決されたロール（利用側が `resolveActorRolesWith` で解決したもの）。
   *
   * **事実が読めなかった場合（`null`）も答える。** 拒否の `role` はこの解決結果から作られるので
   * （`rejectedRole`）、ここが答えられない経路があると、その拒否だけ「誰として拒否されたか」を
   * 実行者IDから推測することになり、system 経路が `anonymous` に化ける。事実が無ければ
   * binding は 1 つも成立しないので、答えはグローバルロールだけになる
   * （`resolveActorRoles(actorId, claims, { {ロール}: facts?.{集約}.{欄} })` と書けばそうなる）。
   *
   * **第 3 引数はセッションが運ぶプロフィール**（`command.actorClaims`）である。既定のログイン
   * ロールの根拠は「実行者の集約に行があること」であり、その写しがこれである（`./actor.ts`）。
   *
   * 戻り値の**先頭はグローバルロール**であること（`resolveActorRoles` がそれを保証する）。
   */
  readonly actorRoles: (
    actorId: string | null,
    facts: TFacts | null,
    claims: ActorProfile,
  ) => ActorRoles;
  /**
   * ガード式が参照するパスへの値の割り当て。ガードの無いイベントは空を返す。
   *
   * **実行者を第 2 引数で受け取る。** ガード式の文法は `actor` を予約語として認めており
   * （domain-spec-writing.md §ガード式の文法）、`{entity}.id == actor.id` のような本人条件は
   * 仕様として正当である。実行者を渡す口が無いと、それを評価するために `loadFacts` が
   * 「読んだ事実」でないものを facts に載せることになり、`loadFacts` の契約
   * （答えるのは「読めたか」だけ）が崩れる。実行者を参照しない集約は第 2 引数を
   * 無視してよい（既存の設定はそのまま動く）。
   */
  readonly guardEnv: (facts: TFacts, actorId: string | null) => GuardEnv;
  /** 許可を持って永続化する（③④。更新と outbox 投入は同一トランザクション）。 */
  readonly persist: (
    deps: TDeps,
    facts: TFacts,
    decision: FireAllowed,
    actorId: string | null,
    /**
     * 判断に使った解決済みロール（束 ⑳-3）。RPC の `p_actor_roles` にそのまま渡す。
     *
     * **判断に使ったのと同じ 1 つの集合**であることが要点である —— DB は `by` を自分で照合する
     * ので（`legacy/spec-tools/lib/sql/roles-to-sql.ts`）、ここで別の集合を作ると先読みと DB が
     * 違う答えを出しうる。
     */
    actorRoles: ActorRoles,
  ) => Promise<TransitionOutcome<TApplied>>;
  /** 適用結果から、後続の表示に必要な最小限の成功値を作る。 */
  readonly toResult: (applied: TApplied) => TResult;
}

/**
 * 状態遷移の操作を組み立てる。
 *
 * @param spec - 集約ごとの読み取り・ロール解決・env 組み立て・永続化
 * @returns 依存と入力を受け取り、`Result` を返す操作関数
 */
export function transitionOperation<TDeps, TCommand extends ActorCommand, TFacts, TApplied, TResult>(
  spec: TransitionSpec<TDeps, TCommand, TFacts, TApplied, TResult>,
): (deps: TDeps, command: TCommand) => Promise<ActionResult<TResult>> {
  // ドメインイベントIDは生成物から導く。操作を文字列で指定できる形にすると、綴りの正が
  // 仕様の外（各操作のリテラル）にもう 1 つできる（PRIN-0007 / PRIN-0008）。
  const eventId = `${spec.machine.machine}.${spec.event}`;

  return async (deps, command) => {
    const loaded = await spec.loadFacts(deps, command);
    // 読めたかによらずロールは解決する。**拒否に載せるロールは常にこの解決結果から作る**
    // （実行者IDから作り直すと、IDを持たない経路＝system の拒否が `anonymous` になる）。
    const facts = loaded.kind === 'not_visible' ? null : loaded.facts;
    const actorRoles = spec.actorRoles(command.actorId, facts, command.actorClaims);
    if (facts === null) {
      return err({ kind: 'forbidden', event: eventId, role: rejectedRole(actorRoles) });
    }

    // ②判断はエンジンへの照会に集約する。ここに状態・権限を判定する `if` は無い。
    const decision = canFire(
      spec.machine,
      {
        state: spec.stateOf(facts),
        actorRoles,
        env: spec.guardEnv(facts, command.actorId),
      },
      spec.event,
    );
    if (!decision.allowed) {
      return err(toActionError(decision, eventId, rejectedRole(actorRoles)));
    }

    // ③④判断の結果をそのまま渡す。ここで to や effects を組み立て直さない（できない）。
    const outcome = await spec.persist(deps, facts, decision, command.actorId, actorRoles);

    switch (outcome.kind) {
      case 'applied':
        return ok(spec.toResult(outcome));
      case 'invariant_violated':
        return err({ kind: 'invariant_violated', invariant: outcome.invariant });
      case 'conflict':
        return err({
          kind: 'guard_unsatisfied',
          event: eventId,
          blockedBy: 'state',
          reason: CONFLICT_REASON,
        });
    }
  };
}
