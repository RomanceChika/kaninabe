/**
 * auth_spec の `sessions`(セッションの寿命)の読み取り。
 *
 * parse-auth.ts が呼ぶ下位の部品。責務は 1 ファイルの中で閉じる形に限る —— マッピングであること・書けるキー・
 * 3 欄と `concurrent`(同時セッション。parse-auth-concurrent.ts)が揃うこと・期間が読めて 0 より大きいこと・無操作の時間切れが絶対の寿命より短いこと・理由が空でないこと。
 * 宣言とプラットフォームの設定の突合(設定の値が宣言と同じか)は、プラットフォームの後段が登録する検査 H5 が見る。
 */

import type { SpecReporter } from '../parse-common.js';
import { asRecord } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type { AuthSessionsDecl } from './sessions.js';
import { declaredDurationSeconds } from './sessions.js';
import { parseConcurrent } from './parse-auth-concurrent.js';

/** `sessions` に書けるキー。 */
const SESSIONS_KEYS: readonly string[] = ['inactivity', 'absolute', 'reason', 'concurrent'];

/** `sessions` の書き方の案内。 */
const SESSIONS_SUGGESTION =
  'sessions は "inactivity / absolute / reason / concurrent" のマッピングで書く(無操作の時間切れ・絶対の寿命・その値にした理由・同時に持てるセッションの数。' +
  '期間は 30m / 8h / 1d12h のように日・時間・分で書く)。書かないと、セッションが時間で終わらない既定のまま出荷される';

/** 期間 1 つを読む(読めない・0 なら違反にして null)。 */
function readDuration(item: YamlReader, key: 'inactivity' | 'absolute', what: string, reporter: SpecReporter): { readonly text: string; readonly seconds: number } | null {
  const text = item.requiredString(key, `${key} に${what}を書く(例: 8h)`);
  if (text === null) return null;
  const seconds = declaredDurationSeconds(text);
  if (seconds === null) {
    reporter.error(item.pointer(key), `sessions.${key} ${text} は期間として読めません`, `${key} は 30m / 8h / 1d12h のように、日(d)・時間(h)・分(m)を大きい順に書く(0 は書けない)`, { [key]: text });
    return null;
  }
  return { text, seconds };
}

/**
 * `sessions`(必須)を読む。読めなければ違反を記録して undefined(宣言を落としたものとして数える)。
 *
 * **無操作の時間切れは絶対の寿命より短くなければならない**。同じか長いと、無操作の時間切れが一度も効かない宣言になる
 * (書いたのに効いていない宣言を通さない)。
 *
 * @param root 認証フロー仕様のルート
 * @param reporter 違反の記録先
 */
export function parseSessions(root: YamlReader, reporter: SpecReporter): AuthSessionsDecl | undefined {
  if (!root.has('sessions')) {
    reporter.error(root.pointer('sessions'), 'sessions(セッションの寿命)がありません', SESSIONS_SUGGESTION);
    reporter.dropRows();
    return undefined;
  }
  const record = asRecord(root.raw('sessions'));
  if (record === null) {
    reporter.error(root.pointer('sessions'), 'sessions はマッピングで書きます', SESSIONS_SUGGESTION);
    reporter.dropRows();
    return undefined;
  }
  const item = new YamlReader(record, root.pointer('sessions'), reporter);
  item.rejectUnknownKeys(SESSIONS_KEYS, 'sessions', `書けるのは ${SESSIONS_KEYS.join(' / ')} だけ`);
  const inactivity = readDuration(item, 'inactivity', '無操作の時間切れ(最後に使ったときから、再認証を求めるまでの時間)', reporter);
  const absolute = readDuration(item, 'absolute', '絶対の寿命(サインインしたときから、使い続けていても再認証を求めるまでの時間)', reporter);
  const reason = item.requiredString('reason', 'reason にこの値にした理由を書く');
  const concurrent = parseConcurrent(item, reporter);
  const blank = reason !== null && reason.trim() === '';
  if (blank) {
    reporter.error(item.pointer('reason'), 'sessions.reason が空です', 'reason にこの値にした理由を書く(理由の無い寿命は、なぜその長さで足りるのかを誰も確かめられない)');
  }
  const ordered = inactivity === null || absolute === null || inactivity.seconds < absolute.seconds;
  if (!ordered) {
    reporter.error(
      item.pointer('inactivity'),
      `sessions.inactivity ${inactivity.text} が absolute ${absolute.text} より短くありません。無操作の時間切れが一度も効かない宣言です`,
      'inactivity を absolute より短くする(無操作の時間切れを置かないという宣言の形は無い。どちらも要る)',
      { inactivity: inactivity.text, absolute: absolute.text },
    );
  }
  if (inactivity === null || absolute === null || reason === null || blank || !ordered || concurrent === null) {
    reporter.dropRows();
    return undefined;
  }
  return {
    inactivity: inactivity.text,
    inactivitySeconds: inactivity.seconds,
    absolute: absolute.text,
    absoluteSeconds: absolute.seconds,
    reason,
    concurrent,
    location: reporter.location('sessions'),
  };
}
