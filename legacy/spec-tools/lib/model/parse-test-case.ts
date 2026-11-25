/**
 * action_spec の `test_cases` のパーサー。
 *
 * スキーマの正: action-spec-writing.md §test_cases。
 * `implementation` は `{リポジトリルートからのテストファイルパス}::{テスト名}` 形式で、
 * ここでは形式の分解だけを行う。ファイルの実在とテスト側 `@tc` との突合は A6 が見る。
 * `covers`(意味クラス)も値域として読むだけで、必要な集合を満たすかの判定は A7 が行う。
 */

import { COVERAGE_CLASSES, isCoverageClass, type ActionTestCase, type CoverageClass, type TestCaseType, type TestImplRef } from '../testcase/types.js';
import type { SpecReporter } from './parse-common.js';
import { eachRecord, YamlReader } from './yaml-reader.js';

/** テストケース種別の値域。 */
const TEST_CASE_TYPES: readonly TestCaseType[] = ['unit', 'integration'];

const COVERS_SUGGESTION =
  `covers にこのケースが覆う意味クラスを ${COVERAGE_CLASSES.join(' / ')} から 1 つ以上並べる` +
  '(action-spec-writing.md §covers)';

/**
 * `TC-{AGGREGATE}-{EVENT}-{NNN}`。英大文字・数字・ハイフン・アンダースコアを許す。
 *
 * `retired:`(action-spec-writing.md §test_cases の欠番宣言)も同じ ID 形式を書くため、
 * ここから export して parse-action.ts と共有する(書式の正はこの 1 箇所)。
 */
export const TC_ID = /^TC-[A-Z0-9_]+-[A-Z0-9_]+-\d{3,}$/;

const TEST_CASES_SUGGESTION =
  'test_cases に "- id / type / covers / spec_ids / implementation" を持つ要素を 1 つ以上並べる(template.action_spec.md 参照)';

const IMPL_SUGGESTION =
  'implementation を "{リポジトリルートからのテストファイルパス}::{テスト名}" 形式で書く' +
  '(例: app/src/operation/__tests__/entry/submit.test.ts::下書きから提出できる)';

/**
 * `implementation` を `{パス}::{テスト名}` に分解する。形式違反なら null。
 *
 * 区切りは最初の `::` とする(テスト名側に `::` を含められるようにするため)。
 *
 * @param raw implementation の生文字列
 * @returns 分解結果。区切りが無い・どちらかが空なら null
 */
export function splitImplementation(raw: string): TestImplRef | null {
  const sep = raw.indexOf('::');
  if (sep < 0) return null;
  const file = raw.slice(0, sep).trim();
  const testName = raw.slice(sep + 2).trim();
  if (file === '' || testName === '') return null;
  // `.spec.mts` は app/e2e/ の Playwright スモーク(2026-09-04 拡張。screen_spec だけが指す想定だが、
  // 形式検査はここ 1 箇所で仕様種をまたいで共有しているため、他の仕様種から書いてもここでは弾かない
  // — 実在確認(A6/S8 の 3 段突合)がその参照を機械的に締める)。
  if (!file.endsWith('.test.ts') && !file.endsWith('.test.tsx') && !file.endsWith('.spec.mts')) return null;
  return { raw, file: file.split('\\').join('/'), testName };
}

/**
 * test_cases を読んで ActionTestCase のリストに変換する。
 *
 * 1 件でも読めない要素があってもリスト全体は捨てず、読めた分だけ返す
 * (1 件の書き間違いで残りの指摘が消えないようにするため)。
 *
 * @param root フロントマター全体の読み取り器
 * @param reporter 違反の記録先
 * @returns 読めたテストケース。test_cases 自体を読めない場合は null
 */
export function parseTestCases(root: YamlReader, reporter: SpecReporter): readonly ActionTestCase[] | null {
  const items = root.requiredList('test_cases', TEST_CASES_SUGGESTION);
  if (items === null) return null;
  if (items.length === 0) {
    reporter.error('test_cases', 'test_cases が空です', TEST_CASES_SUGGESTION);
    return null;
  }

  const cases: ActionTestCase[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  eachRecord(items, 'test_cases', reporter, TEST_CASES_SUGGESTION, (reader, index) => {
    const testCase = parseTestCase(reader, index, reporter);
    if (testCase === null) return;
    if (seen.has(testCase.id)) {
      reporter.error(
        `test_cases.${testCase.id}`,
        `テストケース ID ${testCase.id} が同じファイル内で重複しています`,
        'ID は 1 ファイル内で一意にする。連番を振り直すか、重複した要素を削除する',
        { id: testCase.id },
      );
      duplicates += 1;
      return;
    }
    seen.add(testCase.id);
    cases.push(testCase);
  });
  reporter.settleRows(items.length, cases.length, duplicates);
  return cases;
}

/** test_cases の 1 要素を読む。必須項目が欠けていれば null。 */
function parseTestCase(reader: YamlReader, index: number, reporter: SpecReporter): ActionTestCase | null {
  const id = reader.requiredString('id', 'id を "TC-{AGGREGATE}-{EVENT}-{NNN}" 形式で書く');
  const type = parseType(reader, index, id, reporter);
  const specIds = reader.requiredStringList(
    'spec_ids',
    'spec_ids にこのケースが守る仕様の ID(ドメインイベント ID / 不変条件 ID)を 1 つ以上並べる',
    false,
  );
  const implementation = parseImplementation(reader, index, id, reporter);
  const covers = parseCovers(reader, index, id, reporter);
  const byRole = reader.optionalString(
    'by_role',
    'by_role にこのケースが成功として通したロール ID を書く(covers に success を持つケースだけ)',
  );

  if (id === null || type === null || specIds === null || implementation === null) return null;
  if (!TC_ID.test(id)) {
    reporter.error(
      `test_cases[${index}].id`,
      `テストケース ID ${id} が "TC-{AGGREGATE}-{EVENT}-{NNN}" の形式ではありません`,
      'ID を TC-ENTRY-SUBMIT-001 のように「TC- + 集約 + イベント + 3 桁以上の連番」で書く',
      { id },
    );
  }
  return {
    id,
    type,
    specIds,
    ...(covers === null ? {} : { covers }),
    ...(byRole === undefined ? {} : { byRole }),
    implementation,
    location: reporter.location(pointer(index, id)),
  };
}

/**
 * covers を値域として読む。必須。
 *
 * 未記入は「そのケースが何を確かめているか」を宣言していないことを意味し、A7(意味的
 * カバレッジ)の判定に一切寄与しない。宣言の無いケースが混ざると「必要な意味クラスを
 * 満たしている」という A7 の結論が**書き漏らしのぶんだけ甘くなる**ので、未記入はエラーとする
 * (移行期の warning は Phase B W4 で昇格済み)。
 * 書かれているのに値域の外・空リストの場合も、宣言として成立しないのでエラーにする。
 *
 * @returns 読めた意味クラス。未記入・読めない場合は null(covers を持たせない)
 */
function parseCovers(
  reader: YamlReader,
  index: number,
  id: string | null,
  reporter: SpecReporter,
): readonly CoverageClass[] | null {
  const at = pointer(index, id);
  if (!reader.has('covers')) {
    reporter.error(
      `${at}.covers`,
      `${id ?? `test_cases[${index}]`} に covers がありません`,
      COVERS_SUGGESTION,
    );
    return null;
  }
  const raw = reader.requiredStringList('covers', COVERS_SUGGESTION, false);
  if (raw === null) return null;

  const classes: CoverageClass[] = [];
  for (const value of raw) {
    if (isCoverageClass(value)) {
      classes.push(value);
      continue;
    }
    reporter.error(`${at}.covers`, `covers の ${value} は意味クラスではありません`, COVERS_SUGGESTION, {
      actual: value,
      allowed: COVERAGE_CLASSES.join(', '),
    });
  }
  return classes.length === 0 ? null : classes;
}

/** type を値域として読む。 */
function parseType(
  reader: YamlReader,
  index: number,
  id: string | null,
  reporter: SpecReporter,
): TestCaseType | null {
  const suggestion = `type に ${TEST_CASE_TYPES.join(' / ')} のいずれかを書く`;
  const raw = reader.requiredString('type', suggestion);
  if (raw === null) return null;
  const found = TEST_CASE_TYPES.find((candidate) => candidate === raw);
  if (found !== undefined) return found;
  reporter.error(
    `${pointer(index, id)}.type`,
    `type ${raw} は unit / integration のどちらでもありません`,
    suggestion,
    { actual: raw },
  );
  return null;
}

/** implementation を読み、`{パス}::{テスト名}` に分解する。 */
function parseImplementation(
  reader: YamlReader,
  index: number,
  id: string | null,
  reporter: SpecReporter,
): TestImplRef | null {
  const raw = reader.requiredString('implementation', IMPL_SUGGESTION);
  if (raw === null) return null;
  const ref = splitImplementation(raw);
  if (ref !== null) return ref;
  reporter.error(
    `${pointer(index, id)}.implementation`,
    'implementation が "{テストファイルパス}::{テスト名}" の形式ではありません',
    IMPL_SUGGESTION,
    { value: raw },
  );
  return null;
}

/** テストケースの YAML パス。id が読めていれば人間が探しやすい id 形式にする。 */
function pointer(index: number, id: string | null): string {
  return id === null || id === '' ? `test_cases[${index}]` : `test_cases.${id}`;
}
