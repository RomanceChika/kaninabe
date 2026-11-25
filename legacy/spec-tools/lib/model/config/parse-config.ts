/**
 * config_spec(設定カタログ)のパーサー(K0 = スキーマ適合 + 語彙の閉世界)。
 *
 * スキーマの正: config-spec-writing.md。
 * ここで見るのは 1 ファイルの中で閉じる形だけである — 変数名が環境変数の形
 * (SCREAMING_SNAKE)であること、行の軸(kind / requirement / used_by / 任意の provision)が
 * **同じファイルが宣言した語彙**に載っていること、そして**「無いとどうなるか」が必ず
 * 書かれていること**(必須かどうかを言い換えでなく挙動で宣言させる)。
 * 実装の参照・雛形との突合は K1・K2 が行う。
 */

import type { SpecReporter } from '../parse-common.js';
import { checkDocType, type ParseResult } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import type {
  ConfigCatalogSpec,
  ConfigSingleAxis,
  ConfigTermDecl,
  ConfigVariableDecl,
  ConfigVocabularyAxis,
} from './types.js';
import { CONFIG_SINGLE_AXES, CONFIG_VOCABULARY_AXES } from './types.js';
import { parseProvision } from './parse-provision.js';
import { parseLogging } from './parse-logging.js';
import { parseUrlFormat } from './parse-url.js';
import { parseSecretDecls } from './parse-secret.js';
import { parseTermExtras } from './parse-probe.js';
import { resolveTargets, validateTargetVocabulary } from './parse-target.js';
import { knows, reportUnknownTerm } from './vocabulary-lookup.js';

/** 語彙の語(スネークケース)。 */
const SNAKE = /^[a-z][a-z0-9_]*$/;

/** 環境変数名(SCREAMING_SNAKE)。実装の `process.env` 参照と同じ文字列になる。 */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** カタログの文書 ID(1 プロジェクト 1 カタログなので導出元が無く固定)。 */
export const CONFIG_CATALOG_ID = 'config-catalog';

const VOCABULARY_SUGGESTION =
  `vocabulary に ${CONFIG_VOCABULARY_AXES.join(' / ')} の語彙を "- id / label" のリストで宣言する` +
  '(語彙はこのアプリの事情なので体系側に持たない — config-spec-writing.md)';

/**
 * 設定カタログ 1 ファイル分のフロントマターをパースする。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先(Finding の location.file を持つ)
 * @returns 構築したカタログと K0 違反
 */
export function parseConfigCatalog(
  data: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
): ParseResult<ConfigCatalogSpec> {
  checkDocType(data, 'config_spec', reporter);
  const root = new YamlReader(data, '', reporter);

  const id = root.requiredString('id', `id を ${CONFIG_CATALOG_ID} と書く(1 プロジェクト 1 カタログ)`);
  if (id !== null && id !== CONFIG_CATALOG_ID) {
    reporter.error('id', `id ${id} はカタログの id ではありません`, `id: ${CONFIG_CATALOG_ID} に直す`, {
      id,
      expected: CONFIG_CATALOG_ID,
    });
  }
  const vocabulary = parseVocabulary(root, reporter);
  const variables = parseVariables(root, vocabulary, reporter);
  const logging = parseLogging(root, vocabulary, reporter);

  return {
    value: {
      id: CONFIG_CATALOG_ID,
      vocabulary,
      variables,
      ...(logging.decl === undefined ? {} : { logging: logging.decl }),
      loggingDeclared: logging.declared,
      location: reporter.location(),
    },
    findings: reporter.findings(),
  };
}

/** vocabulary を軸ごとに読む。軸そのものは体系が持ち、語彙は仕様が宣言する。 */
function parseVocabulary(
  root: YamlReader,
  reporter: SpecReporter,
): Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]> {
  const raw = root.raw('vocabulary');
  const reader =
    raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)
      ? null
      : new YamlReader(raw as Readonly<Record<string, unknown>>, 'vocabulary', reporter);
  if (reader === null) {
    reporter.error('vocabulary', 'vocabulary がありません', VOCABULARY_SUGGESTION);
    reporter.dropRows();
  }
  const result = {} as Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>;
  for (const axis of CONFIG_VOCABULARY_AXES) {
    result[axis] = reader === null ? [] : parseTerms(reader, axis, reporter);
  }
  validateTargetVocabulary(result, reporter);
  return result;
}

/** 1 軸分の語彙を読む。重複した語は突合キーが壊れるのでここで落とす。 */
function parseTerms(
  reader: YamlReader,
  axis: ConfigVocabularyAxis,
  reporter: SpecReporter,
): readonly ConfigTermDecl[] {
  const items = reader.optionalList(axis, VOCABULARY_SUGGESTION);
  if (items.length === 0) {
    reporter.error(`vocabulary.${axis}`, `vocabulary.${axis} が空です`, VOCABULARY_SUGGESTION);
    return [];
  }
  const terms: ConfigTermDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, `vocabulary.${axis}`, reporter, VOCABULARY_SUGGESTION, (item, index) => {
    const id = item.requiredString('id', `id に ${axis} の語(スネークケース)を書く`);
    if (id === null) return;
    if (!SNAKE.test(id)) {
      reporter.error(item.pointer('id'), `${axis} の語 ${id} がスネークケースではありません`, VOCABULARY_SUGGESTION, { id });
      return;
    }
    if (seen.has(id)) {
      reporter.error(`vocabulary.${axis}[${index}].id`, `${axis} の語 ${id} が重複しています`, '重複した要素を削除する', { id });
      duplicates += 1;
      return;
    }
    seen.add(id);
    const label = item.optionalLabel('label', 'label に人間向けの表示名を書く(未定なら書かない)');
    const extras = parseTermExtras(item, reporter);
    if (extras === null) return;
    terms.push({ id, ...(label === undefined ? {} : { label }), ...extras });
  });
  reporter.settleRows(items.length, terms.length, duplicates);
  return terms;
}

/** variables を読む。行の語彙は宣言された vocabulary に閉じていなければならない。 */
function parseVariables(
  root: YamlReader,
  vocabulary: Readonly<Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>>,
  reporter: SpecReporter,
): readonly ConfigVariableDecl[] {
  const items = root.optionalList(
    'variables',
    'variables は "- id / kind / requirement / used_by / summary / absence" のリストで書く',
  );
  const variables: ConfigVariableDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(
    items,
    'variables',
    reporter,
    'id と kind と requirement と used_by と summary と absence を持つ要素として書く',
    (item, index) => {
      const id = item.requiredString('id', 'id に環境変数名(SCREAMING_SNAKE)を書く');
      if (id === null) return;
      if (!ENV_NAME.test(id)) {
        reporter.error(
          item.pointer('id'),
          `設定 ${id} が環境変数名の形(SCREAMING_SNAKE)ではありません`,
          '実装の process.env 参照と同じ文字列にする(K1 がこの文字列で突き合わせる)',
          { id },
        );
        return;
      }
      if (seen.has(id)) {
        reporter.error(`variables[${index}].id`, `設定 ${id} が重複しています`, '重複した行を削除する', { id });
        duplicates += 1;
        return;
      }
      seen.add(id);
      const decl = buildDecl(item, id, vocabulary, reporter);
      if (decl !== null) variables.push(decl);
    },
  );
  reporter.settleRows(items.length, variables.length, duplicates);
  return variables;
}

/** 1 行分を読む。1 つでも読めなければ行ごと落とす。 */
function buildDecl(
  item: YamlReader,
  id: string,
  vocabulary: Readonly<Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>>,
  reporter: SpecReporter,
): ConfigVariableDecl | null {
  const axes = parseSingleAxes(item, vocabulary, reporter);
  if (axes === null) return null;
  const usedBy = parseUsedBy(item, id, vocabulary, reporter);
  if (usedBy === null) return null;
  const provision = parseProvision(item, vocabulary, reporter);
  if (provision === null) return null;
  const targets = resolveTargets(item, id, axes.requirement, vocabulary, reporter);
  if (targets === null) return null;
  const summary = item.requiredString('summary', 'summary に「何を制御するか」を 1 行で書く');
  if (summary === null) return null;
  const absence = item.requiredString(
    'absence',
    'absence に「無いとどうなるか」を書く(必須かどうかを言い換えでなく挙動で宣言する)',
  );
  if (absence === null) return null;
  const urlFormat = parseUrlFormat(item, id, reporter);
  if (urlFormat === null) return null;
  const secretDecls = parseSecretDecls(item, id, reporter);
  if (secretDecls === null) return null;
  const reason = item.optionalString(
    'not_in_template_reason',
    'not_in_template_reason に「なぜ app/.env.example に雛形の行を置かないか」を書く',
  );

  return {
    id,
    kind: axes.kind,
    requirement: axes.requirement,
    usedBy,
    provision,
    targets,
    summary,
    absence,
    ...urlFormat,
    ...secretDecls,
    ...(reason === undefined ? {} : { notInTemplateReason: reason }),
    location: reporter.location(`variables.${id}`),
  };
}

/** カタログが宣言した語彙に閉じている単一値の軸(`kind` / `requirement`)を読む。 */
function parseSingleAxes(
  item: YamlReader,
  vocabulary: Readonly<Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>>,
  reporter: SpecReporter,
): Record<ConfigSingleAxis, string> | null {
  const values = {} as Record<ConfigSingleAxis, string>;
  for (const axis of CONFIG_SINGLE_AXES) {
    const value = item.requiredString(axis, `${axis} を vocabulary.${axis} に宣言した語から選ぶ`);
    if (value === null) return null;
    if (!knows(vocabulary, axis, value)) {
      reportUnknownTerm(item.pointer(axis), axis, value, vocabulary, reporter);
      return null;
    }
    values[axis] = value;
  }
  return values;
}

/** `used_by`(1 つ以上のリスト)を読む。連携カタログを兼ねる軸なので空を許さない。 */
function parseUsedBy(
  item: YamlReader,
  id: string,
  vocabulary: Readonly<Record<ConfigVocabularyAxis, readonly ConfigTermDecl[]>>,
  reporter: SpecReporter,
): readonly string[] | null {
  const suggestion = 'used_by に「何が使うか」を vocabulary.used_by の語で 1 つ以上書く';
  const values = item.requiredStringList('used_by', suggestion, false);
  if (values === null) return null;
  const seen = new Set<string>();
  for (const value of values) {
    if (!knows(vocabulary, 'used_by', value)) {
      reportUnknownTerm(item.pointer('used_by'), 'used_by', value, vocabulary, reporter);
      return null;
    }
    if (seen.has(value)) {
      reporter.error(
        item.pointer('used_by'),
        `設定 ${id} の used_by に ${value} が重複しています`,
        '重複した語を削除する',
        { id, used_by: value },
      );
      return null;
    }
    seen.add(value);
  }
  return values;
}
