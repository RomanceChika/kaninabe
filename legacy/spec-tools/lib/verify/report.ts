/**
 * Finding をターミナル向けに整形する純粋関数群。
 * CLI(verify-docs.ts)だけが使う。色付けは ANSI エスケープ(外部依存なし)。
 */

import { bucketBreakdown, bucketCounts, bucketLabel, bucketOf } from '../extension/bucket.js';
import type { ExtensionLedger } from '../model/extension/types.js';
import type { Finding } from '../kernel/finding.js';

/** 色付けの有効/無効を呼び出し側が決める(CI では無効化できるように)。 */
export interface ReportOptions {
  readonly color: boolean;
}

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function paint(enabled: boolean, code: string, text: string): string {
  return enabled ? `${code}${text}${RESET}` : text;
}

/**
 * 1 件の Finding を複数行のテキストに整形する。
 *
 * @param f 検証結果 1 件
 * @param opts 色付けの有無
 * @param ledger 拡張候補の台帳。渡すと、警告の ID の次に区分(`(拡張候補 X-…)` / `(未分類)`)を出す。
 *   省略(区分を知らない呼び出し)では区分を出さない
 */
export function formatFinding(f: Finding, opts: ReportOptions, ledger?: ExtensionLedger | null): string {
  const bucket = ledger === undefined ? null : bucketOf(f, ledger);
  const bucketText = bucket === null ? '' : ` ${paint(opts.color, DIM, `(${bucketLabel(bucket)})`)}`;
  const sev =
    f.severity === 'error'
      ? paint(opts.color, RED, 'error')
      : paint(opts.color, YELLOW, 'warn ');
  const where = f.location.pointer
    ? `${f.location.file} > ${f.location.pointer}`
    : f.location.file;
  const lines = [
    `${sev} ${paint(opts.color, BOLD, `[${f.verifier}]`)}${bucketText} ${f.message}`,
    `      ${paint(opts.color, DIM, `場所: ${where}`)}`,
    `      ${paint(opts.color, DIM, `対処: ${f.suggestion}`)}`,
  ];
  if (f.counterexample && Object.keys(f.counterexample).length > 0) {
    const pairs = Object.entries(f.counterexample)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    lines.push(`      ${paint(opts.color, DIM, `反例: ${pairs}`)}`);
  }
  return lines.join('\n');
}

/**
 * 飛ばした検査の件数のサマリ行を整形する。
 *
 * 「エラー 0 / 警告 N」だけだと、**検査の範囲が縮んだまま緑になった実行**と全部を見た実行が
 * 見分けのつかない形になる(検査の漏れ探し 2026-09-12 §3)。飛ばした範囲があるなら最後の行でそれを言う。
 *
 * @param notes 飛ばしたことを報告した進捗行
 * @param opts 色付けの有無
 * @returns サマリ行
 */
export function formatSkipSummary(notes: readonly string[], opts: ReportOptions): string {
  return paint(opts.color, DIM, `(このうち ${notes.length} 件の範囲は実行していません — 上の進捗行を参照)`);
}

/**
 * 全 Finding のサマリ行(エラー数・警告数)を整形する。
 *
 * @param findings 全 Finding
 * @param opts 色付けの有無
 * @param ledger 拡張候補の台帳。渡すと警告の件数に区分の内訳(`(拡張候補 N / 未分類 M)`)を添える
 */
export function formatSummary(findings: readonly Finding[], opts: ReportOptions, ledger?: ExtensionLedger | null): string {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  if (findings.length === 0) {
    return '✓ すべての検証を通過しました(仕様に未定義・矛盾はありません)';
  }
  const parts: string[] = [];
  if (errors > 0) parts.push(paint(opts.color, RED, `エラー ${errors} 件`));
  if (warnings > 0) {
    const counts = ledger === undefined ? null : bucketCounts(findings, ledger);
    const breakdown = counts === null ? '' : `(${bucketBreakdown(counts)})`;
    parts.push(paint(opts.color, YELLOW, `警告 ${warnings} 件${breakdown}`));
  }
  return `検証結果: ${parts.join(' / ')}`;
}
