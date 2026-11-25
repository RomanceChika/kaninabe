/**
 * Z2 未執行の警告(`status: planned` の保証を毎回言い立てる)。
 *
 * guarantee-spec-writing.md の要求:「`status: planned` の保証 1 件につき warning を出す」。
 * **免除の口は作らない** — N 群 / K 群のような「掃除漏れの検出」ではなく、
 * 「まだ執行されていない」という事実そのものを消し込まれるまで毎回見せ続けるのが目的である
 * (U 群の `ux:` のような免除宣言を許すと、`planned` が事実上 `enforced` と同じ扱いで
 * 静かに居座れてしまう)。
 */

import { makeFinding, type Finding } from '../../kernel/finding.js';
import type { GuaranteeSpecModel } from '../../model/guarantee/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'Z2';

/**
 * `status: planned` の保証ごとに warning を積む。
 *
 * @param guarantee 読み込み済みの保証台帳
 * @returns 保証 1 件につき 1 件の warning(planned が無ければ空)
 */
export function verifyPlannedGuarantees(guarantee: GuaranteeSpecModel): Finding[] {
  const catalog = guarantee.catalog;
  if (catalog === null) return [];
  return catalog.guarantees
    .filter((decl) => decl.status === 'planned')
    .map((decl) =>
      makeFinding(VERIFIER_ID, {
        severity: 'warning',
        message: `保証 ${decl.id} はまだ執行されていない: ${decl.plannedReason ?? ''}`,
        location: decl.location,
        suggestion:
          `${decl.enforcedBy.join(' / ')} での執行に着手したら、status を enforced にして ` +
          'canaries に見張りテストの id を足す(理由は消える)',
        counterexample: { guarantee: decl.id, planned_reason: decl.plannedReason ?? '' },
      }),
    );
}
