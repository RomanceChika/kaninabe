/**
 * **多要素認証の要求を書き込みの入口で執行する**部品(実行器 `./run-plan.ts` が引く)。
 *
 * 仕様: docs/rules/process/backend/specification/standards/auth-spec-writing.md §mfa
 *
 * 画面の関門は画面の入場しか守らない —— 多要素認証を済ませていないセッションでも、Server Action は直に呼べる。
 * 生成された Server Action はどれもこの実行器を通るので、**判断と書き込みの前のここ 1 か所**で止める。
 *
 * 要求に掛かるのは、**人の入口から来た、サインインした実行者で、多要素認証を済ませていないセッション**だけである。
 *   - 内部実行(`system`。走査・受信口・ジョブ)… 人のセッションが無く、保証の水準という概念が無い。区別は呼び出し側の
 *     宣言(`RunPlanCommand.system`)で決まり、生成された Server Action はこれを渡さない
 *   - 未ログイン(`actorId` が `null`)… サインインしていない人には要求する要素が無い(公開の操作は未ログインの規則が裁く)
 *   - 済ませたかどうかを渡されなかった … **済ませていないとして扱う**(安全側)
 *
 * 範囲が `roles` のときは、**この操作の判断に立ったロール**(手順ごとの解決の和。`implies` で閉じている)に要求する
 * ロールが 1 つでも入っていれば止める。立つロールは計画が名指した根拠からしか解かれないので、要求するロールが
 * その操作に関わらなければ(司書が利用者として借りる、のような操作)掛からない。関わるなら、ほかのロールで
 * 許される操作でも止める(要求するロールの権限で書けてしまうため。狭い側に倒す)。
 *
 * 拒否は `forbidden`(DB の分類なら `UC403`)に `mfaRequired: true` を付けたものである。権限の拒否であることは
 * 変わらず、印は画面が要素の登録・確認の画面へ送るためだけにある。
 */

import type { ActionError } from '@kaninabe/runtime/result';
import type { MfaRequirement, RuntimeBindings } from '../../domain/bindings';
import type { ActorRoles } from './actor-roles';

/** 要求に掛かるかを決める、実行者の側の事実。 */
export interface MfaSubject {
  readonly actorId: string | null;
  /** セッションが多要素認証を済ませているか(渡されなければ `undefined` = 済ませていない)。 */
  readonly actorMfa: boolean | undefined;
  /** 内部実行(system の入口)か。 */
  readonly system: boolean;
}

/** 要求に掛からない実行者か(内部実行・未ログイン・済ませたセッション)。 */
function outOfReach(subject: MfaSubject): boolean {
  return subject.system || subject.actorId === null || subject.actorMfa === true;
}

/**
 * 多要素認証の要求に掛かった拒否を返す(掛からなければ `null`)。
 *
 * 実行器は 2 回引く —— 事実を読む前(`roles` を `null` で。範囲が `all` ならここで止まり、対象の有無を明かさない)と、
 * ロールを解いたあと(範囲が `roles` の判定)である。
 *
 * @param requirement - 製品が渡す要求(無ければ要求しない製品)
 * @param subject - 実行者の側の事実
 * @param roles - この操作の判断に立ったロール(まだ解いていなければ `null`)
 * @param fallbackRole - 拒否に載せるロール(ロールを解いていないときのグローバルロール)
 * @param event - 拒否に載せる操作の ID
 * @returns 拒否、または `null`
 */
export function mfaRefusal(
  requirement: MfaRequirement | undefined,
  subject: MfaSubject,
  roles: ActorRoles | null,
  fallbackRole: string,
  event: string,
): ActionError | null {
  if (requirement === undefined || outOfReach(subject)) return null;
  if (requirement.scope === 'roles') {
    if (roles === null || !roles.some((role) => requirement.roles.includes(role))) return null;
  }
  return { kind: 'forbidden', event, role: roles?.[0] ?? fallbackRole, mfaRequired: true };
}

/** 手書きの入口(`runner: manual` の Server Action)が渡す、実行者の側の事実(人の入口なので内部実行ではない)。 */
export interface ManualEntryActor {
  readonly actorId: string | null;
  /** セッションが多要素認証を済ませているか(認証の組み立ての根の `resolveSessionMfa()` の値)。 */
  readonly actorMfa: boolean;
}

/**
 * **手書きの入口のための口** —— `runner: manual` の操作の Server Action が、判断と書き込みの前に呼ぶ。
 *
 * 実行器を通らない操作には、実行器の執行が届かない。だから手書きの Server Action は、生成された入口と**同じ判定**
 * (`mfaRefusal`)をここから引き、拒否が返ればそのまま返す。ロールは呼び手が解いた結果を渡す(その操作の判断に立ちうる
 * ロール。先頭はグローバルロール)。要求する製品では、呼んでいることを verify の H6 が構文木で確かめる。
 *
 * ```ts
 * const refusal = refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa }, roles, 'widget.settle');
 * if (refusal !== null) return err(refusal);
 * ```
 *
 * @param bindings - 製品が渡す宣言の束(`mfa` だけ読む。要求の無い製品では何もしない)
 * @param actor - 実行者とセッションの状態
 * @param roles - この操作の判断に立ちうるロール(解いた結果)
 * @param event - 拒否に載せる操作の ID
 * @returns 多要素認証の要求に掛かった拒否、または `null`
 */
export function refuseUnverifiedMfa(
  bindings: Pick<RuntimeBindings, 'mfa'>,
  actor: ManualEntryActor,
  roles: ActorRoles,
  event: string,
): ActionError | null {
  return mfaRefusal(bindings.mfa, { actorId: actor.actorId, actorMfa: actor.actorMfa, system: false }, roles, roles[0], event);
}
