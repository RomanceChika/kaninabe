/**
 * external_spec(外部連携カタログ)のパーサー(X0 = スキーマ適合 + 語彙の閉世界)。
 *
 * スキーマの正: external-spec-writing.md。
 * ここで見るのは 1 ファイルの中で閉じる形だけである — `service` が**同じファイルが宣言した
 * 語彙**に載っていること(語彙の一覧を体系側に持たないための形)、`direction` /
 * `effect` / `degrade` / `retry` がフレームワーク固定の値域にあること、そして
 * **条件付き必須の対応**(`effect: write` ⇒ `idempotency` 必須、`outbound` ⇒ `timeout_ms`
 * 必須、`degrade` に応じた `degrade_summary` / `config` の要求)である。
 * 行ごとの読み取りは parse-external-rows.ts が持ち、ここはトップレベルの組み立てと
 * `vocabulary` の読み取りを持つ。
 */

import type { SpecReporter } from '../parse-common.js';
import { checkDocType, META_FRONTMATTER_KEYS, type ParseResult } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { parseTestCases } from '../parse-test-case.js';
import type { ActionTestCase } from '../../testcase/types.js';
import type { ExternalCatalogSpec, ExternalClientUiDecl, ExternalServiceTermDecl, IntegrationDecl } from './types.js';
import { buildIntegration, INTEGRATION_KEYS } from './parse-external-rows.js';
import { anyPackageMatches, isPackageName, isPackagePattern } from './sdk-packages.js';

/** 識別子(スネークケース)。 */
const SNAKE = /^[a-z][a-z0-9_]*$/;

/** カタログの文書 ID(1 プロジェクト 1 カタログなので導出元が無く固定)。 */
export const EXTERNAL_CATALOG_ID = 'external-catalog';

/** external_spec のトップレベルに書けるキー。 */
const SPEC_KEYS: readonly string[] = [...META_FRONTMATTER_KEYS, 'vocabulary', 'integrations', 'test_cases'];

const VOCABULARY_SUGGESTION =
  'vocabulary.service に相手の名前(discord / anthropic / notion / line …)を ' +
  '"- id / label / adapter_root" のリストで宣言する(external-spec-writing.md)';

/** 知らないキーを見つけたときに示す共通の直し方。 */
function unknownKeyHint(allowed: readonly string[]): string {
  return `書けるのは ${allowed.join(' / ')} だけ。綴り違いを直す`;
}

/**
 * 外部連携カタログ 1 ファイル分のフロントマターをパースする。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先(Finding の location.file を持つ)
 * @returns 構築したカタログと X0 違反
 */
export function parseExternalCatalog(
  data: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
): ParseResult<ExternalCatalogSpec> {
  checkDocType(data, 'external_spec', reporter);
  const root = new YamlReader(data, '', reporter);
  root.rejectUnknownKeys(SPEC_KEYS, 'external_spec', unknownKeyHint(SPEC_KEYS));

  const id = root.requiredString('id', `id を ${EXTERNAL_CATALOG_ID} と書く(1 プロジェクト 1 カタログ)`);
  if (id !== null && id !== EXTERNAL_CATALOG_ID) {
    reporter.error('id', `id ${id} はカタログの id ではありません`, `id: ${EXTERNAL_CATALOG_ID} に直す`, {
      id,
      expected: EXTERNAL_CATALOG_ID,
    });
  }
  const services = parseServices(root, reporter);
  const integrations = parseIntegrations(root, services, reporter);
  const testCases = parseOptionalTestCases(root, reporter);

  return {
    value: {
      id: EXTERNAL_CATALOG_ID,
      vocabulary: { service: services },
      integrations,
      testCases,
      location: reporter.location(),
    },
    findings: reporter.findings(),
  };
}

/** vocabulary.service を読む。語彙はカタログ自身が宣言する(アプリの事情)。 */
function parseServices(root: YamlReader, reporter: SpecReporter): readonly ExternalServiceTermDecl[] {
  const raw = root.raw('vocabulary');
  const reader =
    raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)
      ? null
      : new YamlReader(raw as Readonly<Record<string, unknown>>, 'vocabulary', reporter);
  if (reader === null) {
    reporter.error('vocabulary', 'vocabulary がありません', VOCABULARY_SUGGESTION);
    reporter.dropRows();
    return [];
  }
  reader.rejectUnknownKeys(['service'], 'vocabulary', '書けるのは service だけ(external_spec の軸は service のみ)');
  const items = reader.optionalList('service', VOCABULARY_SUGGESTION);
  if (items.length === 0) {
    reporter.error('vocabulary.service', 'vocabulary.service が空です', VOCABULARY_SUGGESTION);
    return [];
  }
  const terms: ExternalServiceTermDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, 'vocabulary.service', reporter, VOCABULARY_SUGGESTION, (item) => {
    const id = item.requiredString('id', 'id に service の語(スネークケース)を書く');
    const adapterRoot = item.requiredString(
      'adapter_root',
      'adapter_root にこの service のアダプタが住むディレクトリ(リポジトリルート相対)を書く',
    );
    const label = item.optionalLabel('label', 'label に人間向けの表示名を書く(未定なら書かない)');
    if (id === null || adapterRoot === null) return;
    if (!SNAKE.test(id)) {
      reporter.error(item.pointer('id'), `service の語 ${id} がスネークケースではありません`, VOCABULARY_SUGGESTION, {
        id,
      });
      return;
    }
    if (seen.has(id)) {
      reporter.error(`vocabulary.service.${id}`, `service の語 ${id} が重複しています`, '重複した要素を削除する', {
        id,
      });
      duplicates += 1;
      return;
    }
    seen.add(id);
    const sdkPackages = parseSdkPackages(item, id, reporter);
    const clientUi = parseClientUi(item, id, sdkPackages, reporter);
    terms.push({ id, adapterRoot, sdkPackages, clientUi, ...(label === undefined ? {} : { label }) });
  });
  reporter.settleRows(items.length, terms.length, duplicates);
  return terms;
}

/** service の語に書けるキー。 */
const SERVICE_KEYS: readonly string[] = ['id', 'label', 'adapter_root', 'sdk_packages', 'client_ui'];

/** `sdk_packages` の直し方。 */
const SDK_SUGGESTION =
  'sdk_packages にこの service の SDK のパッケージ名を並べる(包みの名前 `ai` か、スコープの全部 `@ai-sdk/*`。' +
  '値として import できるのは adapter_root の下と client_ui に名指したファイルだけになる)';

/** `client_ui` の直し方。 */
const CLIENT_UI_SUGGESTION =
  'client_ui は "- file / packages" のリストで書く(file はリポジトリルート相対・packages はこの service の sdk_packages に当たる包みの名前)';

/**
 * service の `sdk_packages` を読む(省略は空)。綴りは包みの名前か `@scope/*` だけ。
 *
 * @param item service の 1 行
 * @param id service の語
 * @param reporter 違反の記録先
 * @returns 書ける形の綴り(宣言順・重複なし)
 */
function parseSdkPackages(item: YamlReader, id: string, reporter: SpecReporter): readonly string[] {
  item.rejectUnknownKeys(SERVICE_KEYS, `vocabulary.service.${id}`, unknownKeyHint(SERVICE_KEYS));
  const packages: string[] = [];
  for (const text of item.optionalStringList('sdk_packages', SDK_SUGGESTION)) {
    if (!isPackagePattern(text)) {
      reporter.error(item.pointer('sdk_packages'), `sdk_packages の ${text} はパッケージの綴りではありません`, SDK_SUGGESTION, { service: id, package: text });
      continue;
    }
    if (!packages.includes(text)) packages.push(text);
  }
  return packages;
}

/**
 * service の `client_ui` を読む(省略は空)。各行の `packages` は同じ service の `sdk_packages` に当たる包みの名前だけ。
 *
 * @param item service の 1 行
 * @param id service の語
 * @param sdkPackages 読んだ `sdk_packages`
 * @param reporter 違反の記録先
 * @returns 読めた行
 */
function parseClientUi(item: YamlReader, id: string, sdkPackages: readonly string[], reporter: SpecReporter): readonly ExternalClientUiDecl[] {
  const rows: ExternalClientUiDecl[] = [];
  eachRecord(item.optionalList('client_ui', CLIENT_UI_SUGGESTION), `vocabulary.service.${id}.client_ui`, reporter, CLIENT_UI_SUGGESTION, (row) => {
    row.rejectUnknownKeys(['file', 'packages'], `vocabulary.service.${id}.client_ui`, unknownKeyHint(['file', 'packages']));
    const file = row.requiredString('file', CLIENT_UI_SUGGESTION);
    const packages = row.requiredStringList('packages', CLIENT_UI_SUGGESTION, false);
    if (file === null || packages === null) return;
    const unfit = packages.filter((name) => !isPackageName(name) || !anyPackageMatches(sdkPackages, name));
    if (unfit.length > 0) {
      reporter.error(row.pointer('packages'), `client_ui の ${file} の packages(${unfit.join(', ')})が service ${id} の sdk_packages に当たる包みの名前ではありません`, CLIENT_UI_SUGGESTION, { service: id, file });
      return;
    }
    rows.push({ file, packages });
  });
  return rows;
}

/** integrations を読む。行の service は宣言された vocabulary.service に閉じていなければならない。 */
function parseIntegrations(
  root: YamlReader,
  services: readonly ExternalServiceTermDecl[],
  reporter: SpecReporter,
): readonly IntegrationDecl[] {
  const suggestion =
    'integrations は "- id / service / direction / effect / port / adapter / config / degrade / ' +
    'timeout_ms / retry / sends / summary" のリストで書く(template.external_spec.md 参照)';
  const items = root.requiredList('integrations', suggestion) ?? [];
  const integrations: IntegrationDecl[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, 'integrations', reporter, suggestion, (item, index) => {
    const id = item.requiredString('id', 'id に連携の名前(スネークケース)を書く');
    if (id === null) return;
    if (!SNAKE.test(id)) {
      reporter.error(item.pointer('id'), `連携 ${id} がスネークケースではありません`, 'スネークケースに直す', { id });
      return;
    }
    if (seen.has(id)) {
      reporter.error(`integrations[${index}].id`, `連携 ${id} が重複しています`, '重複した行を削除する', { id });
      duplicates += 1;
      return;
    }
    seen.add(id);
    item.rejectUnknownKeys(INTEGRATION_KEYS, `連携 ${id}`, unknownKeyHint(INTEGRATION_KEYS));
    const decl = buildIntegration(item, id, services, reporter);
    if (decl !== null) integrations.push(decl);
  });
  reporter.settleRows(items.length, integrations.length, duplicates);
  return integrations;
}

/**
 * test_cases を読む。**このカタログでは任意**(guarantee_spec 等と違い、`test_cases: []` や
 * キー自体の省略も正しい宣言として許す — まだテストが無い連携があってもよいためである)。
 * 1 件以上書いた場合は既存の `parseTestCases`(実装への突合を行う共通処理)へ委ねる。
 */
function parseOptionalTestCases(root: YamlReader, reporter: SpecReporter): readonly ActionTestCase[] {
  if (!root.has('test_cases')) return [];
  const raw = root.raw('test_cases');
  if (Array.isArray(raw) && raw.length === 0) return [];
  return parseTestCases(root, reporter) ?? [];
}
