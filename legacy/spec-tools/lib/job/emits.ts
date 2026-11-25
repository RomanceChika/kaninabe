/**
 * 走査が積む通知の対応(`emits`)を引く共通部品。
 *
 * J1(積まれない outbox 行を落とす)・N1(通知の発火元を数える)・生成物(表の「発火元」の列)が
 * **同じこの 1 本の走査**を読む(`lib/semantics/effect-refs.ts` が `effects` の走査を持つのと同じ形)。
 */

import type { JobCatalogSpec } from '../model/job/types.js';

/**
 * 通知(ジョブ種別)ID → それを `emits` で積む走査のジョブ ID の一覧。
 *
 * @param catalog 読み込み済みのジョブカタログ
 * @returns 積まれる側の ID をキーにした走査の ID の並び(宣言順)
 */
export function emittedBy(catalog: JobCatalogSpec | null): ReadonlyMap<string, readonly string[]> {
  const byId = new Map<string, string[]>();
  for (const decl of catalog?.jobs ?? []) {
    for (const emitted of decl.schedule?.emits ?? []) {
      // 1 本の走査の `emits` に重複は無い(J0 が落とす)ので、走査の ID は重ならない。
      byId.set(emitted, [...(byId.get(emitted) ?? []), decl.id]);
    }
  }
  return byId;
}
