/**
 * 実装の範囲による仕分け。`runAllVerifications` の最後に 1 回だけ行い、ビルドの関所(build-gate)も同じ関数を呼ぶ。
 *
 * 守るのは 5 つ(どれも「範囲が本物の誤りを消さない」向き)。
 *   ① 宣言が無ければ入力と同じものが返り、報告も無い
 *   ② 範囲の外の持ち主の印(`absentFor`)が付いた **error だけ**が報告へ移る。印の無い指摘は種類を問わず絶対に移らない
 *   ③ 範囲の中の持ち主の error は残る
 *   ④ 印が warning に付いていたら throw する(印は不在の error 専用。宣言が無いときも見る)
 *   ⑤ 印の持ち主が持ち主の一覧に無ければ、範囲の外とは扱わず残す
 */

import type { Finding } from '../kernel/finding.js';
import type { ScopeOwner, ScopeOwnerKind } from '../kernel/scope-owner.js';
import type { ProductImplemented } from '../model/product/implemented.js';

/** 仕分けの報告(要約の行の材料)。 */
export interface ScopeReport {
  /** 範囲に入れると宣言した id の数。 */
  readonly declared: number;
  /** 範囲の外にある持ち主の数(種類ごと。指摘が無い仕様も含める)。 */
  readonly kinds: Readonly<Partial<Record<ScopeOwnerKind, number>>>;
  /** 範囲の外にある持ち主(`--list-out-of-scope` のときだけ名指す)。 */
  readonly owners: readonly ScopeOwner[];
  /** 外した(求めなかった)指摘の件数。 */
  readonly relieved: number;
}

/** 仕分けの結果。 */
export interface ScopePartition {
  /** 残った指摘(入力の順)。 */
  readonly kept: readonly Finding[];
  /** 範囲の外として外した指摘(入力の順)。 */
  readonly relieved: readonly Finding[];
  /** 報告。宣言が無ければ null。 */
  readonly report: ScopeReport | null;
}

/**
 * 指摘を仕分ける。
 *
 * @param findings 全群の指摘
 * @param scope 製品の宣言
 * @param universe 持ち主の一覧(`scopeOwners` の結果)
 * @returns 残る指摘・外した指摘・報告
 */
export function partitionByScope(findings: readonly Finding[], scope: ProductImplemented, universe: readonly ScopeOwner[]): ScopePartition {
  for (const finding of findings) {
    if (finding.absentFor !== undefined && finding.severity !== 'error') {
      throw new Error(`${finding.verifier} の warning に不在の印が付いています。印は不在の error 専用です: ${finding.message}`);
    }
  }
  if (!scope.declared) return { kept: findings, relieved: [], report: null };

  const inScope = new Set(scope.ids);
  const known = new Set(universe.map((owner) => key(owner)));
  const kept: Finding[] = [];
  const relieved: Finding[] = [];
  for (const finding of findings) {
    const owner = finding.absentFor;
    if (owner !== undefined && known.has(key(owner)) && !inScope.has(owner.id)) relieved.push(finding);
    else kept.push(finding);
  }
  const outside = universe.filter((owner) => !inScope.has(owner.id));
  const kinds: Partial<Record<ScopeOwnerKind, number>> = {};
  for (const owner of outside) kinds[owner.kind] = (kinds[owner.kind] ?? 0) + 1;
  return { kept, relieved, report: { declared: scope.ids.length, kinds, owners: outside, relieved: relieved.length } };
}

const key = (owner: ScopeOwner): string => `${owner.kind}\u0000${owner.id}`;
