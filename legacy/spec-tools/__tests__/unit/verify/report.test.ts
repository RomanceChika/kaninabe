/**
 * verify の出力の整形(`report.ts`)のテスト。
 *
 * 警告は 1 行ごとに区分(`(拡張候補 X-…)` / `(未分類)`)を付け、末尾の集計に内訳を添える。
 * 台帳を渡さない呼び出し(区分を知らない呼び出し)は従来どおりの出力のまま。
 */

import { describe, expect, it } from 'vitest';
import type { ExtensionLedger } from '../../../lib/model/extension/types.js';
import type { Finding } from '../../../lib/kernel/finding.js';
import { formatFinding, formatSummary } from '../../../lib/verify/report.js';

const PLAIN = { color: false };

const LEDGER: ExtensionLedger = {
  candidates: [
    { id: 'X-derived-columns', statement: 's', rules: ['T15'], status: 'open', since: '2026-10-03', ref: 'r', location: { file: 'l.md', pointer: 'candidates.X-derived-columns' } },
  ],
  location: { file: 'l.md' },
};

/** Finding 1 件。 */
function finding(verifier: string, severity: Finding['severity']): Finding {
  return { verifier, severity, message: `${verifier} の指摘`, location: { file: 'docs/a.md', pointer: 'x' }, suggestion: '直す' };
}

describe('formatFinding', () => {
  it('台帳を渡すと、警告に区分を付ける(拡張候補は候補の id まで言う)', () => {
    expect(formatFinding(finding('T15', 'warning'), PLAIN, LEDGER).split('\n')[0]).toBe('warn  [T15] (拡張候補 X-derived-columns) T15 の指摘');
    expect(formatFinding(finding('Y5', 'warning'), PLAIN, LEDGER).split('\n')[0]).toBe('warn  [Y5] (未分類) Y5 の指摘');
  });

  it('台帳が無い(null)なら警告はすべて未分類と出る', () => {
    expect(formatFinding(finding('T15', 'warning'), PLAIN, null).split('\n')[0]).toBe('warn  [T15] (未分類) T15 の指摘');
  });

  it('error には区分を付けない', () => {
    expect(formatFinding(finding('T15', 'error'), PLAIN, LEDGER).split('\n')[0]).toBe('error [T15] T15 の指摘');
  });

  it('台帳を渡さない呼び出しは従来どおり(区分を出さない)', () => {
    expect(formatFinding(finding('T15', 'warning'), PLAIN).split('\n')[0]).toBe('warn  [T15] T15 の指摘');
  });

  it('場所・対処の行は変わらない', () => {
    expect(formatFinding(finding('T15', 'warning'), PLAIN, LEDGER).split('\n').slice(1)).toEqual([
      '      場所: docs/a.md > x',
      '      対処: 直す',
    ]);
  });
});

describe('formatSummary', () => {
  it('警告の件数に、拡張候補 / 未分類の内訳を添える', () => {
    const findings = [finding('T15', 'warning'), finding('T15', 'warning'), finding('Y5', 'warning')];

    expect(formatSummary(findings, PLAIN, LEDGER)).toBe('検証結果: 警告 3 件(拡張候補 2 / 未分類 1)');
  });

  it('エラーがあれば並べ、内訳は警告にだけ付く', () => {
    const findings = [finding('V1', 'error'), finding('T15', 'warning')];

    expect(formatSummary(findings, PLAIN, LEDGER)).toBe('検証結果: エラー 1 件 / 警告 1 件(拡張候補 1 / 未分類 0)');
  });

  it('台帳を渡さない呼び出しは従来どおり、結果が空なら通過の 1 行', () => {
    expect(formatSummary([finding('Y5', 'warning')], PLAIN)).toBe('検証結果: 警告 1 件');
    expect(formatSummary([], PLAIN, LEDGER)).toBe('✓ すべての検証を通過しました(仕様に未定義・矛盾はありません)');
  });
});
