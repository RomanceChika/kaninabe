/**
 * **セキュリティログをホストの外へ送る口**(ASVS V16.4.3 —— 侵入されても証拠のログが残るように、別の系へ送る)。
 *
 * 規約: docs/rules/process/backend/system/standards/conventions/logging.md(§ホストの外への転送)
 * 宣言: 設定カタログの `logging.sink`(K5)
 *
 * ## 中立の口と後段の分離
 *
 * ここにあるのは**送り先に依らない口**だけである —— 送る(`LogSink`)・送れなかった理由の値域・標準出力の `Logger` に
 * 並べて送る合成(`createForwardingLogger`)。送り先ごとの綴り(URL・ヘッダ・環境変数名)は adapter パッケージが持つ
 * (`framework/adapters/log-axiom`)。製品の配線が「鍵があるときだけ」送り先を渡す。
 *
 * ## 約束(守りは、守りが落ちてもアプリを落とさない)
 *
 * 1. **送り先が無い(`sink: null`)なら、標準出力の `Logger` をそのまま返す** —— 送る処理は 1 行も走らない(オプトイン)
 * 2. **例外を外へ出さない** —— 送り先が投げても・`schedule` が投げても、呼び手の `write` は必ず返る
 * 3. **標準出力への行は先に出す** —— 外へ送れなくても、これまでどおりの 1 行は残る
 * 4. **送るのは `LogRecord` のまま** —— 欄を足さない・消さない(閉じた欄は `security-log.ts` が決める)。既定で送るのはセキュリティの事象の行だけ
 * 5. **失敗は理由の語 1 つだけを標準出力に 1 行出す** —— 鍵・トークン・本文・応答の中身・例外の文言は載せない(この部品が持たない)
 * 6. **送るのは応答の後** —— `schedule` が受ける(Next.js の `after()` など)。応答を待たせない
 */

import type { Logger, LogRecord } from './ports';

/** 送れなかった理由(値域。失敗の 1 行にはこの語だけを載せる)。 */
export const LOG_SINK_FAILURES = ['misconfigured', 'unauthorized', 'rate_limited', 'rejected', 'server_error', 'timeout', 'network'] as const;

/** 送れなかった理由の 1 語。 */
export type LogSinkFailure = (typeof LOG_SINK_FAILURES)[number];

/** 送った結果(例外ではなく値で返す)。 */
export type LogSinkResult = { readonly ok: true } | { readonly ok: false; readonly reason: LogSinkFailure };

/** ホストの外へ送る口。実装は adapter が持つ。 */
export interface LogSink {
  /**
   * 行を送る。**投げない**(失敗は `ok: false` と理由の語で返す)。
   *
   * @param records - 送る行(順序を保つ。1 件以上)
   * @returns 送れたか、送れなかった理由
   */
  send(records: readonly LogRecord[]): Promise<LogSinkResult>;
}

/**
 * 送れなかったときに標準出力へ出す 1 行。載せるのは重大度・固定の語・理由の語だけ(鍵も本文も受け取らない)。
 *
 * @param reason - 送れなかった理由
 * @returns ログの 1 行
 */
export function sinkFailureRecord(reason: LogSinkFailure): LogRecord {
  return { level: 'warn', message: `log_sink_failed reason=${reason}` };
}

/** 合成の設定。 */
export interface ForwardingLoggerOptions {
  /** 標準出力の `Logger`(これまでの出力口。失敗の 1 行もここへ出す)。 */
  readonly base: Logger;
  /** 送り先。`null` なら送らない(`base` がそのまま返る)。 */
  readonly sink: LogSink | null;
  /** 送る処理を応答の後に実行する(Next.js なら `after`)。要求の外で呼ばれて投げてもよい(その場で実行する側に落ちる)。 */
  readonly schedule: (work: () => Promise<void>) => void;
  /** 送る行の選び方(省略はセキュリティの事象の行 = `security_event` を持つ行だけ)。 */
  readonly select?: (record: LogRecord) => boolean;
}

/**
 * セキュリティの事象の行か。
 *
 * @param record - ログの 1 行
 * @returns `security_event` を持つなら true
 */
export function isSecurityEventRecord(record: LogRecord): boolean {
  return record.security_event !== undefined;
}

/**
 * 標準出力の `Logger` に、ホストの外へ送る口を並べる。
 *
 * 同じ瞬間(同じ tick)に出た行は 1 回の送信にまとめる。送り先が無ければ `base` をそのまま返す。
 *
 * @param options - 標準出力の口・送り先・応答の後に実行する口・行の選び方
 * @returns 標準出力に出し、選ばれた行を外へ送る `Logger`
 */
export function createForwardingLogger(options: ForwardingLoggerOptions): Logger {
  const { base, sink, schedule } = options;
  if (sink === null) return base;
  const select = options.select ?? isSecurityEventRecord;
  let pending: LogRecord[] = [];
  let scheduled = false;

  const flush = async (): Promise<void> => {
    // 同じ tick に出た行が揃うまで 1 回待つ。
    await Promise.resolve();
    const batch = pending;
    pending = [];
    scheduled = false;
    try {
      const result = await sendSafely(sink, batch);
      if (!result.ok) base.write(sinkFailureRecord(result.reason));
    } catch {
      // 失敗の 1 行を出す口まで投げた。送れなかったことより、アプリを止めないことを優先する(ここで握る)。
    }
  };

  return {
    write: (record) => {
      base.write(record);
      if (!select(record)) return;
      pending.push(record);
      if (scheduled) return;
      scheduled = true;
      try {
        schedule(flush);
      } catch {
        // 要求の外で呼ばれた(応答の後に実行する枠が無い)。その場で実行する —— 待たないので応答は遅れない。
        void flush();
      }
    },
  };
}

/**
 * 送り先を呼ぶ。投げた・拒否されたときは `network` の失敗に畳む(送り先は投げない約束だが、守られなくてもアプリを止めない)。
 *
 * @param sink - 送り先
 * @param records - 送る行
 * @returns 結果(投げない)
 */
async function sendSafely(sink: LogSink, records: readonly LogRecord[]): Promise<LogSinkResult> {
  try {
    return await sink.send(records);
  } catch {
    return { ok: false, reason: 'network' };
  }
}
