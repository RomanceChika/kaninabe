/**
 * 題材の通し実行が走り手に返す件数(db-report.ts の stepCounts / writeStepCounts。fix27 差分点検 5 回目 A5-1)。配線の段・生成テスト・構造の突合の
 * 3 つの内訳を別々に数え、届かなかった・読めない内訳は null(0 として足さない = 走り手が赤にする)。実 DB の段を持たない題材(noDb)だけ、
 * 生成テストと突合を 0 と数える。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STEP_COUNT_PARTS, stepCounts, writeStepCounts, type SampleOutcome } from '../../../../../lib/targets/supabase/samples/db-report.js';

const run = (passed: number | null): { ok: boolean; elapsedMs: number; output: string; passed: number | null } => ({ ok: true, elapsedMs: 0, output: '', passed });
const wiring = (...counts: number[]): unknown => ({ run: run(0), kinds: new Map(counts.map((passed, index) => [`k${String(index)}`, { passed }])) });
const full = { name: 'a', noDb: null, tests: run(3), parity: { fired: [], run: run(2) }, wiring: wiring(4, 1) } as unknown as SampleOutcome;
const noDb = { name: 'd', noDb: '表が無い', tests: null, parity: null, wiring: wiring(5) } as unknown as SampleOutcome;

describe('stepCounts', () => {
  it('3 つの内訳を題材をまたいで別々に足す・実 DB の段を持たない題材は生成テストと突合を 0 と数える', () => {
    expect(stepCounts([full, noDb])).toEqual({ wiring: 10, generated: 3, parity: 2 });
  });

  it.each([
    ['生成テストの件数を読めない', { tests: run(null) }, 'generated'],
    ['生成テストに届かなかった(構築が落ちた)', { tests: null, parity: null }, 'generated'],
    ['突合の件数を読めない', { parity: { fired: [], run: run(null) } }, 'parity'],
    ['突合に届かなかった', { parity: null }, 'parity'],
    ['配線の段に届かなかった', { wiring: null }, 'wiring'],
  ] as const)('負例 A5-1: %s内訳は null(0 として足さない)', (_name, change, part) => {
    expect(stepCounts([{ ...full, ...change } as unknown as SampleOutcome, noDb])[part]).toBeNull();
  });
});

describe('writeStepCounts', () => {
  it('内訳ごとに 1 行(読めない内訳は null と書く)・走り手の外では書かない', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'step-counts-'));
    try {
      const file = path.join(dir, 'count');
      writeStepCounts([{ ...full, tests: run(null) } as unknown as SampleOutcome], { ST_STEP_COUNT: file });
      expect(readFileSync(file, 'utf-8')).toBe('wiring 5\ngenerated null\nparity 2\n');
      writeStepCounts([full], {});
      expect(readFileSync(file, 'utf-8').split('\n').filter((line) => line !== '')).toHaveLength(STEP_COUNT_PARTS.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
