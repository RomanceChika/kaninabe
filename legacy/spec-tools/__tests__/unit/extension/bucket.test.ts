/**
 * 警告の区分(拡張候補 / 未分類)を決める純関数のユニットテスト。
 *
 * 見るのは、検査 ID が候補の `rules` に入っていれば拡張候補・入っていなければ未分類になること、
 * 候補が `scope`(絞りの鍵)を持てば、その鍵に収まる警告だけが当たること(製品の表の T2 は未分類・
 * 仕組みの表の T2 は候補。検査 ID だけで当てると製品の側で直すべき警告が候補に化ける)、
 * error は区分を持たないこと、台帳が無いときは警告がすべて未分類になること(黙って分類済みにしない)。
 */

import { describe, expect, it } from 'vitest';
import type { Finding } from '../../../lib/kernel/finding.js';
import { bucketBreakdown, bucketCounts, bucketLabel, bucketOf, candidateOf, hitsByCandidate } from '../../../lib/extension/bucket.js';
import type { ExtensionCandidate, ExtensionLedger } from '../../../lib/model/extension/types.js';
import { T16_REASONS } from '../../../lib/data/check-reasons.js';
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

/** 台帳。 */
const LEDGER: ExtensionLedger = {
  candidates: [candidate('X-a', ['T8', 'T11']), candidate('X-b', ['T15'])],
  location: { file: 'ledger.md' },
};

/** Finding 1 件。 */
function finding(
  verifier: string,
  severity: Finding['severity'] = 'warning',
  counterexample?: Readonly<Record<string, string>>,
  reason?: string,
): Finding {
  const base = { verifier, severity, message: 'm', location: { file: 'f.md' }, suggestion: 's' } as const;
  const withExample = counterexample === undefined ? base : { ...base, counterexample };
  return reason === undefined ? withExample : { ...withExample, reason };
}

describe('警告の区分', () => {
  it('rules に検査 ID がある警告は、その候補の宿題として数える', () => {
    expect(bucketOf(finding('T11'), LEDGER)).toEqual({ kind: 'extension', candidate: LEDGER.candidates[0] });
    expect(bucketOf(finding('T15'), LEDGER)).toEqual({ kind: 'extension', candidate: LEDGER.candidates[1] });
    expect(candidateOf(finding('T8'), LEDGER)?.id).toBe('X-a');
  });

  it('どの候補にも当たらない警告は未分類', () => {
    expect(bucketOf(finding('Y5'), LEDGER)).toEqual({ kind: 'unclassified' });
  });

  it('error は区分を持たない(区分は警告の管理の話)', () => {
    expect(bucketOf(finding('T8', 'error'), LEDGER)).toBeNull();
  });

  it('台帳が無ければ警告はすべて未分類になる(黙って分類済みにしない)', () => {
    expect(bucketOf(finding('T8'), null)).toEqual({ kind: 'unclassified' });
    expect(candidateOf(finding('T8'), null)).toBeUndefined();
  });

  it('区分は人が読む言い方で出る', () => {
    expect(bucketLabel({ kind: 'extension', candidate: candidate('X-a', ['T8']) })).toBe('拡張候補 X-a');
    expect(bucketLabel({ kind: 'unclassified' })).toBe('未分類');
  });

  it('件数は区分ごとに数え、error は数えない', () => {
    const findings = [finding('T8'), finding('T11'), finding('T15'), finding('Y5'), finding('V1', 'error')];

    expect(bucketCounts(findings, LEDGER)).toEqual({ accepted: 0, extension: 3, unclassified: 1 });
    expect(bucketCounts(findings, null)).toEqual({ accepted: 0, extension: 0, unclassified: 4 });
  });

  it('候補ごとに当たる警告を宣言順に集める(error は当たらない)', () => {
    const findings = [finding('T11'), finding('T15', 'error'), finding('T8')];
    const rows = hitsByCandidate(findings, LEDGER);

    expect(rows.map((row) => [row.candidate.id, row.hits.length])).toEqual([
      ['X-a', 2],
      ['X-b', 0],
    ]);
  });

  describe('scope(絞りの鍵)', () => {
    const SCOPED: ExtensionLedger = {
      candidates: [candidate('X-tables', ['T2'], 'open', 'framework_tables'), candidate('X-trigger', ['T16'], 'open', 'trigger_formal_inexpressible')],
      location: { file: 'ledger.md' },
    };

    it('framework_tables: 製品が関数を宣言していない仕組みの表の T2 は拡張候補・それ以外の T2 は未分類', () => {
      const functionless = finding('T2', 'warning', { table: 'jobs', index: 'jobs_due_idx' }, T2_REASONS.frameworkTableFunctionless);
      const declared = finding('T2', 'warning', { table: 'jobs', index: 'jobs_due_idx' }, T2_REASONS.unrequested);
      const product = finding('T2', 'warning', { table: 'workshops', index: 'workshops_extra_idx' }, T2_REASONS.unrequested);

      expect(bucketOf(functionless, SCOPED)).toEqual({ kind: 'extension', candidate: SCOPED.candidates[0] });
      // 製品が関数を宣言している仕組みの表の索引は、製品が lookup を書ける = 仕組みの宿題ではない(M14a)
      expect(bucketOf(declared, SCOPED)).toEqual({ kind: 'unclassified' });
      expect(bucketOf(product, SCOPED)).toEqual({ kind: 'unclassified' });
    });

    it('framework_tables: 理由の欄を持たない T2 の警告は絞りに収まらない(未分類)', () => {
      expect(bucketOf(finding('T2'), SCOPED)).toEqual({ kind: 'unclassified' });
      expect(bucketOf(finding('T2', 'warning', { table: 'jobs' }), SCOPED)).toEqual({ kind: 'unclassified' });
    });

    it('trigger_formal_inexpressible: 理由が「写像の外のトリガ」の T16 は候補・製品が直せる理由の T16 は未分類', () => {
      const inexpressible = finding('T16', 'warning', { invariant: 'INV-A-001', ref: 'check_a', kind: 'trigger', formal: 'cardinality' }, T16_REASONS.triggerFormalInexpressible);
      const noFormal = finding('T16', 'warning', { invariant: 'INV-A-004', ref: 'check_d', kind: 'trigger', formal: '' }, T16_REASONS.triggerFormalInexpressible);
      const writable = finding('T16', 'warning', { invariant: 'INV-A-005', ref: 'check_e', kind: 'trigger', formal: 'check' }, T16_REASONS.enforcementUndeclared);
      const constraint = finding('T16', 'warning', { invariant: 'INV-A-002', ref: 'a_check', kind: 'db_constraint', formal: 'cardinality' }, T16_REASONS.enforcementUndeclared);
      const reflect = finding('T16', 'warning', { constraint: 'a_check', invariant: 'INV-A-003', reason: 'r' }, T16_REASONS.checkNotReflected);

      expect(bucketOf(inexpressible, SCOPED)).toEqual({ kind: 'extension', candidate: SCOPED.candidates[1] });
      expect(bucketOf(noFormal, SCOPED)).toEqual({ kind: 'extension', candidate: SCOPED.candidates[1] });
      expect(bucketOf(writable, SCOPED)).toEqual({ kind: 'unclassified' });
      expect(bucketOf(constraint, SCOPED)).toEqual({ kind: 'unclassified' });
      expect(bucketOf(reflect, SCOPED)).toEqual({ kind: 'unclassified' });
    });

    it('scope の無い候補は検査 ID の全体に当たる(従来どおり)', () => {
      const whole: ExtensionLedger = { candidates: [candidate('X-tables', ['T2'])], location: { file: 'ledger.md' } };

      expect(bucketOf(finding('T2', 'warning', { table: 'workshops' }), whole)?.kind).toBe('extension');
    });

    it('候補ごとの当たりと件数も絞りに従う', () => {
      const findings = [
        finding('T2', 'warning', { table: 'jobs' }, T2_REASONS.frameworkTableFunctionless),
        finding('T2', 'warning', { table: 'workshops' }, T2_REASONS.unrequested),
        finding('T16', 'warning', { kind: 'trigger', formal: 'cardinality' }, T16_REASONS.triggerFormalInexpressible),
      ];

      expect(bucketCounts(findings, SCOPED)).toEqual({ accepted: 0, extension: 2, unclassified: 1 });
      expect(hitsByCandidate(findings, SCOPED).map((row) => row.hits.length)).toEqual([1, 1]);
    });
  });
});

describe('受け入れた危険(仕様が理由つきで外した結果の警告)', () => {
  const ACCEPTANCE = { reason: '外す理由', location: { file: 'auth.md', pointer: 'mfa' } };
  const accepted: Finding = { ...finding('T8'), acceptance: ACCEPTANCE };

  it('acceptance を持つ警告は、台帳の候補より先に「受け入れた危険」になる(候補にも当たらない)', () => {
    expect(bucketOf(accepted, LEDGER)).toEqual({ kind: 'accepted', reason: '外す理由' });
    expect(candidateOf(accepted, LEDGER)).toBeUndefined();
    expect(hitsByCandidate([accepted], LEDGER).every((row) => row.hits.length === 0)).toBe(true);
  });

  it('台帳が無ければ未分類に倒す(宣言との突合 W5 が回らないので、受け入れを確かめられない)', () => {
    expect(bucketOf(accepted, null)).toEqual({ kind: 'unclassified' });
  });

  it('区分の言い方は「受け入れた危険 — 理由」。件数は別に数え、内訳は 0 件なら出さない', () => {
    expect(bucketLabel({ kind: 'accepted', reason: '外す理由' })).toBe('受け入れた危険 — 外す理由');
    const counts = bucketCounts([accepted, finding('T15'), finding('Y5')], LEDGER);
    expect(counts).toEqual({ accepted: 1, extension: 1, unclassified: 1 });
    expect(bucketBreakdown(counts)).toBe('受け入れた危険 1 / 拡張候補 1 / 未分類 1');
    expect(bucketBreakdown({ accepted: 0, extension: 2, unclassified: 0 })).toBe('拡張候補 2 / 未分類 0');
  });
});
