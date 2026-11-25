/**
 * TLC の出力の読み取りのテスト。
 *
 * 本物の出力をそのまま貼って読ませる —— 手で作った要約を読めても、TLC の実際の
 * 字面(折り返された値・動作の後ろに付く行番号)が読めなければ意味が無い。
 */

import { describe, expect, it } from 'vitest';
import { parseTlcOutput, parseTrace } from '../../../lib/formal/tlc-output.js';

const VIOLATION = `Starting... (2026-09-21 01:00:37)
Computing initial states...
Finished computing initial states: 1 distinct state generated at 2026-09-21 01:00:38.
Error: Invariant S1 is violated.
Error: The behavior up to this point is:
State 1: <Initial predicate>
/\\ status = [j1 |-> "pending"]
/\\ clock = 0

State 2: <claim("w1") line 183, col 16 to line 192, col 81 of module Outbox>
/\\ status = [j1 |-> "running"]
/\\ clock = 0

478 states generated, 316 distinct states found, 136 states left on queue.
The depth of the complete state graph search is 8.
Finished in 00s at (2026-09-21 01:00:38)`.split('\n');

const SUCCESS = `Starting... (2026-09-21 01:00:47)
Model checking completed. No error has been found.
3113 states generated, 1383 distinct states found, 0 states left on queue.
The depth of the complete state graph search is 17.
Finished in 00s at (2026-09-21 01:00:47)`.split('\n');

describe('parseTlcOutput', () => {
  it('通った実行を件数と深さつきで読む', () => {
    const result = parseTlcOutput(SUCCESS, 0);
    expect(result.kind).toBe('holds');
    expect(result.kind === 'holds' && result.distinct).toBe(1383);
    expect(result.kind === 'holds' && result.depth).toBe(17);
  });

  it('不変条件の違反を反例つきで読む', () => {
    const result = parseTlcOutput(VIOLATION, 12);
    expect(result.kind).toBe('violated');
    expect(result.kind === 'violated' && result.trace).toHaveLength(2);
    expect(result.kind === 'violated' && result.trace[1]?.action).toBe('claim("w1")');
  });

  it('時相論理の違反も違反として読む', () => {
    const lines = ['Error: Temporal properties were violated.', 'State 1: <Initial predicate>', '/\\ x = 0'];
    expect(parseTlcOutput(lines, 13).kind).toBe('violated');
  });

  it('道具が答えられなかったら error にする(「違反なし」に丸めない)', () => {
    const result = parseTlcOutput(['Error: Parsing or semantic analysis failed.'], 150);
    expect(result.kind).toBe('error');
    expect(result.kind === 'error' && result.reason).toContain('Parsing');
  });

  it('終了コードが 0 でも「検査を終えた」と言わなければ error にする', () => {
    expect(parseTlcOutput(['Starting...'], 0).kind).toBe('error');
  });
});

describe('parseTrace', () => {
  it('初期状態の動作を日本語にする', () => {
    expect(parseTrace(VIOLATION)[0]?.action).toBe('初期状態');
  });

  it('折り返された値を 1 行に畳む', () => {
    const lines = [
      'Error: Invariant X is violated.',
      'State 1: <Initial predicate>',
      '/\\ pc = [ s1 |-> "commitTxn",',
      '          s2 |-> "pick" ]',
      '/\\ x = 1',
    ];
    const trace = parseTrace(lines);
    expect(trace[0]?.values.get('pc')).toBe('[ s1 |-> "commitTxn", s2 |-> "pick" ]');
    expect(trace[0]?.values.get('x')).toBe('1');
  });

  it('無限に繰り返す反例の「戻り先」を 1 状態として読む', () => {
    const lines = ['State 1: <Initial predicate>', '/\\ x = 0', '', 'Back to state 1: <a line 1, col 1 of module M>'];
    const trace = parseTrace(lines);
    expect(trace).toHaveLength(2);
    expect(trace[1]?.action).toContain('戻る');
  });
});
