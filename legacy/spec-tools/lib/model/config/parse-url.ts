/**
 * config_spec の行が持つ **URL の書式**(`format: url` と `scheme`)のパーサー。
 *
 * 外へ出る URL(Webhook・招待・デプロイフック・接続先)は、種類(`kind`)が `url: true` を宣言していれば
 * `format: url` と `scheme` を必ず書く(K4 が見る)。`scheme` は体系が持つ値域(`CONFIG_URL_SCHEMES`)で、
 * 実行時は `@kaninabe/runtime/url` の `readConfigUrl` が同じ語で判定する(平文の送り先を黙って使わない。ASVS V12.3.1)。
 * 形だけを見る: `format` の値・`scheme` の値・2 つが対で現れること。1 つでも読めなければ行ごと落とす。
 */

import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';
import type { ConfigUrlScheme } from './types.js';
import { CONFIG_URL_SCHEMES } from './types.js';

/** 書き方の案内。 */
const URL_SUGGESTION = `外へ出る URL の行は "format: url" と "scheme: ${CONFIG_URL_SCHEMES.join(' | ')}" を対で書く(https が既定。http を許すのは自分の機械への接続先だけ)`;

/** 読んだ URL の書式(無ければ両方 undefined)。 */
export interface ConfigUrlFormat {
  readonly format?: 'url';
  readonly scheme?: ConfigUrlScheme;
}

/**
 * 行の `format` と `scheme` を読む。
 *
 * @param item 行のマッピング
 * @param id 環境変数名(違反の文に出す)
 * @param reporter 違反の記録先
 * @returns 書式。読めなければ null(行ごと落とす)
 */
export function parseUrlFormat(item: YamlReader, id: string, reporter: SpecReporter): ConfigUrlFormat | null {
  const format = item.optionalString('format', URL_SUGGESTION);
  const scheme = item.optionalString('scheme', URL_SUGGESTION);
  if (format === undefined && scheme === undefined) return {};
  if (format !== undefined && format !== 'url') {
    reporter.error(item.pointer('format'), `設定 ${id} の format ${format} は使えません`, URL_SUGGESTION, { id, format });
    return null;
  }
  if (format === undefined) {
    reporter.error(item.pointer('scheme'), `設定 ${id} は scheme だけを書いています(format: url と対で書く)`, URL_SUGGESTION, { id });
    return null;
  }
  if (scheme === undefined) {
    reporter.error(item.pointer('scheme'), `設定 ${id} は format: url に scheme がありません(平文の http を黙って許さない)`, URL_SUGGESTION, { id });
    return null;
  }
  const found = CONFIG_URL_SCHEMES.find((candidate) => candidate === scheme);
  if (found === undefined) {
    reporter.error(item.pointer('scheme'), `設定 ${id} の scheme ${scheme} は使えません`, URL_SUGGESTION, { id, scheme });
    return null;
  }
  return { format: 'url', scheme: found };
}
