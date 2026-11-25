/**
 * 拡張候補の台帳の検査(W5)の実行口のテスト。
 *
 * 台帳が無い・読めない構成で壊れないこと、あれば区分の件数を実行状況の行に出すこと(「done にしてよい」の進捗行は出さない)。
 */

import { describe, expect, it } from 'vitest';
import type { Finding } from '../../../lib/kernel/finding.js';
import { runExtensionLedger } from '../../../lib/extension/run.js';
import type { ExtensionLedger } from '../../../lib/model/extension/types.js';

const LEDGER: ExtensionLedger = {
  candidates: [
    { id: 'X-a', statement: 's', rules: ['T8'], status: 'open', since: '2026-10-03', ref: 'r', location: { file: 'l.md', pointer: 'candidates.X-a' } },
    { id: 'X-b', statement: 's', rules: ['T15'], status: 'done', since: '2026-10-03', ref: 'r', location: { file: 'l.md', pointer: 'candidates.X-b' } },
  ],
  location: { file: 'l.md' },
};

/** 警告 1 件。 */
function warning(verifier: string): Finding {
  return { verifier, severity: 'warning', message: 'm', location: { file: 'f.md' }, suggestion: 's' };
}

describe('runExtensionLedger', () => {
  it('台帳が無い構成は何も見ず、警告は未分類として数えると言う', () => {
    const result = runExtensionLedger({ model: { available: false, ledger: null }, loadFindings: [], findings: [warning('T8')], knownIds: new Set<string>(), acceptances: [] });

    expect(result.findings).toEqual([]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toContain('台帳が無いので、警告はすべて未分類');
  });

  it('台帳を読めなければ、読むときの違反をそのまま返す', () => {
    const broken: Finding = { verifier: 'W5', severity: 'error', message: 'broken', location: { file: 'l.md' }, suggestion: 's' };
    const result = runExtensionLedger({ model: { available: true, ledger: null }, loadFindings: [broken], findings: [], knownIds: new Set<string>(), acceptances: [] });

    expect(result.findings).toEqual([broken]);
    expect(result.lines[0]).toContain('台帳を読めない');
  });

  it('区分の件数を実行状況の行に出し、整合の違反も返す', () => {
    const result = runExtensionLedger({
      model: { available: true, ledger: LEDGER },
      loadFindings: [],
      findings: [warning('T8'), warning('Y5'), warning('T15')],
      knownIds: new Set(['T8', 'T15']), acceptances: [],
    });

    expect(result.lines[0]).toBe(
      'W 群(拡張候補の台帳): 候補 2 件(未完了 1)に対し W5 を実行しました(警告 3 件 = 拡張候補 2 / 未分類 1)。',
    );
    // X-b は done なのに T15 の警告が残っている。
    expect(result.findings.map((finding) => finding.counterexample?.['id'])).toEqual(['X-b']);
  });

  it('当たる警告が 0 件の候補があっても「done にしてよい」の行は足さない', () => {
    const result = runExtensionLedger({
      model: { available: true, ledger: LEDGER },
      loadFindings: [],
      findings: [],
      knownIds: new Set(['T8', 'T15']), acceptances: [],
    });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toContain('警告 0 件 = 拡張候補 0 / 未分類 0');
  });
});
