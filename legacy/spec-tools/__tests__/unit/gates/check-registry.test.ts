/**
 * **全検査の表**(`lib/compose/all-checks.ts`)の構造テスト。
 *
 * 検査 ID を 1 つの表で列挙できること、同じ ID を 2 つの群が宣言しないこと、群の中で同じ ID の段が `part` で区別されていること、コードに検査 ID として書かれた綴りが表から漏れていないこと
 * (検査を足したのに群の登録に足し忘れた形)、後段が登録する検査の口が表に載っていること、W5 が表を引いて ID の実在を見ること。
 */

import { describe, expect, it } from 'vitest';
import { ALL_CHECK_GROUPS, ALL_CHECKS, knownCheckIds } from '../../../lib/compose/all-checks.js';
import { JOB_CHECK_SLOTS, NO_JOB_TARGETS, resolveJobChecks } from '../../../lib/job/target-checks.js';
import { duplicateCheckIds, repeatedCheckProblems, type CheckGroup } from '../../../lib/kernel/check-entry.js';
import { verifyExtensionLedger } from '../../../lib/extension/verifiers/w5-extension-ledger.js';
import { VERIFIER_ID_SHAPE } from '../../../lib/model/extension/parse-candidates.js';
import type { ExtensionLedger } from '../../../lib/model/extension/types.js';
import { scanKnownVerifierIds } from '../../helpers/verifier-id-scan.js';
import { TEST_TARGETS } from '../../helpers/platform.js';

/** 表に載っていない検査 ID のリテラル(コードに ID として書かれているのに、表の接頭辞の群に登録が無いもの)。 */
function unregisteredLiterals(literals: ReadonlySet<string>, table: ReadonlySet<string>): string[] {
  const prefixes = new Set([...table].map((id) => id.replace(/[0-9]+$/, '')));
  return [...literals].filter((id) => prefixes.has(id.replace(/[0-9]+$/, '')) && !table.has(id)).sort();
}

describe('全検査の表', () => {
  it('表は空でなく、全部の ID が検査 ID の形で、題を持つ', () => {
    expect(ALL_CHECKS.length).toBeGreaterThan(100);
    for (const check of ALL_CHECKS) {
      expect(check.id, check.id).toMatch(VERIFIER_ID_SHAPE);
      expect(check.title.length, check.id).toBeGreaterThan(0);
    }
  });

  it('同じ ID を 2 つの群が登録していない(表の ID は一意)', () => {
    expect(duplicateCheckIds(ALL_CHECK_GROUPS)).toEqual([]);
    expect(new Set(ALL_CHECKS.map((check) => check.id)).size).toBe(ALL_CHECKS.length);
  });

  it('群の中で同じ ID の段は、全部が part を持ち互いに違う(1 つの検査の一部だと段そのものが言う)', () => {
    expect(repeatedCheckProblems(ALL_CHECK_GROUPS)).toEqual([]);
  });

  it('わざと part の無い同じ ID の段を足すと(ID を直し忘れたコピー)赤になる', () => {
    const copied: readonly CheckGroup[] = ALL_CHECK_GROUPS.map((group) =>
      group.group === 'data_table(T)' ? { ...group, checks: [...group.checks, { id: 'T8', title: 'T8 のコピー' }] } : group,
    );

    expect(repeatedCheckProblems(copied).map((problem) => `${problem.group}:${problem.id}:${problem.problem}`)).toEqual([
      'data_table(T):T8:missing_part',
    ]);
  });

  it('わざと別の群に同じ ID を足すと重複として拾われる(赤になる)', () => {
    const clash: readonly CheckGroup[] = [...ALL_CHECK_GROUPS, { group: 'clash', checks: [{ id: 'T8', title: '横取り' }] }];

    expect(duplicateCheckIds(clash)).toEqual([{ id: 'T8', groups: ['data_table(T)', 'clash'] }]);
  });
});

describe('表の登録漏れ(コードに検査 ID として書かれた綴りとの突き合わせ)', () => {
  const literals = scanKnownVerifierIds();

  it('走査できている', () => {
    expect(literals?.has('T8')).toBe(true);
  });

  it('表の群の接頭辞を持つ ID のリテラルは、すべて表に載っている', () => {
    expect(unregisteredLiterals(literals ?? new Set(), knownCheckIds())).toEqual([]);
  });

  it('わざと表から ID を 1 つ消すと、登録漏れとして拾われる(赤になる)', () => {
    const without = new Set(knownCheckIds());
    without.delete('T8');

    expect(unregisteredLiterals(literals ?? new Set(), without)).toEqual(['T8']);
  });
});

describe('後段が登録する検査の口', () => {
  const known = knownCheckIds();

  it('口の表(JOB_CHECK_SLOTS)の ID は、すべて表に載っている', () => {
    for (const slot of JOB_CHECK_SLOTS) expect(known.has(slot.id), slot.id).toBe(true);
  });

  it('後段を 1 つも選ばない構成でも、口は表に載ったまま、全部が未実施の口として名指される(黙って消えない)', () => {
    const missing = resolveJobChecks(NO_JOB_TARGETS).missing.map((slot) => slot.id);

    expect(missing).toEqual(JOB_CHECK_SLOTS.map((slot) => slot.id));
    for (const id of missing) expect(known.has(id), id).toBe(true);
  });

  it('実在の後段が登録した検査の ID は、すべて表に載っている(口の ID として)', () => {
    const registered = TEST_TARGETS.flatMap((target) => target.verifiers.map((verifier) => verifier.id));

    expect(registered.length).toBeGreaterThan(0);
    for (const id of registered) expect(known.has(id), id).toBe(true);
  });
});

describe('W5 は表を引いて、拡張候補の台帳の rules の ID の実在を見る', () => {
  const ledger: ExtensionLedger = {
    candidates: [
      {
        id: 'X-a',
        statement: 's',
        rules: ['T8'],
        status: 'open',
        since: '2026-10-08',
        ref: 'BACKLOG.md',
        location: { file: 'l.md', pointer: 'candidates.X-a' },
      },
    ],
    location: { file: 'l.md' },
  };

  it('表にある ID は通る', () => {
    expect(verifyExtensionLedger({ ledger, findings: [], knownIds: knownCheckIds(), acceptances: [] }).findings).toEqual([]);
  });

  it('表から消えた ID は、同じ綴りがコードのどこかに残っていても error になる', () => {
    const without = new Set(knownCheckIds());
    without.delete('T8');

    const found = verifyExtensionLedger({ ledger, findings: [], knownIds: without, acceptances: [] }).findings;

    expect(found.map((finding) => finding.message).join('\n')).toContain('T8');
    expect(found.every((finding) => finding.severity === 'error')).toBe(true);
  });
});
