/**
 * 実装の範囲の検査(P13・P14)の実行口。**全群のあとに**1 回だけ呼ぶ(持ち主の一覧は、読めた全部の仕様から出るため)。
 */

import type { ScopeOwner } from '../kernel/scope-owner.js';
import type { Finding } from '../kernel/finding.js';
import type { ProductImplemented } from '../model/product/implemented.js';
import type { ProductUses, SpecKind } from '../model/product/uses.js';
import { readBaseScope } from './base.js';
import { verifyImplementedIds } from './verifiers/p13-implemented-ids.js';
import { verifyNarrowing } from './verifiers/p14-narrowing.js';

/** 実行口の入力。 */
export interface ImplementedScopeInput {
  readonly scope: ProductImplemented;
  readonly uses: ProductUses;
  readonly owners: readonly ScopeOwner[];
  readonly unloaded: readonly SpecKind[];
  /** 基準の `product.md`(`--implemented-base`)。無ければ P14 は走らない。 */
  readonly implementedBase?: string;
}

/** 実行口の結果。 */
export interface ImplementedScopeResult {
  readonly findings: readonly Finding[];
  /** 公開の log に載せてよい行(id を含まない)。 */
  readonly notes: readonly string[];
}

/**
 * P13・P14 を実行する。
 *
 * @param input 宣言・持ち主の一覧・基準
 */
export function runImplementedScope(input: ImplementedScopeInput): ImplementedScopeResult {
  const findings: Finding[] = [...verifyImplementedIds({ scope: input.scope, owners: input.owners, uses: input.uses })];
  const notes: string[] = [];
  if (input.implementedBase !== undefined) {
    const narrowing = verifyNarrowing({ head: input.scope, base: readBaseScope(input.implementedBase), owners: input.owners, unloaded: input.unloaded });
    findings.push(...narrowing.findings);
    if (narrowing.note !== null) notes.push(narrowing.note);
  }
  return { findings, notes };
}
