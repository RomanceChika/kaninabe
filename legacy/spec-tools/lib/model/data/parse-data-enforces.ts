/**
 * data_table の `functions[].enforces`(`composite` の関数が執行点になる `writes` の規則)のパーサー。
 *
 * ここが見るのは**形**だけである —— 要素がマッピングであること・`writes` / `by` / `test_case` が
 * 揃っていること・余計なキー(`when` / `fields` など。正は access_spec の規則で、写すと 2 重の正になる)が
 * 無いこと。`kind: rpc` + `shape: composite` の関数にだけ書けること・規則と見張りテストの実在・
 * 執行点が 1 つであることは T18 が見る(書き場所の判定を検査に置くのは、書き間違いを黙殺しないため。
 * 正: ADR-0014)。
 */

import type { SpecReporter } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import type { DataFunctionEnforces } from './types.js';

/** 要素に書けるキー(これ以外は書けない)。 */
const ENFORCES_KEYS = ['writes', 'by', 'test_case'] as const;

/** 書き方の案内。 */
const ENFORCES_SUGGESTION =
  'enforces は "- { writes: {access_spec のエンティティ}, by: {その writes の規則の by}, test_case: {同じ表の test_cases の id} }" ' +
  'のリストで書く(when / fields は access_spec の規則が正なので写さない)';

/**
 * 関数 1 本の `enforces` を読む。
 *
 * @param reader その関数の要素
 * @param name 関数名(反例用)
 * @param reporter 違反の記録先
 * @returns 読めた宣言(書かなければ・1 つも読めなければ undefined)
 */
export function parseEnforces(
  reader: YamlReader,
  name: string,
  reporter: SpecReporter,
): readonly DataFunctionEnforces[] | undefined {
  if (!reader.has('enforces')) return undefined;
  const items = reader.optionalList('enforces', ENFORCES_SUGGESTION);
  if (items.length === 0) {
    reporter.error(reader.pointer('enforces'), `${name} の enforces が空です`, `${ENFORCES_SUGGESTION}。守る規則が無いなら enforces ごと削除する`, {
      function: name,
    });
    return undefined;
  }
  const found: DataFunctionEnforces[] = [];
  eachRecord(items, reader.pointer('enforces'), reporter, ENFORCES_SUGGESTION, (item) => {
    item.rejectUnknownKeys(ENFORCES_KEYS, `${name} の enforces の要素`, ENFORCES_SUGGESTION);
    const writes = item.requiredString('writes', ENFORCES_SUGGESTION);
    const by = item.requiredString('by', ENFORCES_SUGGESTION);
    const testCase = item.requiredString('test_case', ENFORCES_SUGGESTION);
    if (writes === null || by === null || testCase === null) return;
    found.push({ writes, by, testCase });
  });
  reporter.settleRows(items.length, found.length);
  return found.length === 0 ? undefined : found;
}
