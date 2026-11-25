/**
 * cron 式の人の言い方(`semantics/cron-words.ts`)のテスト。読める 3 つの形だけを言い換え、ほかは null(推測しない)。
 * 時刻は UTC から日本時間(+9 時間)に直す。
 */

import { describe, expect, it } from 'vitest';
import { cronWords } from '../../../lib/semantics/cron-words.js';

describe('cronWords', () => {
  it('分の間隔は「n 分ごと」', () => {
    expect(cronWords('*/10 * * * *')).toBe('10 分ごと');
    expect(cronWords('*/1 * * * *')).toBe('1 分ごと');
  });

  it('分だけの指定は「毎時 m 分」', () => {
    expect(cronWords('15 * * * *')).toBe('毎時 15 分');
  });

  it('分と時の指定は、UTC から日本時間に直した「毎日 HH:MM」。日をまたぐ時刻も毎日のまま', () => {
    expect(cronWords('0 19 * * *')).toBe('毎日 04:00(日本時間)');
    expect(cronWords('0 8 * * *')).toBe('毎日 17:00(日本時間)');
    expect(cronWords('30 23 * * *')).toBe('毎日 08:30(日本時間)');
    expect(cronWords('0 0 * * *')).toBe('毎日 09:00(日本時間)');
  });

  it('読めない形(曜日・日・月の指定、範囲、リスト、欄の数が違う、範囲外の値)は null', () => {
    for (const expression of ['0 19 * * 1', '0 19 1 * *', '0 19 * 5 *', '0,30 * * * *', '0-5 * * * *', '* * * * *', '*/0 * * * *', '*/60 * * * *', '60 * * * *', '0 24 * * *', '0 19 * *', '', 'abc']) {
      expect(cronWords(expression), expression).toBeNull();
    }
  });
});
