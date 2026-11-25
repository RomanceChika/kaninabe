/**
 * specs/backend/actions を走査して ActionSpecModel を構築するローダー。
 *
 * ファイル I/O を行うのはこのモジュール(と scan.ts / CLI)だけであり、
 * YAML → モデルの変換は parse-action / parse-test-case の純粋関数に委ねる
 * (規約: scripts-code-quality.md)。
 * 構築時に検出できるのは A0(スキーマ適合)だけで、A1〜A8・A10〜A12 は検証器がモデルに対して行う。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from '../../kernel/finding.js';
import { asRecord, SpecReporter } from '../parse-common.js';
import { parseSafeFrontmatter } from '../safe-frontmatter.js';
import { YamlReader } from '../yaml-reader.js';
import type { Decl } from '../decl-list.js';
import { declValue, readDeclLists } from '../decl-list.js';
import type { ActionSpec, ActionSpecModel, ScanDecl, TestTagBaselineDecl, UnhandledDecl, UnscannedDecl } from './types.js';
import type { ActionTestCase } from '../../testcase/types.js';
import { parseActionSpec } from './parse-action.js';
import { parseTestCases } from '../parse-test-case.js';
import { detectRepoRoot, isDirectory, isFile, toRelative, walkFiles } from '../../io/paths.js';

/** ローダーが積む Finding の検証器 ID。ローダーが担うのは A0(スキーマ適合)のみ。 */
export const A0_VERIFIER_ID = 'A0';

/** 網羅の宣言(A4 の `unhandled`・A10 の `scans` / `unscanned`・A12 の `test_tag_baseline`)を書く場所。 */
const COVERAGE_FILE = 'README.md';

const UNHANDLED_SUGGESTION =
  'README.md のフロントマターに "unhandled:" を作り、"- event: {machine}.{event}" と "reason: {理由}" を並べる';

const SCANS_SUGGESTION =
  'README.md のフロントマターに "scans:" を作り、"- event: {machine}.{event}" と "implementation: {走査モジュールのパス}" を並べる';

const UNSCANNED_SUGGESTION =
  'README.md のフロントマターに "unscanned:" を作り、"- event: {machine}.{event}" と "reason: {理由}" を並べる';

const TEST_TAG_BASELINE_SUGGESTION =
  'README.md のフロントマター "test_tag_baseline:" の各項目を "- file: {テストファイルの相対パス}" の形で書く';

/** ローダーの任意設定。 */
export interface LoadActionsOptions {
  /**
   * Finding の location.file をこのディレクトリからの相対パスにする。
   * 省略時は rootDir から上に製品の根の宣言(product.md)を探し、見つからなければ rootDir の親を使う。
   */
  readonly repoRoot?: string;
}

/** loadActionSpecModel の結果。 */
export interface LoadActionsResult {
  /** 構築できたモデル。ディレクトリ自体が読めないときだけ null。 */
  readonly model: ActionSpecModel | null;
  /** 構築中に検出した A0 違反。model が非 null でも空とは限らない。 */
  readonly findings: Finding[];
  /**
   * モデルへ入れずに捨てた仕様・宣言の数(読めなかった action_spec のファイル・読めなかった README の宣言)。
   * 0 なら、A0 の違反が残っていてもモデルは欠けていない(id の不一致のように、読めた上での違反)。
   */
  readonly dropped: number;
}

/**
 * specs/backend/actions 配下を走査して Server Action 仕様のモデルを構築する。
 *
 * `{aggregate}/{event}.md` を action_spec として読み、README.md と
 * `template.{doc_type}.md` は読み飛ばす(README.md からは網羅の宣言だけを読む)。
 *
 * @param rootDir specs/backend/actions の絶対パス
 * @param options 相対パス基準などの任意設定
 * @returns モデルと A0 違反のリスト
 */
export function loadActionSpecModel(
  rootDir: string,
  options: LoadActionsOptions = {},
): LoadActionsResult {
  const repoRoot = options.repoRoot ?? detectRepoRoot(rootDir);
  const findings: Finding[] = [];

  if (!isDirectory(rootDir)) return missingActionSpecModel(repoRoot, rootDir);

  const actions: ActionSpec[] = [];
  let dropped = 0;
  for (const absolute of walkFiles(rootDir, isActionSpecFile)) {
    const spec = readActionSpec(absolute, rootDir, repoRoot, findings);
    if (spec === null) dropped += 1;
    else actions.push(spec);
  }
  // README の宣言(unhandled / scans / unscanned / test_tag_baseline)の読み違いは、宣言を落とす(綴り違いのキーも宣言なしに見える)。
  const declFindings = findings.length;
  const coverage = readCoverageDecls(rootDir, repoRoot, findings);
  dropped += findings.length - declFindings;
  return { model: { actions, ...coverage }, findings, dropped };
}

/** action_spec として読む対象か。README と template は仕様ではない。 */
function isActionSpecFile(name: string): boolean {
  if (!name.endsWith('.md')) return false;
  if (name === COVERAGE_FILE) return false;
  return !/^template\..+\.md$/.test(name);
}

/** 1 つの action_spec ファイルを読んでパースする。 */
function readActionSpec(
  absolute: string,
  rootDir: string,
  repoRoot: string,
  findings: Finding[],
): ActionSpec | null {
  const file = toRelative(repoRoot, absolute);
  const reporter = new SpecReporter(file);
  const source = readText(absolute, reporter);
  const data = source === null ? null : parseSafeFrontmatter(source, reporter);
  findings.push(...reporter.findings().map(rebrand));
  if (data === null) return null;

  const result = parseActionSpec(data, file, toRelative(rootDir, absolute));
  findings.push(...result.findings.map(rebrand));
  return result.value;
}

/**
 * actions ルートの README.md から網羅の宣言(A4 の `unhandled`・A10 の `scans` / `unscanned`・
 * A12 の `test_tag_baseline`)を読む。
 *
 * README.md はディレクトリガイドであり、フロントマターの有無やその他のキーは
 * このローダーの関心ではない。読めない・キーが無い場合は空配列(宣言なし)を返し、
 * 書き方が壊れている場合だけ A0 違反を積む。読み方そのものは
 * lib/model/decl-list.ts が持つ(S10 の `unexposed` と同じ規則)。
 */
function readCoverageDecls(
  rootDir: string,
  repoRoot: string,
  findings: Finding[],
): Pick<ActionSpecModel, 'unhandled' | 'scans' | 'unscanned' | 'testTagBaseline'> {
  const absolute = join(rootDir, COVERAGE_FILE);
  const result = readDeclLists({
    absolute,
    file: toRelative(repoRoot, absolute),
    verifierId: A0_VERIFIER_ID,
    specs: [
      { key: 'unhandled', fields: ['event', 'reason'], suggestion: UNHANDLED_SUGGESTION },
      { key: 'scans', fields: ['event', 'implementation'], suggestion: SCANS_SUGGESTION },
      { key: 'unscanned', fields: ['event', 'reason'], suggestion: UNSCANNED_SUGGESTION },
      { key: 'test_tag_baseline', fields: ['file'], suggestion: TEST_TAG_BASELINE_SUGGESTION },
    ],
  });
  findings.push(...result.findings);

  const decls = (key: string): readonly Decl[] => result.decls.get(key) ?? [];
  const scanTestCases = readScanTestCases(rootDir, repoRoot, findings);
  return {
    unhandled: decls('unhandled').map(toUnhandled),
    scans: decls('scans').map((decl) => toScan(decl, scanTestCases)),
    unscanned: decls('unscanned').map(toUnscanned),
    testTagBaseline: decls('test_tag_baseline').map(toTestTagBaseline),
  };
}

/** `unhandled` の 1 件へ写す。 */
function toUnhandled(decl: Decl): UnhandledDecl {
  return { event: declValue(decl, 'event'), reason: declValue(decl, 'reason'), location: decl.location };
}

/** `scans` の 1 件へ写す。 `test_cases` があれば event で引き当てて添える。 */
function toScan(decl: Decl, scanTestCases: ReadonlyMap<string, readonly ActionTestCase[]>): ScanDecl {
  const event = declValue(decl, 'event');
  const testCases = scanTestCases.get(event);
  return {
    event,
    implementation: declValue(decl, 'implementation'),
    ...(testCases === undefined ? {} : { testCases }),
    location: decl.location,
  };
}

/**
 * README.md の `scans[].test_cases`(A10 のテスト義務。任意)を読む。
 *
 * `readDeclLists`(lib/model/decl-list.ts)が読む `scans` は「識別子 + 理由/パス」の
 * 平坦な形しか表せない共通機構であり、`unhandled` / `unscanned` / `test_tag_baseline` と
 * 書式を共有している。ここに `test_cases`(ネストしたリスト)を持ち込むと共通機構の形が
 * 崩れるため、`scans` だけ 2 回目の独立した読み取りを行い、`event` をキーに後から合流させる。
 * `test_cases` を持たない scan 宣言(既存の membership.activate 等)は素通りする——このキーは
 * 「書けるようにする」追加であり、既存の走査宣言に新しい義務を課さない。
 *
 * @returns event → ActionTestCase[] の対応(test_cases が無い/壊れている scan は含まない)
 */
function readScanTestCases(
  rootDir: string,
  repoRoot: string,
  findings: Finding[],
): ReadonlyMap<string, readonly ActionTestCase[]> {
  const result = new Map<string, readonly ActionTestCase[]>();
  const absolute = join(rootDir, COVERAGE_FILE);
  if (!isFile(absolute)) return result;
  const file = toRelative(repoRoot, absolute);

  const topReporter = new SpecReporter(file);
  const source = readText(absolute, topReporter);
  if (source === null) return result;
  const data = parseSafeFrontmatter(source, topReporter);
  const record = data === null ? null : asRecord(data);
  const rawScans = record === null ? undefined : record['scans'];
  if (!Array.isArray(rawScans)) return result;

  rawScans.forEach((item, index) => {
    const itemRecord = asRecord(item);
    if (itemRecord === null || !('test_cases' in itemRecord)) return;
    const event = itemRecord['event'];
    if (typeof event !== 'string' || event === '') return;

    const reporter = new SpecReporter(file);
    const reader = new YamlReader(itemRecord, `scans[${index}]`, reporter);
    const testCases = parseTestCases(reader, reporter);
    findings.push(...reporter.findings().map(rebrand));
    if (testCases !== null) result.set(event, testCases);
  });
  return result;
}

/** `unscanned` の 1 件へ写す。 */
function toUnscanned(decl: Decl): UnscannedDecl {
  return { event: declValue(decl, 'event'), reason: declValue(decl, 'reason'), location: decl.location };
}

/** `test_tag_baseline` の 1 件へ写す。 */
function toTestTagBaseline(decl: Decl): TestTagBaselineDecl {
  return { file: declValue(decl, 'file'), location: decl.location };
}

/** ファイルを読む。読めない場合は違反を記録して null。 */
function readText(absolute: string, reporter: SpecReporter): string | null {
  try {
    return readFileSync(absolute, 'utf8');
  } catch (cause) {
    reporter.error(
      undefined,
      `ファイルを読み込めません: ${cause instanceof Error ? cause.message : String(cause)}`,
      'ファイルの権限とパスを確認する',
    );
    return null;
  }
}

/**
 * SpecReporter はドメイン仕様用に検証器 ID を V1 固定で積むため、
 * action_spec 側のスキーマ違反であることが分かるよう A0 に付け替える。
 */
function rebrand(finding: Finding): Finding {
  return { ...finding, verifier: A0_VERIFIER_ID };
}

/**
 * action_spec の置き場が無いときの読み込みの結果(モデルは null・A0 の「ディレクトリが見つかりません」)。
 *
 * **ファイルを読まない純粋な値**である(パスの相対化だけ)。ローダー自身の「置き場が無い」の分岐と、製品が採っていない種類の
 * 入力(読まない)が同じ値を作るための 1 本(予約の名前の置き場を読みに行かせる形は、その名前に有効な仕様が置かれると前提が崩れる)。
 *
 * @param repoRoot Finding の位置の基準にするリポジトリルート
 * @param rootDir action_spec の置き場の絶対パス(無い・読まない置き場)
 */
export function missingActionSpecModel(repoRoot: string, rootDir: string): LoadActionsResult {
  return {
    model: null,
    findings: [
      {
        verifier: A0_VERIFIER_ID,
        severity: 'error',
        message: 'Server Action 仕様のディレクトリが見つかりません',
        location: { file: toRelative(repoRoot, rootDir) },
        suggestion:
          'specs/backend/actions のパスを確認する。存在しない場合は ARCH-SP-BE-0001 の構成でディレクトリを作る',
      },
    ],
    dropped: 0,
  };
}
