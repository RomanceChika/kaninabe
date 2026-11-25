/**
 * query_spec の「読み取りの形」を表す部分(params / filters / sort / paging / projection)の
 * パーサー。併読(includes)と via は parse-query-includes.ts が読む。
 *
 * スキーマの正: query-spec-writing.md §スキーマ。
 * ここで見るのは 1 ファイル内で閉じた形式だけで、ドメイン仕様との突合(Q1〜Q5)は検証器が行う。
 * ファイル I/O は行わない(I/O は lib/model/query/loader.ts に集約する。規約: scripts-code-quality.md)。
 */

import type { SpecReporter } from '../parse-common.js';
import { elementPointer } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import type {
  NullsPosition,
  QueryFilter,
  QueryPaging,
  QueryParam,
  QueryProjectionField,
  QueryReturns,
  QuerySortKey,
} from './types.js';

const FILTERS_SUGGESTION =
  'filters には絞り込み条件をガード式と同じ文法で 1 行 1 本ずつ並べる(例: "- state in [published, closed]")';

const PARAMS_SUGGESTION =
  'params は "- name: {パラメータ名}" と "ref: {entity}.{field}"(型の導出元)を持つ要素のリストで書く';

const RETURNS_SUGGESTION = 'returns に one(1 件)または many(0 件以上)を書く';

const SORT_SUGGESTION =
  'sort は "- {フィールド名} asc" / "- {フィールド名} desc" の形で並べる(方向を省くと asc)。' +
  'null を持ちうるフィールドで末尾/先頭を明示したいときだけ "- {フィールド名} asc nulls_last" ' +
  'のように 3 語目に nulls_first / nulls_last を足す(省略時は Postgres の既定)';

const PAGING_SUGGESTION = 'paging に none / limit({件数}) / cursor のいずれかを書く';

const PROJECTION_SUGGESTION =
  'projection に返すフィールド名を 1 つ以上並べる(entity_spec に実在するフィールドのみ)';

/** `{field} [asc|desc] [nulls_first|nulls_last]` 形式。 */
const SORT_KEY = /^([a-z][a-z0-9_]*)(?:\s+(asc|desc))?(?:\s+(nulls_first|nulls_last))?$/;

/** `limit({n})` 形式。 */
const LIMIT_PAGING = /^limit\(\s*(\d+)\s*\)$/;

/** パラメータ名(snake_case)。 */
const PARAM_NAME = /^[a-z][a-z0-9_]*$/;

/** `{entity}.{field}` 形式。 */
const QUALIFIED = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;

/**
 * params を読む。省略時は空(実行時入力なし)。
 *
 * 型・制約は `ref` の指すフィールド定義が正なので、ここでは形式と名前の一意性だけを見る
 * (参照先の実在は Q1 が見る)。
 */
export function parseParams(root: YamlReader, reporter: SpecReporter): readonly QueryParam[] {
  const items = root.optionalList('params', PARAMS_SUGGESTION);
  const params: QueryParam[] = [];
  const seen = new Set<string>();
  eachRecord(items, 'params', reporter, PARAMS_SUGGESTION, (reader, index) => {
    const name = reader.requiredString('name', 'パラメータ名を name に snake_case で書く');
    const raw = reader.requiredString('ref', 'ref に型の導出元を "{entity}.{field}" 形式で書く');
    if (name === null || raw === null) return;
    const at = elementPointer('params', index, name);
    if (!PARAM_NAME.test(name)) {
      reporter.error(`${at}.name`, `params の ${name} が snake_case ではありません`, PARAMS_SUGGESTION, {
        name,
      });
      return;
    }
    if (seen.has(name)) {
      reporter.error(`${at}.name`, `params の ${name} が重複しています`, 'パラメータ名は 1 クエリ内で一意にする', {
        name,
      });
      return;
    }
    const matched = QUALIFIED.exec(raw.trim());
    const entity = matched?.[1];
    const field = matched?.[2];
    if (entity === undefined || field === undefined) {
      reporter.error(`${at}.ref`, `params の ref "${raw}" が "{entity}.{field}" の形式ではありません`, PARAMS_SUGGESTION, {
        ref: raw,
      });
      return;
    }
    seen.add(name);
    params.push({ name, ref: { entity, field, raw }, location: reporter.location(at) });
  });
  return params;
}

/**
 * returns を値域として読む。必須。
 *
 * @returns 読めた返し方。欠落・値域の外なら null
 */
export function parseReturns(root: YamlReader, reporter: SpecReporter): QueryReturns | null {
  const raw = root.requiredString('returns', RETURNS_SUGGESTION);
  if (raw === null) return null;
  const text = raw.trim();
  if (text === 'one' || text === 'many') return text;
  reporter.error('returns', `returns "${text}" は one / many のどちらでもありません`, RETURNS_SUGGESTION, {
    returns: text,
  });
  return null;
}

/**
 * filters を読む。省略時は空(絞り込み無し)。source と includes の両方で使う。
 *
 * 式の文法妥当性と参照パスの解決は Q4 が見るので、ここでは文字列として受けるだけにする。
 *
 * @param root 読み取り対象のマッピング(トップレベル、または includes の 1 要素)
 * @param reporter 違反の記録先
 * @param base YAML パスの接頭辞(includes 側は "includes.{entity}")
 * @returns 絞り込み条件。書かれていなければ空
 */
export function parseFilters(
  root: YamlReader,
  reporter: SpecReporter,
  base = '',
): readonly QueryFilter[] {
  const at = base === '' ? 'filters' : `${base}.filters`;
  const raw = root.optionalStringList('filters', FILTERS_SUGGESTION);
  const filters: QueryFilter[] = [];
  raw.forEach((source, index) => {
    if (source.trim() === '') {
      reporter.error(`${at}[${index}]`, `${at}[${index}] が空です`, FILTERS_SUGGESTION);
      return;
    }
    filters.push({ source, location: reporter.location(`${at}[${index}]`) });
  });
  return filters;
}

/**
 * sort を読む。省略時は空(並び順を規定しない)。source と includes の両方で使う。
 *
 * @param root 読み取り対象のマッピング(トップレベル、または includes の 1 要素)
 * @param reporter 違反の記録先
 * @param base YAML パスの接頭辞(includes 側は "includes.{entity}")
 * @returns 並び順のキー。書かれていなければ空
 */
export function parseSort(
  root: YamlReader,
  reporter: SpecReporter,
  base = '',
): readonly QuerySortKey[] {
  const at = base === '' ? 'sort' : `${base}.sort`;
  const raw = root.optionalStringList('sort', SORT_SUGGESTION);
  const keys: QuerySortKey[] = [];
  raw.forEach((value, index) => {
    const matched = SORT_KEY.exec(value.trim());
    const field = matched?.[1];
    if (field === undefined) {
      reporter.error(
        `${at}[${index}]`,
        `${at}[${index}] "${value}" が "{フィールド名} [asc|desc]" の形式ではありません`,
        SORT_SUGGESTION,
        { value },
      );
      return;
    }
    const nulls: NullsPosition | undefined =
      matched?.[3] === 'nulls_first' ? 'first' : matched?.[3] === 'nulls_last' ? 'last' : undefined;
    keys.push({
      field,
      direction: matched?.[2] === 'desc' ? 'desc' : 'asc',
      ...(nulls === undefined ? {} : { nulls }),
      raw: value,
      location: reporter.location(elementPointer(at, index, field)),
    });
  });
  return keys;
}

/**
 * paging を読む。`returns: many` のときだけ書ける(1 件返すクエリにページングは無い)。
 *
 * @param returns 読めた returns(読めていなければ null)
 * @returns 読めた方式。書かれていない場合と形式違反は null
 */
export function parsePaging(
  root: YamlReader,
  reporter: SpecReporter,
  returns: QueryReturns | null,
): QueryPaging | null {
  if (!root.has('paging')) {
    if (returns === 'many') {
      reporter.error(
        'paging',
        'returns: many には paging が必要です',
        `${PAGING_SUGGESTION}(「全件返す」場合も none と明示する)`,
      );
    }
    return null;
  }
  if (returns === 'one') {
    reporter.error(
      'paging',
      'returns: one に paging は書けません',
      'paging の行を削除する。件数を絞りたいなら returns: many に直す',
    );
    return null;
  }
  const raw = root.requiredString('paging', PAGING_SUGGESTION);
  if (raw === null) return null;
  const text = raw.trim();
  if (text === 'none') return { kind: 'none' };
  if (text === 'cursor') return { kind: 'cursor' };
  const limit = LIMIT_PAGING.exec(text);
  const max = limit?.[1];
  if (max !== undefined) {
    const parsed = Number.parseInt(max, 10);
    if (parsed > 0) return { kind: 'limit', max: parsed };
    reporter.error('paging', 'limit の件数は 1 以上で書きます', PAGING_SUGGESTION, { paging: text });
    return null;
  }
  reporter.error('paging', `paging "${text}" は使えません`, PAGING_SUGGESTION, { paging: text });
  return null;
}

/**
 * projection を読む。必須・1 つ以上。source と includes の両方で使う。
 *
 * @param root 読み取り対象のマッピング(トップレベル、または includes の 1 要素)
 * @param reporter 違反の記録先
 * @param base YAML パスの接頭辞(includes 側は "includes.{entity}")
 * @returns 返すフィールド。欠落・空・重複ありなら null
 */
export function parseProjection(
  root: YamlReader,
  reporter: SpecReporter,
  base = '',
): readonly QueryProjectionField[] | null {
  const at = base === '' ? 'projection' : `${base}.projection`;
  const raw = root.requiredStringList('projection', PROJECTION_SUGGESTION, false);
  if (raw === null) return null;

  const fields: QueryProjectionField[] = [];
  const seen = new Set<string>();
  for (const name of raw) {
    if (seen.has(name)) {
      reporter.error(
        `${at}.${name}`,
        `${at} に ${name} が重複しています`,
        '同じフィールドを 2 回書かない(重複を削る)',
        { field: name },
      );
      continue;
    }
    seen.add(name);
    fields.push({ name, location: reporter.location(`${at}.${name}`) });
  }
  return fields;
}
