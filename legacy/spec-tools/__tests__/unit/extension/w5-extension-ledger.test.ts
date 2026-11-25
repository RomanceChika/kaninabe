/**
 * W5(拡張候補の台帳と警告の出方の整合)のユニットテスト。
 *
 * 台帳の規約網羅(extension-candidates.md §区分の決め方と検査):
 *   - done の候補に当たる警告が残っていれば error / 残っていなければ通る
 *   - rules に検査器のコードに現れない ID があれば error(走査できない構成では見ない)
 *   - 候補どうしの rules が重なれば error(重なった検査 ID ごとに 1 件)
 *   - scope を、その鍵で絞れない検査に付けていれば error(絞れる検査だけに付けられる)
 *   - 絞りの鍵が存在する検査(T2 / T16 / A19)を rules に挙げる候補が scope を持たなければ error(M29)
 *   - 同じ検査でも scope が別なら重ならない
 *   - open / decided の候補に当たる警告が 0 件でも、何も言わない(候補は仕組み全体の宿題。1 製品で 0 件でも
 *     done ではない。状態は人が台帳で管理する)
 */

import { describe, expect, it } from 'vitest';
import type { Finding } from '../../../lib/kernel/finding.js';
import { verifyExtensionLedger } from '../../../lib/extension/verifiers/w5-extension-ledger.js';
import type { ExtensionCandidate, ExtensionLedger } from '../../../lib/model/extension/types.js';
import { T2_REASONS } from '../../../lib/data/index-reasons.js';

/** 候補 1 件を作る。 */
function candidate(
  id: string,
  rules: readonly string[],
  status: ExtensionCandidate['status'] = 'open',
  scope?: ExtensionCandidate['scope'],
): ExtensionCandidate {
  const base = { id, statement: '何かが組めない', rules, status, since: '2026-10-03', ref: 'BACKLOG.md', location: { file: 'ledger.md', pointer: `candidates.${id}` } };
  return scope === undefined ? base : { ...base, scope };
}

/** 台帳を作る。 */
function ledgerOf(...candidates: ExtensionCandidate[]): ExtensionLedger {
  return { candidates, location: { file: 'ledger.md' } };
}

/** 警告 1 件。 */
function warning(verifier: string, counterexample?: Readonly<Record<string, string>>, reason?: string): Finding {
  const base = { verifier, severity: 'warning', message: 'm', location: { file: 'f.md' }, suggestion: 's' } as const;
  const withExample = counterexample === undefined ? base : { ...base, counterexample };
  return reason === undefined ? withExample : { ...withExample, reason };
}

const KNOWN = new Set(['T2', 'T8', 'T11', 'T15', 'T16', 'A19']);

describe('W5: done の候補に当たる警告', () => {
  it('done なのに当たる警告が残っていれば error(件数と直し方を言う)', () => {
    const result = verifyExtensionLedger({
      ledger: ledgerOf(candidate('X-a', ['T8'], 'done')),
      findings: [warning('T8'), warning('T8')],
      knownIds: KNOWN, acceptances: [],
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      verifier: 'W5',
      severity: 'error',
      location: { file: 'legacy/spec-tools/extension-candidates.md', pointer: 'candidates.X-a.status' },
      counterexample: { id: 'X-a', rules: 'T8', remaining: '2' },
    });
    expect(result.findings[0]?.message).toContain('done ですが、当たる警告(T8)が 2 件残っています');
    expect(result.findings[0]?.suggestion).toContain('status を open か decided に戻す');
  });

  it('done で当たる警告が 0 件なら通る', () => {
    const result = verifyExtensionLedger({ ledger: ledgerOf(candidate('X-a', ['T8'], 'done')), findings: [warning('Y5')], knownIds: KNOWN, acceptances: [] });

    expect(result).toEqual({ findings: [] });
  });

  it('open の候補に当たる警告が残っているのは正常(error にしない)', () => {
    const result = verifyExtensionLedger({ ledger: ledgerOf(candidate('X-a', ['T8'])), findings: [warning('T8')], knownIds: KNOWN, acceptances: [] });

    expect(result).toEqual({ findings: [] });
  });
});

describe('W5: rules の検査 ID の実在', () => {
  it('検査器のコードに現れない ID は error', () => {
    const result = verifyExtensionLedger({ ledger: ledgerOf(candidate('X-a', ['T8', 'T99'])), findings: [warning('T8')], knownIds: KNOWN, acceptances: [] });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      counterexample: { id: 'X-a', rule: 'T99' },
      location: { pointer: 'candidates.X-a.rules' },
    });
    expect(result.findings[0]?.message).toContain('T99 は、全検査の表(lib/compose/all-checks.ts)にありません');
  });

});

describe('W5: rules の重なり', () => {
  it('2 つの候補が同じ検査 ID を持てば error(検査 ID ごとに 1 件)', () => {
    const result = verifyExtensionLedger({
      ledger: ledgerOf(candidate('X-a', ['T8', 'T11']), candidate('X-b', ['T11', 'T8']), candidate('X-c', ['T11'])),
      findings: [warning('T8'), warning('T11')],
      knownIds: KNOWN, acceptances: [],
    });

    expect(result.findings.map((finding) => finding.counterexample)).toEqual([
      { rule: 'T11', first: 'X-a', second: 'X-b' },
      { rule: 'T8', first: 'X-a', second: 'X-b' },
    ]);
  });

  it('重ならなければ通る', () => {
    const result = verifyExtensionLedger({ ledger: ledgerOf(candidate('X-a', ['T8']), candidate('X-b', ['T11'])), findings: [warning('T8'), warning('T11')], knownIds: KNOWN, acceptances: [] });

    expect(result.findings).toEqual([]);
  });
});

describe('W5: done の勧めは出さない', () => {
  it('open / decided の候補に当たる警告が 0 件でも、何も言わない(1 製品で 0 件でも仕組み全体の宿題は終わらない)', () => {
    const result = verifyExtensionLedger({
      ledger: ledgerOf(candidate('X-a', ['T8']), candidate('X-b', ['T15'], 'decided'), candidate('X-c', ['T2'], 'done', 'framework_tables')),
      findings: [warning('T8')],
      knownIds: KNOWN, acceptances: [],
    });

    expect(result).toEqual({ findings: [] });
  });
});

describe('W5: scope(絞りの鍵)', () => {
  it('絞りに収まる警告だけが done の残りに数えられる(製品の表の T2 は残りに入らない)', () => {
    const ledger = ledgerOf(candidate('X-t', ['T2'], 'done', 'framework_tables'));

    const productSide = warning('T2', { table: 'workshops' }, T2_REASONS.unrequested);
    expect(verifyExtensionLedger({ ledger, findings: [productSide], knownIds: KNOWN, acceptances: [] }).findings).toEqual([]);
    const frameworkSide = warning('T2', { table: 'jobs' }, T2_REASONS.frameworkTableFunctionless);
    const remaining = verifyExtensionLedger({ ledger, findings: [frameworkSide], knownIds: KNOWN, acceptances: [] }).findings;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.counterexample).toMatchObject({ id: 'X-t', remaining: '1' });
  });

  it('その鍵で絞れない検査に scope を付ければ error(絞れる検査だけに付けられる)', () => {
    const result = verifyExtensionLedger({
      ledger: ledgerOf(candidate('X-t', ['T2', 'T8'], 'open', 'framework_tables')),
      findings: [],
      knownIds: KNOWN, acceptances: [],
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      verifier: 'W5',
      severity: 'error',
      location: { pointer: 'candidates.X-t.scope' },
      counterexample: { id: 'X-t', scope: 'framework_tables', rule: 'T8' },
    });
    expect(result.findings[0]?.message).toContain('scope framework_tables は、検査 T8 の警告を絞れません(絞れるのは T2 だけ)');
  });

  it('絞れる検査だけなら通る', () => {
    const result = verifyExtensionLedger({
      ledger: ledgerOf(candidate('X-t', ['T2'], 'open', 'framework_tables'), candidate('X-g', ['T16'], 'open', 'trigger_formal_inexpressible')),
      findings: [],
      knownIds: KNOWN, acceptances: [],
    });

    expect(result.findings).toEqual([]);
  });

  it('新しい 2 つの鍵: 絞れる検査(T16 / A19)だけに付けば通り、取り違えれば error。T16 の 2 つの鍵は重ならない', () => {
    const ok = ledgerOf(
      candidate('X-trig', ['T16'], 'open', 'trigger_formal_inexpressible'),
      candidate('X-cross', ['T16'], 'open', 'trigger_cross_aggregate'),
      candidate('X-child', ['A19'], 'open', 'compute_child_set'),
    );
    expect(verifyExtensionLedger({ ledger: ok, findings: [], knownIds: KNOWN, acceptances: [] }).findings).toEqual([]);

    const swapped = verifyExtensionLedger({
      ledger: ledgerOf(candidate('X-c', ['A19'], 'open', 'trigger_cross_aggregate'), candidate('X-d', ['T16'], 'open', 'compute_child_set')),
      findings: [],
      knownIds: KNOWN, acceptances: [],
    });
    expect(swapped.findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('scope trigger_cross_aggregate は、検査 A19 の警告を絞れません(絞れるのは T16 だけ)'),
      expect.stringContaining('scope compute_child_set は、検査 T16 の警告を絞れません(絞れるのは A19 だけ)'),
    ]);
  });

  it('同じ検査でも scope が別なら重ならない・同じ scope や片方が絞り無しなら重なる', () => {
    const apart = ledgerOf(candidate('X-a', ['T16'], 'open', 'trigger_formal_inexpressible'), candidate('X-b', ['T16'], 'open', 'framework_tables'));
    const same = ledgerOf(candidate('X-a', ['T16'], 'open', 'trigger_formal_inexpressible'), candidate('X-b', ['T16'], 'open', 'trigger_formal_inexpressible'));
    const whole = ledgerOf(candidate('X-a', ['T16'], 'open', 'trigger_formal_inexpressible'), candidate('X-b', ['T16']));

    const overlaps = (ledger: ExtensionLedger) =>
      verifyExtensionLedger({ ledger, findings: [], knownIds: KNOWN, acceptances: [] }).findings.filter((finding) => finding.counterexample?.['first'] !== undefined);
    expect(overlaps(apart)).toEqual([]);
    expect(overlaps(same)).toHaveLength(1);
    expect(overlaps(whole)).toHaveLength(1);
  });
});

describe('W5: 絞りの鍵が存在する検査は scope が必須(M29)', () => {
  /** scope を要求された指摘だけを取り出す。 */
  function required(ledger: ExtensionLedger) {
    return verifyExtensionLedger({ ledger, findings: [], knownIds: KNOWN, acceptances: [] }).findings.filter((finding) => finding.location.pointer?.endsWith('.scope') === true && finding.message.includes('scope がありません'));
  }

  it('T2 を挙げる候補から scope を消せば error(台帳の吸い込み)。鍵の候補を suggestion に出す', () => {
    const found = required(ledgerOf(candidate('X-framework-tables', ['T2'])));

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      verifier: 'W5',
      severity: 'error',
      location: { file: 'legacy/spec-tools/extension-candidates.md', pointer: 'candidates.X-framework-tables.scope' },
      counterexample: { id: 'X-framework-tables', rule: 'T2', scopes: 'framework_tables' },
    });
    expect(found[0]?.suggestion).toContain('framework_tables');
  });

  it('T16 は鍵が 2 つあるので両方を提示する・A19 も同じく必須', () => {
    const found = required(ledgerOf(candidate('X-trigger', ['T16']), candidate('X-child', ['A19'])));

    expect(found.map((finding) => finding.counterexample)).toEqual([
      { id: 'X-trigger', rule: 'T16', scopes: 'trigger_formal_inexpressible,trigger_cross_aggregate' },
      { id: 'X-child', rule: 'A19', scopes: 'compute_child_set' },
    ]);
  });

  it('scope を書いていれば通る・鍵の無い検査(T8 / T11 / T15)は scope なしでよい', () => {
    expect(required(ledgerOf(candidate('X-t', ['T2'], 'open', 'framework_tables')))).toEqual([]);
    expect(required(ledgerOf(candidate('X-a', ['T8', 'T11']), candidate('X-b', ['T15'])))).toEqual([]);
  });

  it('1 つの候補が鍵のある検査を複数挙げて scope が無ければ、検査ごとに 1 件', () => {
    expect(required(ledgerOf(candidate('X-mix', ['T2', 'T16', 'T8'])))).toHaveLength(2);
  });
});

describe('W5: 受け入れた危険の接地', () => {
  const DECL = { reason: '外す理由', location: { file: 'auth.md', pointer: 'mfa' } };

  /** 受け入れた危険の警告 1 件。 */
  function accepted(acceptance: { reason: string; location: { file: string; pointer?: string } }): Finding {
    return { ...warning('H6'), acceptance };
  }

  it('読めた仕様の宣言(位置と理由)と一致すれば通る', () => {
    expect(verifyExtensionLedger({ ledger: ledgerOf(), findings: [accepted(DECL)], knownIds: KNOWN, acceptances: [DECL] }).findings).toEqual([]);
  });

  it('宣言が無い・位置が違う・理由が違えば error(検査が勝手に付けて未分類の門を抜けない)', () => {
    const cases = [
      { acceptances: [] },
      { acceptances: [{ ...DECL, location: { file: 'auth.md', pointer: 'other' } }] },
      { acceptances: [{ ...DECL, reason: '別の理由' }] },
    ];
    for (const { acceptances } of cases) {
      const found = verifyExtensionLedger({ ledger: ledgerOf(), findings: [accepted(DECL)], knownIds: KNOWN, acceptances }).findings;
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ verifier: 'W5', severity: 'error', location: { file: 'f.md' }, counterexample: { verifier: 'H6', file: 'auth.md', pointer: 'mfa' } });
      expect(found[0]?.message).toContain('同じ理由の受け入れの宣言がありません');
    }
  });

  it('理由が空なら error(宣言があっても)', () => {
    const blank = { ...DECL, reason: '  ' };
    const found = verifyExtensionLedger({ ledger: ledgerOf(), findings: [accepted(blank)], knownIds: KNOWN, acceptances: [blank] }).findings;
    expect(found.map((finding) => finding.message)).toEqual(['H6 の警告は受け入れた危険として出ていますが、理由が空です']);
  });
});
