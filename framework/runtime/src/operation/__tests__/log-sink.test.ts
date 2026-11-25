/**
 * ホストの外へ送る口(`log-sink.ts`)のユニットテスト。
 *
 * 確かめるのは 6 つ —— ①送り先が無ければ標準出力の口がそのまま返る(送る処理が 1 行も走らない = オプトイン)
 * ②標準出力の行が先に出る ③選ばれた行(既定はセキュリティの事象)だけが、同じ tick の分を 1 回にまとめて、欄を変えずに送られる
 * ④送れなかった理由は閉じた語 1 つの 1 行になり、鍵・本文を載せない ⑤送り先・予約・失敗の行が投げても `write` は必ず返る
 * ⑥要求の外(予約が投げる)ではその場で走る。
 */

import { describe, expect, it } from 'vitest';
import { LOG_SINK_FAILURES, createForwardingLogger, isSecurityEventRecord, sinkFailureRecord } from '../log-sink';
import type { LogSink, LogSinkResult } from '../log-sink';
import type { Logger, LogRecord } from '../ports';

const REFUSAL: LogRecord = { level: 'warn', security_event: 'authz_refused', refusal_code: 'role_forbidden', request_id: 'req-1' };
const JOB: LogRecord = { level: 'info', job_id: 'j1', job_type: 'remind', duration_ms: 3 };

/** 出した行を貯める口。 */
function fakeLogger(): Logger & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { records, write: (record) => void records.push(record) };
}

/** 送った行の束を貯める送り先(結果は差し替えられる)。 */
function fakeSink(result: LogSinkResult = { ok: true }): LogSink & { readonly batches: (readonly LogRecord[])[] } {
  const batches: (readonly LogRecord[])[] = [];
  return {
    batches,
    send: (records) => {
      batches.push(records);
      return Promise.resolve(result);
    },
  };
}

/** 予約された仕事を貯める(応答の後に実行する枠の代わり)。 */
function fakeSchedule(): { readonly schedule: (work: () => Promise<void>) => void; readonly drain: () => Promise<void> } {
  const jobs: (() => Promise<void>)[] = [];
  return {
    schedule: (work) => void jobs.push(work),
    drain: async () => {
      for (const job of jobs.splice(0)) await job();
    },
  };
}

describe('createForwardingLogger', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-LOGSINK-001
  it('送り先が無ければ標準出力の口がそのまま返る(送る処理は走らない)', () => {
    const base = fakeLogger();
    const scheduler = fakeSchedule();
    const logger = createForwardingLogger({ base, sink: null, schedule: scheduler.schedule });
    expect(logger).toBe(base);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-LOGSINK-003
  it('標準出力の行は先に出て、セキュリティの事象の行だけが欄を変えずに送られる', async () => {
    const base = fakeLogger();
    const sink = fakeSink();
    const scheduler = fakeSchedule();
    const logger = createForwardingLogger({ base, sink, schedule: scheduler.schedule });

    logger.write(REFUSAL);
    logger.write(JOB);
    expect(base.records).toEqual([REFUSAL, JOB]);
    expect(sink.batches).toEqual([]); // 応答の後まで送らない

    await scheduler.drain();
    expect(sink.batches).toEqual([[REFUSAL]]);
    expect(base.records).toEqual([REFUSAL, JOB]); // 成功では何も足さない
  });

  it('同じ tick に出た行は 1 回の送信にまとめ、次の tick の行は別の送信になる', async () => {
    const base = fakeLogger();
    const sink = fakeSink();
    const scheduler = fakeSchedule();
    const logger = createForwardingLogger({ base, sink, schedule: scheduler.schedule });
    const second: LogRecord = { ...REFUSAL, request_id: 'req-2' };

    logger.write(REFUSAL);
    logger.write(second);
    await scheduler.drain();
    logger.write(REFUSAL);
    await scheduler.drain();

    expect(sink.batches).toEqual([[REFUSAL, second], [REFUSAL]]);
  });

  it('行の選び方を渡せる(全部送る)', async () => {
    const sink = fakeSink();
    const scheduler = fakeSchedule();
    const logger = createForwardingLogger({ base: fakeLogger(), sink, schedule: scheduler.schedule, select: () => true });
    logger.write(JOB);
    await scheduler.drain();
    expect(sink.batches).toEqual([[JOB]]);
  });

  for (const reason of LOG_SINK_FAILURES) {
    it(`送れなかった(${reason})ときは、理由の語だけの 1 行を標準出力へ出し、行の中身は載せない`, async () => {
      const base = fakeLogger();
      const scheduler = fakeSchedule();
      const logger = createForwardingLogger({ base, sink: fakeSink({ ok: false, reason }), schedule: scheduler.schedule });
      logger.write({ ...REFUSAL, request_id: 'SECRET-REQUEST' });
      await scheduler.drain();
      expect(base.records).toHaveLength(2);
      expect(base.records[1]).toEqual({ level: 'warn', message: `log_sink_failed reason=${reason}` });
      expect(JSON.stringify(base.records[1])).not.toContain('SECRET-REQUEST');
    });
  }

  // @spec framework-guarantee-catalog @tc TC-FW-LOGSINK-002
  it('送り先が投げても write は返り、network の失敗の 1 行になる(投げた文言は載らない)', async () => {
    const base = fakeLogger();
    const scheduler = fakeSchedule();
    const sink: LogSink = { send: () => Promise.reject(new Error('Bearer xaat-SECRET')) };
    const logger = createForwardingLogger({ base, sink, schedule: scheduler.schedule });
    expect(() => logger.write(REFUSAL)).not.toThrow();
    await scheduler.drain();
    expect(base.records[1]).toEqual({ level: 'warn', message: 'log_sink_failed reason=network' });
    expect(JSON.stringify(base.records)).not.toContain('xaat-SECRET');
  });

  it('送り先が同期的に投げても同じ', async () => {
    const base = fakeLogger();
    const scheduler = fakeSchedule();
    const sink: LogSink = {
      send: () => {
        throw new Error('boom');
      },
    };
    createForwardingLogger({ base, sink, schedule: scheduler.schedule }).write(REFUSAL);
    await scheduler.drain();
    expect(base.records[1]).toEqual({ level: 'warn', message: 'log_sink_failed reason=network' });
  });

  it('失敗の 1 行を出す口まで投げても、仕事は例外を外へ出さない', async () => {
    let calls = 0;
    const base: Logger = {
      write: () => {
        calls += 1;
        if (calls > 1) throw new Error('stdout closed');
      },
    };
    const scheduler = fakeSchedule();
    const logger = createForwardingLogger({ base, sink: fakeSink({ ok: false, reason: 'timeout' }), schedule: scheduler.schedule });
    logger.write(REFUSAL);
    await expect(scheduler.drain()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('応答の後に実行する枠が無い(予約が投げる)ときは、その場で実行され、write は返る', async () => {
    const base = fakeLogger();
    const sink = fakeSink();
    const logger = createForwardingLogger({
      base,
      sink,
      schedule: () => {
        throw new Error('outside a request scope');
      },
    });
    expect(() => logger.write(REFUSAL)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sink.batches).toEqual([[REFUSAL]]);
  });
});

describe('isSecurityEventRecord / sinkFailureRecord', () => {
  it('security_event を持つ行だけが送る対象', () => {
    expect(isSecurityEventRecord(REFUSAL)).toBe(true);
    expect(isSecurityEventRecord(JOB)).toBe(false);
  });

  it('失敗の行は重大度 warn と固定の語だけ(閉じた欄の中)', () => {
    expect(sinkFailureRecord('rate_limited')).toEqual({ level: 'warn', message: 'log_sink_failed reason=rate_limited' });
  });
});
