/**
 * K5 の**検査から見えないこと**(本番のログの転送先)を名指す実行ログの行。
 *
 * 語は入力の状態を報告する検査の未実施と同じ(`ID: 未実施 — …`。`verify/skip-notes.ts` が拾い、範囲サマリの件数に入る)。
 * 書き方の置き場は検査の層(`lib/config`)にある —— 検査が報告の層(`lib/verify`)を読む向きにしない。
 */

import type { ConfigLoggingDecl } from '../model/config/types.js';

/** 未実施の語(`verify/check-run-report.ts` の `CHECK_RUN_WORDS.skipped` と同じ綴り。skip-notes が行頭の形で拾う)。 */
const SKIPPED_WORD = '未実施';

/**
 * ログの転送先(K5)が**検査から見えないこと**を、未実施の行にする(`K5: 未実施 — …`)。
 *
 * 転送先の設定(鍵の環境変数・ログドレインなど)はプラットフォームの管理画面・CLI にあり、宣言との突合ができない。H5 の本番の設定と同じ扱いで、
 * **本番の置き場を宣言して転送先を持つ製品は、検査の結果によらず毎回**名指す。言わないのは次の場合 —— 宣言が無い(K5 の違反が言う)・
 * 本番を宣言していない(試験環境・趣味の用途。何も言わない)・転送先が無いか外している(K5 の警告が言う)。
 *
 * @param logging ログの目録の宣言(無ければ undefined)
 * @returns 行(言わないときは空)
 */
export function describeLogSinkRun(logging: ConfigLoggingDecl | undefined): string[] {
  if (logging === undefined) return [];
  const { sink } = logging;
  const destination = sink.destination;
  const alert = logging.deadLetterAlert;
  const alertLine =
    alert?.destination.kind === 'forward' && alert.requiredIn.length > 0
      ? [`K5: ${SKIPPED_WORD} — 本番の死んだジョブの知らせ先は未検証です(${alert.destination.label}・必須の置き場: ${alert.requiredIn.join(' / ')})。設定する場所: ${alert.destination.configuredIn}。未設定ならエラーのログだけになります。`]
      : [];
  if (destination.kind !== 'forward' || sink.requiredIn.length === 0) return alertLine;
  const how =
    destination.mode === 'app_direct' && destination.keyEnv !== null
      ? `アプリから直接送る・鍵 ${destination.keyEnv} が本番に設定されたときだけ送る。未設定なら黙って標準出力だけになる`
      : '配置先のログドレインに任せる';
  return [
    `K5: ${SKIPPED_WORD} — 本番のログの転送先は未検証です(${destination.label}・${how}・必須の置き場: ${sink.requiredIn.join(' / ')}・保管 ${logging.retention.days} 日)。` +
      `設定する場所: ${destination.configuredIn}。本番で転送先が有効になっていて、保管日数と読める人が宣言と同じであることを確かめてください。`,
    ...alertLine,
  ];
}
