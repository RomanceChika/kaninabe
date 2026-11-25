/**
 * 状態機械エンジンの拒否理由（`FireRejected`）を、Server Action のエラー3分類へ写像する。
 *
 * 対応表の正は `engine/types.ts` の `FireRejectionReason` のJSDocと ARCH-BE-0013。
 * この写像を各 operation に書くと分類が揺れるため、1箇所に固定する（PRIN-0007）。
 *
 * | エンジンの reason | ActionError                                  |
 * |---|---|
 * | `unknown_event` / `invalid_from`             | `guard_unsatisfied` (blockedBy: state) |
 * | `guard_unsatisfied` / `guard_unknown`        | `guard_unsatisfied` (blockedBy: guard) |
 * | `role_forbidden`                             | `forbidden`                            |
 *
 * `invalid_from` の `reason` には仕様の `otherwise_forbidden` の文言をそのまま載せる
 * （server-actions.md「戻り値の型」: 理由文は仕様が持ち、実装は組み立てない）。
 *
 * `invariant_violated` はエンジンの守備範囲外であり、永続化時にDB制約として検出される。
 */

import type { CreateRejected, DeleteRejected, FireRejected, WriteRejected } from '@kaninabe/runtime/engine';
import type { ActionError } from './result';

/**
 * 拒否理由から `reason` 文字列を組み立てる。
 *
 * server-actions.md は「仕様が持つ理由文（`otherwise_forbidden` の文言）」を返すことを求める。
 * `invalid_from` はまさにその拒否であり、生成物（`generated/{machine}.transitions.ts`）が運んできた
 * 仕様の文言をそのまま返す。**ここで文言を組み立てない**（PRIN-0008）。
 *
 * 仕様に理由文が無い場合と、そもそも理由文が存在しない拒否（`unknown_event`・ガード系）については、
 * **仕様に実在する値だけで構成した機械可読の診断文字列**にフォールバックする。
 * 表示文言はUIの責務であり、この値はUIにそのまま出すためのものではない。
 *
 * `role_forbidden` は `forbidden` に写るため理由文を持たない。ここに渡らないことを型で示す。
 */
function reasonOf(rejection: Exclude<FireRejected, { reason: 'role_forbidden' }>): string {
  switch (rejection.reason) {
    case 'unknown_event':
      return `unknown_event: ${rejection.event}`;
    case 'invalid_from':
      return (
        rejection.otherwiseForbidden ??
        `invalid_from: ${rejection.state} (expected: ${rejection.expectedFrom.join(', ')})`
      );
    case 'guard_unsatisfied':
      return `guard_unsatisfied: ${rejection.guardSource ?? '(guard source unavailable)'}`;
    case 'guard_unknown':
      return `guard_unknown: ${rejection.guardSource ?? '(guard source unavailable)'} (unresolved: ${rejection.unresolvedPaths.join(', ')})`;
  }
}

/**
 * エンジンの拒否を `ActionError` に写像する。
 *
 * @param rejection - `canFire` が返した拒否
 * @param eventId - ドメインイベントID（`{machine}.{event}`。仕様に実在するID）
 * @param actorRole - 実行者に解決された代表ロールID（`forbidden` のときだけ使う）
 * @returns ARCH-BE-0013 の3分類に落ちた `ActionError`
 */
export function toActionError(rejection: FireRejected, eventId: string, actorRole: string): ActionError {
  if (rejection.reason === 'role_forbidden') {
    return { kind: 'forbidden', event: eventId, role: actorRole };
  }
  const blockedBy = rejection.reason === 'guard_unsatisfied' || rejection.reason === 'guard_unknown' ? 'guard' : 'state';
  return { kind: 'guard_unsatisfied', event: eventId, blockedBy, reason: reasonOf(rejection) };
}

/**
 * access_spec 由来の操作（作成 / 削除 / 編集）の拒否。3 つは同じ形（ロール × ガード）である。
 *
 * 遷移と違い「状態で弾かれる」経路が無いため、拒否の中身も写像も完全に共通になる。
 */
type AccessRejected = CreateRejected | DeleteRejected | WriteRejected;

/**
 * access_spec 由来の拒否から `reason` 文字列を組み立てる。
 *
 * 作成・削除・編集には `otherwise_forbidden` に当たる仕様の理由文が存在しない
 * （禁止する状態が無いため）ので、**仕様に実在する値だけで構成した機械可読の診断文字列**を返す。
 * 表示文言はUIの責務であり、この値をそのままUIに出すためのものではない。
 */
function accessReasonOf(
  rejection: Extract<AccessRejected, { reason: 'guard_unsatisfied' | 'guard_unknown' }>,
): string {
  const source = rejection.guardSource ?? '(guard source unavailable)';
  if (rejection.reason === 'guard_unsatisfied') return `guard_unsatisfied: ${source}`;
  return `guard_unknown: ${source} (unresolved: ${rejection.unresolvedPaths.join(', ')})`;
}

/**
 * access_spec 由来の拒否を `ActionError` に写像する（作成 / 削除 / 編集の共通実装）。
 *
 * 遷移と同じ3分類に落とす。固有なのは「状態で弾かれる経路が無い」ことだけなので、
 * `blockedBy` は常に `guard` になる。公開しているのは操作ごとの薄い別名のほうで、
 * 呼び出し側が「どの照会の結果を写しているか」を名前で読めるようにしている。
 *
 * @param rejection - `canCreate` / `canDelete` / `canWrite` が返した拒否
 * @param eventId - 予約ID（`{entity}.create` / `.delete` / `.update`。仕様に実在するID）
 * @param actorRole - 実行者に解決された代表ロールID（`forbidden` のときだけ使う）
 * @returns ARCH-BE-0013 の3分類に落ちた `ActionError`
 */
function toAccessActionError(
  rejection: AccessRejected,
  eventId: string,
  actorRole: string,
): ActionError {
  if (rejection.reason === 'role_forbidden') {
    return { kind: 'forbidden', event: eventId, role: actorRole };
  }
  return {
    kind: 'guard_unsatisfied',
    event: eventId,
    blockedBy: 'guard',
    reason: accessReasonOf(rejection),
  };
}

/**
 * 作成可否の拒否を `ActionError` に写像する。
 *
 * @param rejection - `canCreate` が返した拒否
 * @param eventId - 予約ID（`{entity}.create`。仕様に実在するID）
 * @param actorRole - 実行者に解決された代表ロールID（`forbidden` のときだけ使う）
 * @returns ARCH-BE-0013 の3分類に落ちた `ActionError`
 */
export function toCreateActionError(
  rejection: CreateRejected,
  eventId: string,
  actorRole: string,
): ActionError {
  return toAccessActionError(rejection, eventId, actorRole);
}

/**
 * 削除可否の拒否を `ActionError` に写像する。
 *
 * @param rejection - `canDelete` が返した拒否
 * @param eventId - 予約ID（`{entity}.delete`。仕様に実在するID）
 * @param actorRole - 実行者に解決された代表ロールID（`forbidden` のときだけ使う）
 * @returns ARCH-BE-0013 の3分類に落ちた `ActionError`
 */
export function toDeleteActionError(
  rejection: DeleteRejected,
  eventId: string,
  actorRole: string,
): ActionError {
  return toAccessActionError(rejection, eventId, actorRole);
}

/**
 * 編集可否の拒否を `ActionError` に写像する。
 *
 * @param rejection - `canWrite` が返した拒否
 * @param eventId - 予約ID（`{entity}.update`。仕様に実在するID）
 * @param actorRole - 実行者に解決された代表ロールID（`forbidden` のときだけ使う）
 * @returns ARCH-BE-0013 の3分類に落ちた `ActionError`
 */
export function toWriteActionError(
  rejection: WriteRejected,
  eventId: string,
  actorRole: string,
): ActionError {
  return toAccessActionError(rejection, eventId, actorRole);
}
