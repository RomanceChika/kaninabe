/**
 * 構造の突合を回す組の閉じた表(`sample-coverage.ts`。点検 26 回目 A26-1)のユニットテスト。
 *
 * - 前に回っていた対が外れたら、題材 × 突合を名指して分類の理由を添える(合計の本数では見ない: 1 本外れて 1 本増えても赤)
 * - 表に無い対が回り始めたら名指す(閉じた表を黙って広げない)
 * - 表に無い題材は名指す
 * - 表の題材は、data_table を持つ fixture の題材と一致する(data_table を持たない dual_actors は通し実行の対象外)
 * - 実例: 点検 26 回目の前の実物(data-table-parity が外れ、isolation-gate-parity が足されて本数は同じ)が赤になる
 */

import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { firedPairProblems as firedPairProblemsOf } from '../../../../../lib/targets/supabase/samples/sample-coverage-check.js';
import { PARITY_FIRED_PAIRS, PARITY_SKIPPED_PAIRS } from '../../../../samples/sample-coverage.js';

/** 既定の表(題材の表)で照らす(省略の引数は題材の表)。 */
function firedPairProblems(sample: string, fired: readonly string[], reasons: ReadonlyMap<string, string>, table: Readonly<Record<string, readonly string[]>> = PARITY_FIRED_PAIRS, skipped: Readonly<Record<string, Readonly<Record<string, string>>>> = PARITY_SKIPPED_PAIRS): readonly string[] {
  return firedPairProblemsOf(sample, fired, reasons, table, skipped);
}

const TABLE = { s: ['a-parity.test.ts', 'b-parity.test.ts'] } as const;

describe('firedPairProblems', () => {
  it('表どおりなら食い違い無し', () => {
    expect(firedPairProblems('s', ['b-parity.test.ts', 'a-parity.test.ts'], new Map(), TABLE)).toEqual([]);
  });

  it('外れた対を名指し、分類の理由を添える', () => {
    const problems = firedPairProblems('s', ['a-parity.test.ts'], new Map([['b-parity.test.ts', 'この題材が宣言していない名前を本文が名指している(x)']]), TABLE);
    expect(problems).toEqual(['[外れた対] s × b-parity.test.ts —— 前に回っていた突合が回らなくなりました(この題材が宣言していない名前を本文が名指している(x))']);
  });

  it('1 本外れて 1 本増えた(合計は同じ)ときも両方を名指す', () => {
    const problems = firedPairProblems('s', ['a-parity.test.ts', 'c-parity.test.ts'], new Map(), TABLE);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('[外れた対] s × b-parity.test.ts');
    expect(problems[1]).toContain('[表に無い対] s × c-parity.test.ts');
  });

  it('回らない対は理由の表と照らす: 理由が無ければ赤・理由のある対が回り始めたら赤(点検 fix26 D26-3)', () => {
    const reasons = new Map([['c-parity.test.ts', '本文が名指す(x)']]);
    expect(firedPairProblems('s', [...TABLE.s], reasons, TABLE, { s: { 'c-parity.test.ts': '照らす相手が無い' } })).toEqual([]);
    expect(firedPairProblems('s', [...TABLE.s], reasons, TABLE, { s: {} })).toEqual([
      '[理由の無い回らない対] s × c-parity.test.ts —— 回らない理由が回らない対の表(sample-coverage.ts の PARITY_SKIPPED_PAIRS)にありません(分類: 本文が名指す(x))',
    ]);
    expect(firedPairProblems('s', [...TABLE.s], reasons, TABLE, { s: { 'c-parity.test.ts': '  ' } })[0]).toMatch(/^\[理由の無い回らない対\]/);
    expect(firedPairProblems('s', [...TABLE.s], new Map(), TABLE, { s: { 'a-parity.test.ts': '理由' } })).toEqual([
      '[回り始めた対] s × a-parity.test.ts —— 回らない対の表に理由があるのに回りました(表から消し、回る組に足す)',
    ]);
  });

  it('表に無い題材を名指す', () => {
    expect(firedPairProblems('t', ['a-parity.test.ts'], new Map(), TABLE)[0]).toContain('[表に無い題材] t');
  });

  it('点検 26 回目の前の実物(data-table-parity が外れ、isolation-gate-parity が足されて 9 本のまま)は全題材で赤', () => {
    const before = [
      'api-parity.test.ts', 'ddl-parity.test.ts', 'erased-link-parity.test.ts', 'function-acl-parity.test.ts', 'isolation-gate-parity.test.ts',
      'policy-parity.test.ts', 'rpc-parity.test.ts', 'rpc-signatures-parity.test.ts', 'send-limit-parity.test.ts',
    ];
    for (const sample of Object.keys(PARITY_FIRED_PAIRS)) {
      expect(firedPairProblems(sample, before, new Map()).some((problem) => problem.startsWith(`[外れた対] ${sample} × data-table-parity.test.ts`))).toBe(true);
    }
  });
});

describe('PARITY_SKIPPED_PAIRS', () => {
  it('題材は回る組の表と同じで、回る組と回らない対は重ならず、理由は空でない', () => {
    expect(Object.keys(PARITY_SKIPPED_PAIRS).sort()).toEqual(Object.keys(PARITY_FIRED_PAIRS).sort());
    for (const [sample, skipped] of Object.entries(PARITY_SKIPPED_PAIRS)) {
      const fired = new Set(PARITY_FIRED_PAIRS[sample]);
      expect(Object.keys(skipped).filter((file) => fired.has(file)), sample).toEqual([]);
      expect(Object.entries(skipped).filter(([, reason]) => reason.trim() === ''), sample).toEqual([]);
      expect(Object.keys(skipped).every((file) => file.endsWith('-parity.test.ts')), sample).toBe(true);
    }
  });
});

describe('PARITY_FIRED_PAIRS', () => {
  it('題材は data_table を持つ fixture の題材と一致し、突合は名前順・重複なし', () => {
    const root = path.resolve(import.meta.dirname, '../../../../fixtures/samples');
    const withTables = readdirSync(root)
      .filter((name) => existsSync(path.join(root, name, 'docs/specs/backend/data/tables')))
      .sort();
    expect(Object.keys(PARITY_FIRED_PAIRS).sort()).toEqual(withTables);
    for (const files of Object.values(PARITY_FIRED_PAIRS)) {
      expect([...files].sort()).toEqual(files);
      expect(new Set(files).size).toBe(files.length);
      expect(files.every((file) => file.endsWith('-parity.test.ts'))).toBe(true);
    }
  });
});
