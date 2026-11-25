/**
 * auth_spec の `sessions.concurrent`(同時に持てるセッションの数と、上限に達したときの挙動)の読み取り。
 *
 * parse-auth-sessions.ts が呼ぶ下位の部品。責務は 1 ファイルの中で閉じる形に限る —— 必須であること・マッピングであること・
 * 上限なし(`unbounded: 理由`)と上限あり(`max` / `on_limit` / `reason`)が混ざらないこと・`max` が 1 以上の整数であること・
 * `on_limit` が宣言できる語であること・理由が空でないこと。設定との突合(単一セッションの設定があるか)は H5 が見る。
 */

import type { SpecReporter } from '../parse-common.js';
import { asRecord } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type { ConcurrentSessionsDecl } from './sessions.js';
import { CONCURRENT_ON_LIMIT } from './sessions.js';

/** 上限ありで書けるキー。 */
const LIMITED_KEYS: readonly string[] = ['max', 'on_limit', 'reason'];

/** `concurrent` の書き方の案内。 */
const CONCURRENT_SUGGESTION =
  'concurrent を書く。上限を置かないなら concurrent: { unbounded: 置かない理由 }、置くなら "max(1 以上の整数)/ on_limit(' +
  `${CONCURRENT_ON_LIMIT.join(' か ')})/ reason" を書く。書かないと、1 人が同時にいくつセッションを持てるのかを誰も言えない`;

/** 理由が空でないことを見る(空なら違反にして false)。 */
function nonBlank(reason: string, pointer: string, what: string, reporter: SpecReporter): boolean {
  if (reason.trim() !== '') return true;
  reporter.error(pointer, `${what} が空です`, `${what} に理由を書く(理由の無い宣言は、なぜその数で足りるのかを誰も確かめられない)`);
  return false;
}

/** 上限あり(`max` / `on_limit` / `reason`)を読む。 */
function readLimited(item: YamlReader, reporter: SpecReporter): ConcurrentSessionsDecl | null {
  item.rejectUnknownKeys(LIMITED_KEYS, 'sessions.concurrent', `書けるのは ${LIMITED_KEYS.join(' / ')}(上限を置かないなら unbounded だけ)`);
  const max = item.optionalNumber('max', 'max に 1 人が同時に持てるセッションの数(1 以上の整数)を書く');
  if (max === undefined) {
    if (!item.has('max')) reporter.error(item.pointer('max'), 'sessions.concurrent.max がありません', CONCURRENT_SUGGESTION);
    return null;
  }
  if (!Number.isInteger(max) || max < 1) {
    reporter.error(item.pointer('max'), `sessions.concurrent.max ${max} は 1 以上の整数ではありません`, 'max は 1 以上の整数で書く(上限を置かないなら unbounded)', { max: String(max) });
    return null;
  }
  const onLimit = item.requiredString('on_limit', `on_limit に上限に達したときの挙動(${CONCURRENT_ON_LIMIT.join(' か ')})を書く`);
  if (onLimit === null) return null;
  const known = CONCURRENT_ON_LIMIT.find((word) => word === onLimit);
  if (known === undefined) {
    reporter.error(item.pointer('on_limit'), `sessions.concurrent.on_limit ${onLimit} は宣言できる語ではありません`, `on_limit は ${CONCURRENT_ON_LIMIT.join(' / ')} のいずれかを書く(ends_oldest = いちばん古いセッションを終える・refuses_new = 新しいサインインを断る)`, { on_limit: onLimit });
    return null;
  }
  const reason = item.requiredString('reason', 'reason にこの数にした理由を書く');
  if (reason === null || !nonBlank(reason, item.pointer('reason'), 'sessions.concurrent.reason', reporter)) return null;
  return { kind: 'limited', max, onLimit: known, reason };
}

/**
 * `sessions.concurrent`(必須)を読む。読めなければ違反を記録して null(`sessions` の宣言を落としたものとして数える)。
 *
 * @param sessions `sessions` のマッピングの読み手
 * @param reporter 違反の記録先
 */
export function parseConcurrent(sessions: YamlReader, reporter: SpecReporter): ConcurrentSessionsDecl | null {
  if (!sessions.has('concurrent')) {
    reporter.error(sessions.pointer('concurrent'), 'sessions.concurrent(同時に持てるセッションの数)がありません', CONCURRENT_SUGGESTION);
    return null;
  }
  const record = asRecord(sessions.raw('concurrent'));
  if (record === null) {
    reporter.error(sessions.pointer('concurrent'), 'sessions.concurrent はマッピングで書きます', CONCURRENT_SUGGESTION);
    return null;
  }
  const item = new YamlReader(record, sessions.pointer('concurrent'), reporter);
  if (item.has('unbounded')) {
    item.rejectUnknownKeys(['unbounded'], 'sessions.concurrent(上限を置かない宣言)', 'unbounded と上限の欄(max / on_limit / reason)は同時に書けない。上限を置かないなら unbounded だけを書く');
    const reason = item.requiredString('unbounded', 'unbounded に上限を置かない理由を書く');
    if (reason === null || !nonBlank(reason, item.pointer('unbounded'), 'sessions.concurrent.unbounded', reporter)) return null;
    return { kind: 'unbounded', reason };
  }
  return readLimited(item, reporter);
}
