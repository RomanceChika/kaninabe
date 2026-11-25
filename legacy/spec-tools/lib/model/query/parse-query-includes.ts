/**
 * query_spec の併読(`includes`)と、可視性の供給元(`via`)のパーサー。
 *
 * スキーマの正: query-spec-writing.md §includes / §via。
 * ここで見るのは 1 ファイル内で閉じた形式だけで、借用が成立するか(implies の含意・
 * 借りられるスコープ・借用の要否)や、フィールドの実在はドメイン仕様との突合になるので
 * Q1 / Q2 / Q5 が見る。
 * ファイル I/O は行わない(I/O は lib/model/query/loader.ts に集約する。規約: scripts-code-quality.md)。
 */

import type { SpecReporter } from '../parse-common.js';
import { elementPointer } from '../parse-common.js';
import { parseReadScope } from '../parse-access.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import type { QueryInclude, QueryVia } from './types.js';
import { parseFilters, parseProjection, parseSort } from './parse-query-shape.js';

const INCLUDES_SUGGESTION =
  'includes は "- entity: {エンティティ名}" / "scope_used: own | context({entity}) | all" / "projection: [{フィールド名}]" を持つ要素のリストで書く(filters / sort / limit / via は任意)';

const LIMIT_SUGGESTION =
  'includes の limit には併読する行数の上限を 1 以上の整数で書く(省略すると全件)';

const VIA_SUGGESTION =
  'via に「行の可視性を供給する関係ロール」を 1 つ書く(例: via: performer)。' +
  'for には観客(グローバルロール)を書き、関係ロールは via に分ける';

/** ロール ID(snake_case)。 */
const ROLE_ID = /^[a-z][a-z0-9_]*$/;

/**
 * `via`(可視性を供給する関係ロール)を読む。省略可。
 *
 * 借用が成立するかどうか(implies の含意・借りられるスコープ・借用の要否)は
 * ドメイン仕様との突合になるので Q2 / Q5 が見る。ここで見るのは形式だけである。
 *
 * @param root 読み取り対象のマッピング(トップレベル、または includes の 1 要素)
 * @param reporter 違反の記録先
 * @param base YAML パスの接頭辞(includes 側は "includes.{entity}")
 * @returns 読めた via。未記入・形式違反なら null
 */
export function parseVia(root: YamlReader, reporter: SpecReporter, base = ''): QueryVia | null {
  const at = base === '' ? 'via' : `${base}.via`;
  const raw = root.optionalString('via', VIA_SUGGESTION);
  if (raw === undefined) return null;
  const role = raw.trim();
  if (ROLE_ID.test(role)) return { role, location: reporter.location(at) };
  reporter.error(at, `via ${raw} がロール ID の形式ではありません`, VIA_SUGGESTION, { via: raw });
  return null;
}

/** includes を読む。省略時は空(併読なし)。 */
export function parseIncludes(root: YamlReader, reporter: SpecReporter): readonly QueryInclude[] {
  const items = root.optionalList('includes', INCLUDES_SUGGESTION);
  const includes: QueryInclude[] = [];
  eachRecord(items, 'includes', reporter, INCLUDES_SUGGESTION, (reader, index) => {
    const entity = reader.requiredString('entity', '併読するエンティティ名を entity に書く');
    const rawScope = reader.requiredString(
      'scope_used',
      'そのエンティティを読むスコープを scope_used に書く(access_spec の reads と一致させる)',
    );
    if (entity === null || rawScope === null) return;
    const at = elementPointer('includes', index, entity);
    const scopeUsed = parseReadScope(rawScope, reader.pointer('scope_used'), reporter);
    const via = parseVia(reader, reporter, at);
    const filters = parseFilters(reader, reporter, at);
    const projection = parseProjection(reader, reporter, at);
    const sort = parseSort(reader, reporter, at);
    const limit = parseIncludeLimit(reader, reporter, at);
    if (scopeUsed === null || projection === null) return;
    includes.push({
      entity,
      scopeUsed,
      ...(via === null ? {} : { via }),
      filters,
      projection,
      sort,
      ...(limit === null ? {} : { limit }),
      location: reporter.location(at),
    });
  });
  return includes;
}

/**
 * includes の `limit`(併読した行の件数上限)を読む。省略可。
 *
 * source 側の `paging` と違い必須にしないのは、併読が「親 1 件にぶら下がる少数の行」を
 * 想定しているためである。件数が業務上有界でない併読には書く。
 *
 * @param root includes の 1 要素
 * @param reporter 違反の記録先
 * @param base YAML パスの接頭辞("includes.{entity}")
 * @returns 読めた上限。未記入・形式違反なら null
 */
export function parseIncludeLimit(
  root: YamlReader,
  reporter: SpecReporter,
  base: string,
): number | null {
  const at = `${base}.limit`;
  if (!root.has('limit')) return null;
  const value = root.optionalNumber('limit', LIMIT_SUGGESTION);
  if (value === undefined) return null;
  if (Number.isInteger(value) && value > 0) return value;
  reporter.error(at, `includes の limit ${value} は 1 以上の整数で書きます`, LIMIT_SUGGESTION, {
    limit: String(value),
  });
  return null;
}

