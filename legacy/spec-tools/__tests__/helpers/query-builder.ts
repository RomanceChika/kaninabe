/**
 * クエリ検証器(Q1〜Q7)のテスト用ビルダー。
 *
 * 規約(scripts-code-quality.md)により検証器のテストはファイル I/O を行わず、
 * 入力をテスト内でリテラル構築する。ここではその定型部分(location の埋め草・
 * 省略可能フィールドの扱い)だけを引き受ける。
 * ドメイン側(SpecModel)の構築は model-builder.ts を使う。
 *
 * ガードサービスは Q4 が式の解析結果そのものを見るため、スタブではなく実物を注入する
 * (文法の正は 1 つであり、テストが別の文法を持つと検査の意味が変わるため)。
 */

import type { ReadScope } from '../../lib/model/types.js';
import type { SpecModel } from '../../lib/model/types.js';
import type { ActionSpec } from '../../lib/model/trace/types.js';
import type { TestScanResult } from '../../lib/testcase/types-scan.js';
import { buildTcRegistry } from '../../lib/testcase/registry.js';
import { collectTcEntries } from '../../lib/spec-index/sources.js';
import type { QueryContext } from '../../lib/query/verifier.js';
import type {
  NullsPosition,
  QueryBoundedBy,
  QueryInput,
  QueryPaging,
  QueryReturns,
  QuerySpec,
  QueryTestCase,
  SortDirection,
} from '../../lib/model/query/types.js';
import { createGuardServices } from '../../lib/guard/services.js';
import { specModel } from './model-builder.js';
import { scanResult } from './trace-builder.js';

/** 全クエリ検証器テストで共有してよい(状態を持たない)。 */
export const QUERY_CTX: QueryContext = { guards: createGuardServices() };

/** 文字列("own" / "context(workshop)" 等)を ReadScope に変換する。 */
export function scope(text: ReadScope | string): ReadScope {
  if (typeof text !== 'string') return text;
  const context = /^context\(([a-z0-9_]+)\)$/.exec(text);
  if (context?.[1] !== undefined) return { kind: 'context', entity: context[1] };
  if (text === 'own' || text === 'all' || text === 'none') return { kind: text };
  throw new Error(`未知の scope: ${text}`);
}

/** query_spec 1 件を作る。name から id・relPath・ファイルパスを既定で導く。 */
export function querySpec(init: {
  name: string;
  source: string;
  for: readonly string[];
  scopeUsed: ReadScope | string;
  /** 可視性を供給する関係ロール(省略時は宣言なし)。 */
  via?: string;
  aggregate?: string;
  params?: readonly { name: string; ref: string }[];
  returns?: QueryReturns;
  filters?: readonly string[];
  includes?: readonly {
    entity: string;
    scopeUsed: ReadScope | string;
    via?: string;
    projection?: readonly string[];
    filters?: readonly string[];
    sort?: readonly { field: string; direction?: SortDirection; nulls?: NullsPosition }[];
    limit?: number;
  }[];
  sort?: readonly { field: string; direction?: SortDirection; nulls?: NullsPosition }[];
  paging?: QueryPaging;
  boundedBy?: QueryBoundedBy;
  projection?: readonly string[];
  testCases?: readonly QueryTestCase[];
}): QuerySpec {
  const aggregate = init.aggregate ?? init.source;
  const relPath = `${aggregate}/${init.name}.md`;
  const file = `docs/specs/backend/queries/${relPath}`;
  return {
    id: `query-${init.name.split('_').join('-')}`,
    name: init.name,
    forRoles: init.for,
    source: init.source,
    scopeUsed: scope(init.scopeUsed),
    ...(init.via === undefined
      ? {}
      : { via: { role: init.via, location: { file, pointer: 'via' } } }),
    params: (init.params ?? []).map((param) => {
      const [entity = '', field = ''] = param.ref.split('.');
      return {
        name: param.name,
        ref: { entity, field, raw: param.ref },
        location: { file, pointer: `params.${param.name}` },
      };
    }),
    returns: init.returns ?? 'many',
    filters: (init.filters ?? []).map((source, index) => ({
      source,
      location: { file, pointer: `filters[${index}]` },
    })),
    includes: (init.includes ?? []).map((include) => ({
      entity: include.entity,
      scopeUsed: scope(include.scopeUsed),
      ...(include.via === undefined
        ? {}
        : {
            via: {
              role: include.via,
              location: { file, pointer: `includes.${include.entity}.via` },
            },
          }),
      filters: (include.filters ?? []).map((source, index) => ({
        source,
        location: { file, pointer: `includes.${include.entity}.filters[${index}]` },
      })),
      projection: (include.projection ?? ['id']).map((name) => ({
        name,
        location: { file, pointer: `includes.${include.entity}.projection.${name}` },
      })),
      sort: (include.sort ?? []).map((key) => ({
        field: key.field,
        direction: key.direction ?? 'asc',
        ...(key.nulls === undefined ? {} : { nulls: key.nulls }),
        raw: `${key.field} ${key.direction ?? 'asc'}`,
        location: { file, pointer: `includes.${include.entity}.sort.${key.field}` },
      })),
      ...(include.limit === undefined ? {} : { limit: include.limit }),
      location: { file, pointer: `includes.${include.entity}` },
    })),
    sort: (init.sort ?? []).map((key) => ({
      field: key.field,
      direction: key.direction ?? 'asc',
      ...(key.nulls === undefined ? {} : { nulls: key.nulls }),
      raw: `${key.field} ${key.direction ?? 'asc'}`,
      location: { file, pointer: `sort.${key.field}` },
    })),
    ...((init.returns ?? 'many') === 'one'
      ? {}
      : { paging: init.paging ?? ({ kind: 'none' } as QueryPaging) }),
    ...(init.boundedBy === undefined ? {} : { boundedBy: init.boundedBy }),
    projection: (init.projection ?? ['id']).map((name) => ({
      name,
      location: { file, pointer: `projection.${name}` },
    })),
    testCases: init.testCases ?? [],
    exceptions: [],
    relPath,
    location: { file },
  };
}

/**
 * QueryInput を組み立てる。省略した入力は「空」になる。
 *
 * テストケース ID 台帳は渡された仕様から自動で構築する(検査と台帳が食い違った入力を
 * 作れないようにするため)。仕様種をまたぐ検査を書くときは `actions` に action_spec を渡す。
 */
export function queryInput(
  init: {
    domain?: SpecModel;
    queries?: readonly QuerySpec[];
    tests?: TestScanResult;
    /** 台帳に載せる action_spec(query_spec 以外の仕様種を母集合に含める場合)。 */
    actions?: readonly ActionSpec[];
  } = {},
): QueryInput {
  const queries = { available: true, queries: init.queries ?? [] };
  const actions = {
    actions: init.actions ?? [],
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  };
  return {
    domain: init.domain ?? specModel([]),
    queries,
    tests: init.tests ?? scanResult(),
    registry: buildTcRegistry(collectTcEntries({ actions, queries })),
  };
}
