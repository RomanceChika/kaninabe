/**
 * data_table の `triggers[].derives`(同じ行の日時列 ± 定数の幅・親の下の末尾の番号で列を決める宣言)のパーサー。
 *
 * 読むのは**形**だけである —— 幅の形は `from` / `offset` / `mode` の 3 つ、末尾の番号の形は `append_within` / `mode` の 2 つが
 * 揃い、どれも文字列であること(2 つの形のキーは混ぜられない)。`from` が実在の日時列か・`offset` が閉じた語か・`mode` が値域に
 * あるか・`append_within` が親を指す列かは T15 が見る(字面のまま持たせるので、書いた人の綴りを指して直せる)。
 */

import { identifierField, offsetField } from '../sql-fields.js';
import type { SpecReporter } from '../parse-common.js';
import { asRecord } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type { DataDerivation } from './types.js';

/** `derives` の 1 列が持つキー(幅の形。これ以外は書けない)。 */
const DERIVATION_KEYS: readonly string[] = ['from', 'offset', 'mode'];

/** 末尾の番号の形の親を指すキー。 */
const APPEND_KEY = 'append_within';

/** `derives` の 1 列が持つキー(末尾の番号の形)。 */
const APPEND_KEYS: readonly string[] = [APPEND_KEY, 'mode'];

/** `derives` の書き方。 */
const DERIVES_SUGGESTION =
  'derives は "{列}: { from: {自表の日時列}, offset: "{±n} {minute|hour|day}", mode: initial|follow }" の' +
  'マッピングで書く(例: derives: { remind_at: { from: starts_at, offset: "-1 day", mode: initial } })。' +
  '親の下の末尾の番号なら "{列}: { append_within: {親を指す列}, mode: initial|insert_at }"(insert_at = 入れてきた値を位置と読んで差し込む)';

/**
 * トリガ 1 本の `derives` を読む。
 *
 * @param trigger そのトリガのマッピングの読み取り器
 * @param reporter 違反の記録先
 * @returns 導出の宣言(宣言順)。`derives` を書いていなければ undefined
 */
export function parseDerives(trigger: YamlReader, reporter: SpecReporter): readonly DataDerivation[] | undefined {
  const raw = trigger.raw('derives');
  if (raw === undefined) return undefined;
  const record = asRecord(raw);
  if (record === null) {
    reporter.error(trigger.pointer('derives'), 'derives はマッピングで書きます', DERIVES_SUGGESTION);
    // 値が無い(null)のは、読み飛ばした宣言ではない。error だけ出して数えない(型違いの値だけを落とした行として数える)。
    if (raw === null) return undefined;
    reporter.dropRows();
    return [];
  }
  const derivations: DataDerivation[] = [];
  for (const [column, value] of Object.entries(record)) {
    const entry = asRecord(value);
    const pointer = `${trigger.pointer('derives')}.${column}`;
    if (entry === null) {
      reporter.error(pointer, `derives.${column} はマッピングで書きます`, DERIVES_SUGGESTION, { column });
      if (value !== null) reporter.dropRows();
      continue;
    }
    const reader = new YamlReader(entry, pointer, reporter);
    if (APPEND_KEY in entry) {
      reader.rejectUnknownKeys(APPEND_KEYS, `derives.${column}`, 'append_within / mode の 2 つだけを書く(幅の形の from / offset と混ぜない)');
      const within = identifierField(reader, reporter, APPEND_KEY, reader.requiredString(APPEND_KEY, 'append_within に番号を数える範囲(親を指す自表の列)を書く'));
      const appendMode = reader.requiredString('mode', 'mode に initial(挿入時に空のときだけ)か insert_at(入れてきた値を位置と読んで差し込み、空なら末尾)を書く');
      if (within === null || appendMode === null) {
        reporter.dropRows();
        continue;
      }
      derivations.push({ column, within, mode: appendMode });
      continue;
    }
    reader.rejectUnknownKeys(DERIVATION_KEYS, `derives.${column}`, 'from / offset / mode の 3 つだけを書く');
    const from = identifierField(reader, reporter, 'from', reader.requiredString('from', 'from に元になる自表の日時列を書く'));
    const offset = offsetField(reader, reporter, 'offset', reader.requiredString('offset', 'offset に "{±n} {minute|hour|day}" を書く(例: "-14 days")'));
    const mode = reader.requiredString('mode', 'mode に initial(挿入時に空のときだけ)か follow(発火のたびに引き直す)を書く');
    if (from === null || offset === null || mode === null) {
      reporter.dropRows();
      continue;
    }
    derivations.push({ column, from, offset, mode });
  }
  return derivations;
}
