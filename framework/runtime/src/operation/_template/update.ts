/**
 * 編集の定型（server-actions.md「**定型 4 手順（編集・バルク形）**」の②〜④）。
 *
 * 仕様: docs/rules/process/backend/system/standards/conventions/server-actions.md
 *       （構造とエラー分類の契約の正は ARCH-BE-0013）
 *
 * ②の照会先が `canWrite`（そのロールがそのフィールドを、その条件下で更新してよいか）になる。
 * 規約と同じく**バルク形だけ**を定型にする。単行の編集の実物が現れたら、そのときに隣へ立てる。
 *
 * 一括であることがこの定型に足す制約は 3 つで、いずれもここが持つ。
 *   - ②の読み取りを **1 回**で行う（項目ごとに読むと判断の前提がずれる）→ `loadTargets` は 1 回だけ呼ぶ
 *   - ②の照会を**全項目に**適用し、1 件でも許されなければ全体を拒否する（最初の理由を返す）
 *   - ③の永続化を 1 回の呼び出しに渡す（原子的な適用と楽観的並行制御は RPC 側の性質）
 *
 * 判断に使う周辺（親の集約）は同じものが並ぶのが普通なので、1 回の操作の中では読んだ結果を
 * 使い回す。読めなかったこと自体も結果として覚える（読めない親を何度も引きに行かない）。
 */

import { toWriteActionError } from '@kaninabe/runtime/action-error';
import type { GuardEnv, WriteTable } from '@kaninabe/runtime/engine';
import { canWrite } from '@kaninabe/runtime/engine';
import type { ActionError, ActionResult } from '@kaninabe/runtime/result';
import { err, ok } from '@kaninabe/runtime/result';
import type { ActorCommand, ActorProfile, ActorRoles } from './actor';
import { rejectedRole } from './actor';
import type { Conflict, InvariantViolated } from './outcome';

/**
 * 一括編集の対象の取り出し結果。
 *
 * 「対象が 1 件でも見つからない」「指定がまとまりとして意味を持たない」の扱いは集約ごとに違う
 * （存在を漏らさない `forbidden` なのか、入力そのものの不正なのか）ため、拒否の分類も
 * 取り出し側が決めてそのまま返す。
 */
export type BulkTargets<TTarget> =
  | { readonly kind: 'loaded'; readonly targets: readonly TTarget[] }
  | { readonly kind: 'rejected'; readonly error: ActionError };

/**
 * 一括編集の適用結果。
 *
 * 成功のときに何が返るか（適用後の射影の形）は集約ごとに違うため、その部分だけを型引数にする。
 * `conflict` は 1 件でも判断時の値と食い違ったときの 0 行更新（部分適用はしない）。
 */
export type UpdateOutcome<TWritten> =
  | ({ readonly kind: 'updated' } & TWritten)
  | Conflict<'update'>
  | InvariantViolated<'update'>;

/**
 * 編集操作（バルク形）の設定。ここに現れるのは**集約ごとに違う部分だけ**である。
 *
 * 操作のID（予約ID `{entity}.update`）は設定に書かない（生成された規則表の `entity` から導く）。
 */
// #region example:operation-update-bulk-template
export interface UpdateSpec<TDeps, TCommand extends ActorCommand, TTarget, TContext, TWritten, TResult> {
  /** 更新するフィールド名（`entity_spec` に実在する名前。`writes[].fields` と突き合わされる）。 */
  readonly field: string;
  /** 生成された編集規則の表（`domain/generated/{entity}.writes.ts`）。 */
  readonly rules: WriteTable;
  /** 判断から書き込みまでの間に対象が動いていたときの理由文字列。 */
  readonly conflictReason: string;
  /**
   * 全対象を 1 回の読み取りで取り出す（②の読み取り）。
   *
   * `rejected` に載せてよいのは**境界の検証の続き**（対象が見えない・指定がまとまりとして
   * 意味を持たない）だけである。誰が・いつ書けるかの判断はここではなくエンジンが下す。
   */
  readonly loadTargets: (deps: TDeps, command: TCommand) => Promise<BulkTargets<TTarget>>;
  /** 判断に使う周辺を引くための鍵（同じ鍵なら 1 回しか読まない）。 */
  readonly contextKey: (target: TTarget) => string;
  /**
   * 判断に使う周辺を読む。読めなければ読めなかったことをそのまま値にする。
   *
   * **実行者を第 3 引数で受け取る**（`actorRoles` / `guardEnv` と同じ理由）。例: `staff` のように
   * 対象ではなく**実行者の行属性**が根拠になるロールがあり、それを読む口がここに無いと、
   * 解決の材料を `loadTargets` が対象 1 件 1 件に写して回ることになる（対象の射影に
   * 実行者の属性が混ざる）。周辺は鍵ごとに 1 回しか読まないので、この読み取りも 1 回で済む。
   */
  readonly readContext: (deps: TDeps, key: string, actorId: string | null) => Promise<TContext>;
  /**
   * 実行者に解決されたロール（利用側が `resolveActorRolesWith` で解決したもの）。
   *
   * 単行の 4 形と違い**事実が読めなかった場合を受け取らない**。バルク形で対象が読めないことは
   * `loadTargets` の `rejected`（境界の検証の続き）として操作自身が拒否を組み立てる経路であり、
   * ここまで来ない。戻り値の**先頭はグローバルロール**であること（拒否の `role` はこの解決結果の
   * 先頭から作られる。`rejectedRole`）。
   */
  readonly actorRoles: (
    actorId: string | null,
    target: TTarget,
    context: TContext,
    claims: ActorProfile,
  ) => ActorRoles;
  // #endregion
  /**
   * `writes[].when` が参照するパスへの値の割り当て。
   *
   * **実行者を第 3 引数で受け取る**（単行形の第 2 引数と同じ理由。ガード式は `actor` を
   * 予約語として認めており、本人条件を評価するには実行者が要る）。参照しない集約は
   * 無視してよい。
   */
  readonly guardEnv: (target: TTarget, context: TContext, actorId: string | null) => GuardEnv;
  /** 全対象をまとめて書く（③。原子性と楽観的並行制御は RPC 側の性質）。 */
  readonly persist: (
    deps: TDeps,
    targets: readonly TTarget[],
    actorId: string | null,
  ) => Promise<UpdateOutcome<TWritten>>;
  /** 適用結果から、後続の表示に必要な最小限の成功値を作る。 */
  readonly toResult: (written: TWritten) => TResult;
}

/**
 * 編集の操作（バルク形）を組み立てる。
 *
 * @param spec - 集約ごとの読み取り・ロール解決・env 組み立て・永続化
 * @returns 依存と入力を受け取り、`Result` を返す操作関数
 */
export function updateOperation<TDeps, TCommand extends ActorCommand, TTarget, TContext, TWritten, TResult>(
  spec: UpdateSpec<TDeps, TCommand, TTarget, TContext, TWritten, TResult>,
): (deps: TDeps, command: TCommand) => Promise<ActionResult<TResult>> {
  // 予約ID は生成物から導く。操作を文字列で指定できる形にすると、綴りの正が仕様の外に
  // もう 1 つできる（PRIN-0007 / PRIN-0008）。
  const eventId = `${spec.rules.entity}.update`;

  return async (deps, command) => {
    const loaded = await spec.loadTargets(deps, command);
    if (loaded.kind === 'rejected') return err(loaded.error);

    // ②照会は全項目に適用する。1 件でも許されなければ最初の理由で全体を拒否する。
    // 読んだ周辺は鍵ごとに 1 回だけ引く。**読めなかったこと（`null`）も記憶する**ので、
    // 値ではなく「記憶があるか」で判定する（包んでいるのはそのためで、`undefined` は
    // 「まだ読んでいない」だけを意味する）。
    const contexts = new Map<string, { readonly value: TContext }>();
    for (const target of loaded.targets) {
      const key = spec.contextKey(target);
      const remembered = contexts.get(key);
      const context =
        remembered === undefined
          ? await spec.readContext(deps, key, command.actorId)
          : remembered.value;
      contexts.set(key, { value: context });

      // 拒否に載せるロールは**この対象について判断に使った解決結果**から作る
      // （実行者IDから作り直すと、IDを持たない経路＝system の拒否が `anonymous` になる）。
      const actorRoles = spec.actorRoles(command.actorId, target, context, command.actorClaims);
      const decision = canWrite(spec.rules, {
        field: spec.field,
        actorRoles,
        env: spec.guardEnv(target, context, command.actorId),
      });
      if (!decision.allowed) {
        return err(toWriteActionError(decision, eventId, rejectedRole(actorRoles)));
      }
    }

    const outcome = await spec.persist(deps, loaded.targets, command.actorId);

    switch (outcome.kind) {
      case 'updated':
        return ok(spec.toResult(outcome));
      case 'invariant_violated':
        return err({ kind: 'invariant_violated', invariant: outcome.invariant });
      case 'conflict':
        return err({
          kind: 'guard_unsatisfied',
          event: eventId,
          blockedBy: 'state',
          reason: spec.conflictReason,
        });
    }
  };
}
