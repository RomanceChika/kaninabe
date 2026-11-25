/**
 * `npm run verify` の終了コード(`lib/verify/exit-code.ts`)のユニットテスト。
 *
 * 見るのは、既定は警告で落ちないこと・`--fail-on-unclassified` は未分類の警告だけで落ち、拡張候補に当たる警告では
 * 落ちないこと・台帳が無ければ警告はすべて未分類になって門が閉じること・エラーは門の有無によらず 1 であること。
 * 監査の変異 M14b(製品の表の `lookup` を消す = 未分類 1)が出荷の経路で赤になる根拠である。
 */

import { describe, expect, it } from 'vitest';
import type { Finding } from '../../../lib/kernel/finding.js';
import type { ExtensionLedger } from '../../../lib/model/extension/types.js';
import { decideExit, failOnUnclassifiedRequested } from '../../../lib/verify/exit-code.js';

/** 検査 1 件。 */
function finding(verifier: string, severity: Finding['severity'] = 'warning'): Finding {
  return { verifier, severity, message: 'm', location: { file: 'f.md' }, suggestion: 's' };
}

/** T8 を拡張候補に持つ台帳。 */
const LEDGER: ExtensionLedger = {
  candidates: [
    { id: 'X-a', statement: 's', rules: ['T8'], status: 'open', since: '2026-10-03', ref: 'r', location: { file: 'ledger.md' } },
  ],
  location: { file: 'ledger.md' },
};

describe('decideExit', () => {
  it('既定は警告だけなら 0(未分類があっても落とさない)', () => {
    expect(decideExit([finding('T8'), finding('T2')], LEDGER, false)).toEqual({ code: 0, gateNote: null });
  });

  it('エラーがあれば門の有無によらず 1(門の説明は付けない — エラーは各指摘が語る)', () => {
    expect(decideExit([finding('V1', 'error')], LEDGER, false)).toEqual({ code: 1, gateNote: null });
    expect(decideExit([finding('V1', 'error'), finding('T2')], LEDGER, true)).toEqual({ code: 1, gateNote: null });
  });

  it('--fail-on-unclassified: 拡張候補に当たる警告だけなら 0(仕組みの宿題は出荷を止めない)', () => {
    expect(decideExit([finding('T8'), finding('T8')], LEDGER, true)).toEqual({ code: 0, gateNote: null });
    expect(decideExit([], LEDGER, true)).toEqual({ code: 0, gateNote: null });
  });

  it('--fail-on-unclassified: 未分類が 1 件でもあれば 1 で、件数と直し方を言う', () => {
    const decision = decideExit([finding('T8'), finding('T2')], LEDGER, true);

    expect(decision.code).toBe(1);
    expect(decision.gateNote).toContain('未分類の警告が 1 件あります(--fail-on-unclassified)');
    expect(decision.gateNote).toContain('extension-candidates.md');
  });

  it('台帳が無い構成では警告がすべて未分類になるので、門は閉じる', () => {
    expect(decideExit([finding('T8')], null, true).code).toBe(1);
    expect(decideExit([finding('T8')], null, false).code).toBe(0);
  });
});

describe('failOnUnclassifiedRequested', () => {
  it('引数に綴りがあれば true(他の引数と並んでよい)', () => {
    expect(failOnUnclassifiedRequested(['--fail-on-unclassified'])).toBe(true);
    expect(failOnUnclassifiedRequested(['docs/specs/domain', '--root', 'x', '--fail-on-unclassified'])).toBe(true);
    expect(failOnUnclassifiedRequested(['docs/specs/domain'])).toBe(false);
    expect(failOnUnclassifiedRequested([])).toBe(false);
  });
});
