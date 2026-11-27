/**
 * 実装の範囲の要約の 1 行(指摘ではなく要約。警告にすると `--fail-on-unclassified` と拡張候補の台帳に絡む)。
 *
 * 既定は**種類と件数だけ**(公開される場所の log に載りうる。範囲の外の仕様の名前は出さない)。名指すのは手元で
 * `--list-out-of-scope` を付けたときだけ。
 */

import type { ScopeReport } from './partition.js';

/** 要約の行の書式。 */
export interface ScopeSummaryOptions {
  /** 範囲の外の仕様の id を名指す(`--list-out-of-scope`)。 */
  readonly listNames: boolean;
}

/**
 * 要約の 1 行を組み立てる。
 *
 * @param report 仕分けの報告
 * @param options 書式
 * @returns 1 行(`listNames` のときは id を続ける)
 */
export function formatScopeSummary(report: ScopeReport, options: ScopeSummaryOptions): string {
  const kinds = Object.entries(report.kinds).map(([kind, count]) => `${kind} ${String(count)}`);
  const outside = kinds.length === 0 ? 'なし' : kinds.join(' / ');
  const line = `実装の範囲: 宣言 ${String(report.declared)} 件。範囲の外: ${outside} (求めなかった突合 ${String(report.relieved)} 件)`;
  if (!options.listNames) return line;
  return `${line}\n範囲の外の仕様: ${report.owners.map((owner) => `${owner.kind}:${owner.id}`).join(' / ')}`;
}
