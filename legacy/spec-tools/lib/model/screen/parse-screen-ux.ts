/**
 * screen_spec の `ux:`(UX 原則から外れてよい場所の受け入れ)のパーサー。
 *
 * 責務は「1 画面の `ux:` 節の読み取り」に閉じる(他の節は parse-screen-parts.ts が読む)。
 * 書式の正: ux-lint.md §画面ごとの受け入れ(ux:)。ここが担うのは S0(形)だけで、
 * 対応する指摘があるか・原則の ID が実在するかは U 群(U0)が見る。
 */

import type { SpecReporter } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import type { ScreenUxAccept } from './types.js';

/** `ux:` の 1 要素に書けるキー(受け入れだけ。事実の欄は開けない)。 */
const UX_KEYS: readonly string[] = ['principle', 'subject', 'reason'];

const UX_SUGGESTION =
  'ux に "- principle / (subject) / reason" を持つ要素を並べる' +
  '(principle は原則の ID(U4 など)、subject は指摘の「反例: subject=...」の文字列(画面そのものへの指摘なら省略)、' +
  'reason は日本語で「なぜその UX でよいのか」。書式の正: ux-lint.md)';

/**
 * `ux:`(原則の受け入れ)を読む。
 *
 * @param root フロントマター全体の読み取り器
 * @param reporter 違反の記録先
 * @returns 読めた受け入れ(未記入なら空配列)
 */
export function parseUx(root: YamlReader, reporter: SpecReporter): readonly ScreenUxAccept[] {
  const items = root.optionalList('ux', UX_SUGGESTION);
  const accepts: ScreenUxAccept[] = [];
  eachRecord(items, 'ux', reporter, UX_SUGGESTION, (reader, index) => {
    const at = `ux[${index}]`;
    reader.rejectUnknownKeys(UX_KEYS, at, UX_SUGGESTION);
    const principle = reader.requiredString('principle', UX_SUGGESTION);
    const subject = reader.optionalString('subject', UX_SUGGESTION);
    const reason = reader.requiredString('reason', UX_SUGGESTION);
    if (principle === null || reason === null) return;
    if (reason.trim() === '') {
      reporter.error(
        `${at}.reason`,
        `${at}.reason が空です`,
        `${principle} の指摘を受け入れる理由(なぜその UX でよいのか)を reason に日本語で書く`,
      );
      return;
    }
    accepts.push({ principle, subject: subject ?? '', reason, location: reporter.location(at) });
  });
  return accepts;
}
