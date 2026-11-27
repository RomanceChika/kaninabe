/**
 * P13: `implemented` に書いた id が、実装の範囲に入れられる仕様の id であること。
 *
 * 入れられる id は、印(`absentFor`)の持ち主の id と**同じ 1 つの一覧**(`scopeOwners` の結果)である。
 *   - 一覧にある id で、その種類が `uses` にあるもの → 受理
 *   - 知らない id・`uses` に無い種類の id・何も持たない id(access の id や `surface` など)→ error
 * 宣言なし・`[]` は何も言わない。
 */

import { makeFinding, type Finding } from '../../kernel/finding.js';
import type { ScopeOwner } from '../../kernel/scope-owner.js';
import { PRODUCT_DECL_FILE } from '../../io/paths.js';
import type { ProductImplemented } from '../../model/product/implemented.js';
import { usesKind, type ProductUses } from '../../model/product/uses.js';
import { requiredUse } from '../owners.js';

/** 検査 ID。 */
export const P13_VERIFIER_ID = 'P13';

/** P13 の入力。 */
export interface ImplementedIdsInput {
  readonly scope: ProductImplemented;
  /** 持ち主の一覧(`scopeOwners` の結果)。 */
  readonly owners: readonly ScopeOwner[];
  readonly uses: ProductUses;
}

/** 書いた id が持ち主の一覧にあり、その種類を採っているかを見る。 */
export function verifyImplementedIds(input: ImplementedIdsInput): Finding[] {
  if (!input.scope.declared) return [];
  const findings: Finding[] = [];
  input.scope.ids.forEach((id, index) => {
    const matching = input.owners.filter((owner) => owner.id === id);
    const accepted = matching.some((owner) => {
      const required = requiredUse(owner);
      return required === null || usesKind(input.uses, required);
    });
    if (accepted) return;
    findings.push(
      makeFinding(P13_VERIFIER_ID, {
        message: `implemented の ${id} は実装の範囲に入れられる仕様の id ではありません`,
        location: { file: PRODUCT_DECL_FILE, pointer: `implemented[${index}]` },
        suggestion:
          '綴りを直すか、その種類を uses に採るか、行を消す(書ける id は、操作・読み取り・画面・表・use case・走査の event・不変条件・カタログの id だけ。access の id や surface は持ち主ではない)',
        counterexample: { id },
      }),
    );
  });
  return findings;
}
