/**
 * C24 の Finding をターミナル向けに整形する純粋関数。
 *
 * 字面は verify(`lib/verify/report.ts`)と揃える —— 検査ごとに文面の形が違うと、
 * 読む人は毎回「これは何を言っているのか」から始めることになる。
 */

import type { FormalFinding } from './types.js';
import { FORMAL_CHECK_ID } from './types.js';

/** 色付けの有効・無効を呼ぶ側が決める(CI では無効化できるように)。 */
export interface FormalReportOptions {
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
 * 1 件の Finding を複数行のテキストにする。
 *
 * @param finding 整形する 1 件
 * @param opts 色付けの有無
 * @returns 改行で区切ったテキスト
 */
export function formatFormalFinding(finding: FormalFinding, opts: FormalReportOptions): string {
  const severity =
    finding.severity === 'error'
      ? paint(opts.color, RED, 'error')
      : paint(opts.color, YELLOW, 'warn ');
  const lines = [
    `${severity} ${paint(opts.color, BOLD, `[${FORMAL_CHECK_ID}]`)} ${finding.message}`,
    `      ${paint(opts.color, DIM, `場所: ${finding.location}`)}`,
    `      ${paint(opts.color, DIM, `対処: ${finding.suggestion}`)}`,
  ];
  for (const detail of finding.detail ?? []) {
    lines.push(`      ${paint(opts.color, DIM, detail)}`);
  }
  return lines.join('\n');
}

/**
 * 実行のまとめ 1 行。
 *
 * @param findings 出た Finding
 * @param checked 実際に回した性質の数
 * @param opts 色付けの有無
 * @returns まとめの 1 行
 */
export function formatFormalSummary(
  findings: readonly FormalFinding[],
  checked: number,
  opts: FormalReportOptions,
): string {
  const errors = findings.filter((finding) => finding.severity === 'error').length;
  if (errors === 0) {
    return `✓ 約束事のモデル ${checked} 性質は、すべて expectations.json の宣言どおりでした`;
  }
  return `検査結果: ${paint(opts.color, RED, `エラー ${errors} 件`)}(回した性質 ${checked} 件)`;
}
