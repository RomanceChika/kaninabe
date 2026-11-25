/**
 * query_spec の `bounded_by`(`paging: none` の有界性の根拠)のパーサー。
 *
 * `parse-query-shape.ts` が呼ぶ下位の部品である。スキーマの正: query-spec-writing.md §bounded_by。
 * ファイル I/O は行わない(I/O は lib/model/query/loader.ts に集約する。規約: scripts-code-quality.md)。
 */

import { asRecord } from '../parse-common.js';
import type { SpecReporter } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import type { QueryBoundedBy, QueryPaging } from './types.js';

const BOUNDED_BY_SUGGESTION =
  'bounded_by に "window"(via のスコープ条件で有界)、または parent: {aggregate} と reason: {理由を1行} の' +
  'マッピング(親集約1件の子行で有界)を書く';

/**
 * bounded_by を読む。`paging: none` のときだけ意味を持つ(Q8 が必須性を見る)。
 *
 * `returns: one` や `paging: limit/cursor` では書けない — 有界性の根拠は「全件返す」宣言に
 * 対してだけ要る言い訳であり、上限や 1 件返しにはそもそも要らない。
 *
 * @param paging 読めた paging(読めていなければ null)
 * @returns 読めた根拠。書かれていなければ undefined、形式違反は null
 */
export function parseBoundedBy(
  root: YamlReader,
  reporter: SpecReporter,
  paging: QueryPaging | null,
): QueryBoundedBy | null | undefined {
  if (!root.has('bounded_by')) return undefined;
  if (paging?.kind !== 'none') {
    reporter.error(
      'bounded_by',
      'bounded_by は paging: none のときだけ書けます',
      'paging: none 以外では bounded_by の行を削除する(有界性の根拠は「全件返す」宣言にだけ要る)',
    );
    return null;
  }
  const raw = root.raw('bounded_by');
  if (raw === 'window') return { kind: 'window' };
  const record = asRecord(raw);
  if (record === null) {
    reporter.error('bounded_by', 'bounded_by の形式が不正です', BOUNDED_BY_SUGGESTION, { value: String(raw) });
    return null;
  }
  const nested = new YamlReader(record, 'bounded_by', reporter);
  const aggregate = nested.requiredString('parent', BOUNDED_BY_SUGGESTION);
  const reason = nested.requiredString('reason', BOUNDED_BY_SUGGESTION);
  if (aggregate === null || reason === null) return null;
  return { kind: 'parent', aggregate, reason };
}
