/**
 * 反例の翻訳のテスト。
 *
 * 見るべきは「**変わったところだけが出る**」と「**性質の意図と実装の場所が先に出る**」
 * の 2 つ。状態の全文を並べるだけなら人は読まないし、読んでも実装のどこを直すのかが
 * 分からない。
 */

import { describe, expect, it } from 'vitest';
import { explainCounterexample, formatTrace } from '../../../lib/formal/counterexample.js';
import type { PropertyExpectation, TraceState } from '../../../lib/formal/types.js';

function state(index: number, action: string, values: Record<string, string>): TraceState {
  return { index, action, values: new Map(Object.entries(values)) };
}

const TRACE: readonly TraceState[] = [
  state(1, '初期状態', { status: '"pending"', clock: '0', pc: '<<"claim">>' }),
  state(2, 'claim("w1")', { status: '"running"', clock: '0', pc: '<<"run">>' }),
  state(3, 'tick', { status: '"running"', clock: '1', pc: '<<"run">>' }),
];

const PROPERTY: PropertyExpectation = {
  id: 'S1',
  check: 'INVARIANT',
  intent: '終端は単調',
  verdict: 'violated',
  reason: '書き戻しが locked_by を見ない',
  where: 'app/src/infrastructure/jobs/job.queue.ts:53',
  remedy: 'locked_by = 自分 を条件に足す',
};

describe('formatTrace', () => {
  it('2 状態目以降は変わった変数だけを出す', () => {
    const lines = formatTrace(TRACE);
    expect(lines[1]).toBe('2. claim("w1"): status: "pending" → "running"');
    expect(lines[2]).toBe('3. tick: clock: 0 → 1');
  });

  it('プログラムカウンタ(pc)は出さない(動作の名前が同じことを言っている)', () => {
    expect(formatTrace(TRACE).join('\n')).not.toContain('pc');
  });

  it('初期状態は初期値でない変数だけを出す', () => {
    expect(formatTrace(TRACE)[0]).toBe('1. 初期状態: status="pending"');
  });

  it('最後の 2 状態は幅で打ち切らない(違反した瞬間を切らない)', () => {
    const wide = '"' + 'x'.repeat(200) + '"';
    const long: TraceState[] = [
      state(1, '初期状態', { v: '"a"' }),
      state(2, '途中', { v: wide }),
      state(3, '直前', { v: '"b"' }),
      state(4, '違反', { v: wide }),
    ];
    const lines = formatTrace(long);
    expect(lines[1]?.endsWith('…')).toBe(true);
    expect(lines[3]?.endsWith('…')).toBe(false);
    expect(lines[3]).toContain('x'.repeat(200));
  });

  it('変化が無い状態はそう言う', () => {
    const same = [TRACE[0] as TraceState, state(2, 'noop', { status: '"pending"', clock: '0' })];
    expect(formatTrace(same)[1]).toContain('変化なし');
  });
});

describe('explainCounterexample', () => {
  it('意図・理由・実装・対処を反例の前に置く', () => {
    const lines = explainCounterexample(PROPERTY, TRACE);
    expect(lines[0]).toBe('意図: 終端は単調');
    expect(lines[2]).toContain('job.queue.ts:53');
    expect(lines[3]).toContain('対処');
  });

  it('holds と宣言した性質が破れたときは意図だけを置く(理由の宣言が無いので)', () => {
    const lines = explainCounterexample({ ...PROPERTY, verdict: 'holds' }, TRACE);
    expect(lines[0]).toBe('意図: 終端は単調');
    expect(lines[1]).toContain('反例(3 状態');
  });

  it('状態列を読めなかったことは黙らずに言う', () => {
    expect(explainCounterexample(PROPERTY, []).at(-1)).toContain('状態列を読めませんでした');
  });
});
