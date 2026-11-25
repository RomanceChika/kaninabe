/**
 * query_spec(`specs/backend/queries/{aggregate}/{name}.md`)のパーサー。
 *
 * スキーマの正: query-spec-writing.md §スキーマ。Q0(スキーマ適合)はここが担う。
 * 他の仕様との突合(Q1〜Q7)は検証器がモデルに対して行う。
 * ファイル I/O は行わない(I/O は lib/model/query/loader.ts に集約する。規約: scripts-code-quality.md)。
 */

import type { ReadScope } from '../types.js';
import { asRecord, checkDocType, SpecReporter, type ParseResult } from '../parse-common.js';
import { parseReadScope } from '../parse-access.js';
import { YamlReader } from '../yaml-reader.js';
import { parseTestCases } from '../parse-test-case.js';
import { parseLintExceptions } from '../parse-lint-exceptions.js';
import type { QuerySpec } from './types.js';
import { parseBoundedBy } from './parse-query-bounded-by.js';
import {
  parseFilters,
  parsePaging,
  parseParams,
  parseProjection,
  parseReturns,
  parseSort,
} from './parse-query-shape.js';
import { parseIncludes, parseVia } from './parse-query-includes.js';

/** クエリ名(snake_case)。実装関数名 `{camelCase(name)}Query` の元になる。 */
const NAME = /^[a-z][a-z0-9_]*$/;

/** 主エンティティ名(snake_case)。 */
const ENTITY = /^[a-z][a-z0-9_]*$/;

const NAME_SUGGESTION =
  'name にクエリ名を snake_case で書く(例: workshop_list)。実装は {camelCase(name)}Query になる';

const FOR_SUGGESTION =
  'for にこのクエリを実行するロールを 1 つ以上並べる(roles.md に定義されたロール ID)';

const SOURCE_SUGGESTION = 'source に主エンティティ名を書く(例: workshop)。entity_spec の entity と同じ名前';

const SCOPE_USED_SUGGESTION =
  'scope_used に own / context({entity}) / all のいずれかを書く(access_spec の reads と一致させる)';

/**
 * クエリ名から id を導く。`_` を `-` に置き換えて `query-` を前置する。
 *
 * @param name クエリ名(snake_case)
 * @returns 期待される id(例: workshop_list → query-workshop-list)
 */
export function queryIdOf(name: string): string {
  return `query-${name.split('_').join('-')}`;
}

/**
 * query_spec のフロントマターを QuerySpec に変換する。
 *
 * @param data フロントマターのパース結果(unknown)
 * @param file リポジトリルートからの相対パス(Finding の location に入る)
 * @param relPath specs/backend/queries からの相対パス(例: "workshop/list.md")
 * @returns QuerySpec と Q0 違反。必須項目を読めない場合は value=null
 */
export function parseQuerySpec(data: unknown, file: string, relPath: string): ParseResult<QuerySpec> {
  const reporter = new SpecReporter(file);
  const record = asRecord(data);
  if (record === null) {
    reporter.error(
      undefined,
      'query_spec のフロントマターがマッピングではありません',
      'template.query_spec.md をコピーし、doc_type: query_spec から始まる YAML マッピングとして書き直す',
    );
    return { value: null, findings: reporter.findings() };
  }

  checkDocType(record, 'query_spec', reporter);
  const root = new YamlReader(record, '', reporter);
  checkScope(root, reporter);

  const name = parseName(root, reporter);
  const id = parseId(root, name, reporter);
  const source = parseSource(root, reporter);
  const scopeUsed = parseScopeUsed(root, reporter);
  const forRoles = root.requiredStringList('for', FOR_SUGGESTION, false);
  const via = parseVia(root, reporter);
  const projection = parseProjection(root, reporter);
  const returns = parseReturns(root, reporter);
  const paging = parsePaging(root, reporter, returns);
  const boundedBy = parseBoundedBy(root, reporter, paging);
  const testCases = parseTestCases(root, reporter);
  const params = parseParams(root, reporter);
  const filters = parseFilters(root, reporter);
  const includes = parseIncludes(root, reporter);
  const sort = parseSort(root, reporter);
  const exceptions = parseLintExceptions(root, reporter);
  if (name !== null) checkFileName(name, relPath, reporter);
  if (source !== null) checkDirectory(source, relPath, reporter);

  if (
    id === null ||
    name === null ||
    source === null ||
    scopeUsed === null ||
    forRoles === null ||
    projection === null ||
    returns === null ||
    testCases === null ||
    boundedBy === null
  ) {
    return { value: null, findings: reporter.findings() };
  }

  return {
    value: {
      id,
      name,
      forRoles,
      source,
      scopeUsed,
      ...(via === null ? {} : { via }),
      params,
      returns,
      filters,
      includes,
      sort,
      ...(paging === null ? {} : { paging }),
      ...(boundedBy === undefined ? {} : { boundedBy }),
      projection,
      testCases,
      exceptions,
      relPath,
      location: reporter.location(),
    },
    findings: reporter.findings(),
  };
}

/** scope は backend 固定(query_spec はバックエンド仕様)。 */
function checkScope(root: YamlReader, reporter: SpecReporter): void {
  const scope = root.optionalString('scope', 'scope: backend と書く');
  if (scope === undefined) {
    reporter.error('scope', 'scope がありません', 'フロントマターに scope: backend を書く');
    return;
  }
  if (scope === 'backend') return;
  reporter.error(
    'scope',
    'query_spec の scope は backend でなければなりません',
    'scope: backend に直す(specs/backend 配下の仕様はすべて backend)',
    { actual: scope },
  );
}

/** name を読む。snake_case 以外はエラー(実装関数名の導出が壊れるため)。 */
function parseName(root: YamlReader, reporter: SpecReporter): string | null {
  const name = root.requiredString('name', NAME_SUGGESTION);
  if (name === null) return null;
  if (NAME.test(name)) return name;
  reporter.error('name', `name ${name} が snake_case ではありません`, NAME_SUGGESTION, { name });
  return null;
}

/** id を読み、name から導かれる `query-{name}` と一致するかを見る。 */
function parseId(root: YamlReader, name: string | null, reporter: SpecReporter): string | null {
  const suggestion = 'id を "query-{name をハイフン区切りにしたもの}"(例: query-workshop-list)形式で書く';
  const id = root.requiredString('id', suggestion);
  if (id === null || name === null) return id;
  const expected = queryIdOf(name);
  if (id === expected) return id;
  reporter.error(
    'id',
    `id が name(${name})から導かれる ID と一致しません`,
    `id: ${expected} に直す(id は name と 1 対 1 に対応する)`,
    { expected, actual: id },
  );
  return id;
}

/** source を読む。 */
function parseSource(root: YamlReader, reporter: SpecReporter): string | null {
  const source = root.requiredString('source', SOURCE_SUGGESTION);
  if (source === null) return null;
  if (ENTITY.test(source)) return source;
  reporter.error('source', `source ${source} がエンティティ名の形式ではありません`, SOURCE_SUGGESTION, {
    source,
  });
  return null;
}

/**
 * scope_used を読む。
 *
 * `none` は「読めない」宣言であり、読み取り経路の仕様である query_spec と両立しない。
 * 値域そのものは access_spec と共有する(parseReadScope)ので、ここでは none だけを弾く。
 */
function parseScopeUsed(root: YamlReader, reporter: SpecReporter): ReadScope | null {
  const raw = root.requiredString('scope_used', SCOPE_USED_SUGGESTION);
  if (raw === null) return null;
  const scope = parseReadScope(raw, 'scope_used', reporter);
  if (scope === null) return null;
  if (scope.kind !== 'none') return scope;
  reporter.error(
    'scope_used',
    'scope_used に none は書けません',
    '読めないスコープにクエリは作れない。scope_used を own / context({entity}) / all のいずれかに直すか、この query_spec を削除する',
    { scope_used: raw },
  );
  return null;
}

/**
 * 置き場のディレクトリが `source` の集約名になっているかを見る。
 *
 * 仕様のパス `queries/{aggregate}/{name}.md` から実装の位置
 * (`app/src/{layer}/{aggregate}/queries.ts`)を導く規約(ARCH-SP-BE-0001 / ARCH-BE-0016)は、
 * ディレクトリ名が主エンティティと一致していて初めて成り立つ。食い違うと、
 * 仕様からも実装からも相手を引けない「宙に浮いたクエリ」ができる。
 */
function checkDirectory(source: string, relPath: string, reporter: SpecReporter): void {
  const segments = relPath.split('/');
  if (segments.length < 2) {
    reporter.error(
      'source',
      `query_spec が集約ディレクトリの外(${relPath})にあります`,
      `ファイルを ${source}/${segments[0] ?? relPath} に移す(置き場は queries/{aggregate}/{name}.md 固定)`,
      { expected: `${source}/`, actual: relPath },
    );
    return;
  }
  if (segments.length > 2) {
    reporter.error(
      'source',
      `query_spec の置き場が深すぎます(${relPath})`,
      `ディレクトリは 1 段(queries/${source}/{name}.md)にする。集約の中をさらに分けない`,
      { expected: `${source}/`, actual: relPath },
    );
    return;
  }

  const directory = segments[0] ?? '';
  if (directory === source) return;
  reporter.error(
    'source',
    `ディレクトリ ${directory} が source(${source})と一致しません`,
    `ファイルを ${source}/ の下に移すか、source を ${directory} に直す` +
      '(仕様のパスから実装 app/src/{layer}/{aggregate}/queries.ts を導けるようにするため)',
    { expected: source, actual: directory },
  );
}

/** ファイル名が `{name}.md` になっているかを見る(パスから実装を導けるようにするため)。 */
function checkFileName(name: string, relPath: string, reporter: SpecReporter): void {
  const base = relPath.split('/').pop() ?? relPath;
  if (base === `${name}.md`) return;
  reporter.error(
    'name',
    `ファイル名 ${base} が name(${name})と一致しません`,
    `ファイルを {aggregate}/${name}.md にリネームするか、name を ${base.replace(/\.md$/, '')} に直す`,
    { expected: `${name}.md`, actual: base },
  );
}
