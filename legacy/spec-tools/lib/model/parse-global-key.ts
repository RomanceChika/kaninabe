/**
 * **鍵が全体で一意であることの受け入れ**(`global_key`)を読む(不変条件の `formal` と data_table の `indexes[]`。V26)。
 *
 * ```yaml
 * global_key:
 *   keys: [public_code]     # 受け入れる鍵の列を全部名指す
 *   reason: 公開の識別子は全テナントで一意
 * ```
 *
 * 理由は「その鍵」について書いた文なので、受け入れた鍵の列を行に書かせる。今の鍵と列の集合が違えば V26 が腐った受け入れとして止める
 * (点検 13 回目 A13-4。鍵を変えても理由だけが効き続ける形を残さない)。
 *
 * 緩める宣言なので、読めない形は載せない(緩めない側に倒す)。違反は記録するので verify は止まる。純関数であり throw しない。
 */

import type { SpecReporter } from './parse-common.js';
import { YamlReader } from './yaml-reader.js';

/** 受け入れ 1 件。 */
export interface GlobalKeyAccept {
  /** 受け入れた鍵の列(宣言順)。 */
  readonly keys: readonly string[];
  /** なぜ全体で一意が正しいか。 */
  readonly reason: string;
}

/** YAML のキー。 */
const GLOBAL_KEY = 'global_key';

/** 書き方。 */
const SUGGESTION = 'global_key は "keys: [受け入れる鍵の列] / reason: {なぜ全体で一意か}" の形で書く(空は通らない)';

/**
 * `global_key` を読む(書かれていなければ空)。
 *
 * @param reader `global_key` を持つ行の読み手
 * @param reporter 違反の記録先
 * @returns 書かれていて読めたときだけ `globalKey` を持つ断片
 */
export function globalKeyOf(reader: YamlReader, reporter: SpecReporter): { readonly globalKey?: GlobalKeyAccept } {
  if (!reader.has(GLOBAL_KEY)) return {};
  const raw = reader.raw(GLOBAL_KEY);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    reporter.error(reader.pointer(GLOBAL_KEY), 'global_key の形が違います(受け入れる鍵の列と理由が要ります)', SUGGESTION);
    return {};
  }
  const record = new YamlReader(raw as Record<string, unknown>, reader.pointer(GLOBAL_KEY), reporter);
  record.rejectUnknownKeys(['keys', 'reason'], 'global_key', SUGGESTION);
  const keys = record.requiredStringList('keys', SUGGESTION, false);
  const reason = record.requiredString('reason', SUGGESTION);
  if (keys === null || reason === null) return {};
  if (reason.trim() === '') {
    reporter.error(record.pointer('reason'), 'global_key の reason が空です', SUGGESTION);
    return {};
  }
  return { globalKey: { keys, reason } };
}
