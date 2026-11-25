/**
 * specs/frontend/usecases を走査して UsecaseSpecModel を構築するローダー。
 *
 * ファイル I/O を行うのはこのモジュール(と CLI)だけであり、YAML → モデルの変換は
 * parse-usecase の純粋関数に委ねる(規約: scripts-code-quality.md)。
 * 構築時に検出できるのは Y0(スキーマ適合)だけで、Y1〜Y11 は検証器がモデルに対して行う。
 *
 * 置き場は 1 ユースケース 1 ファイルのフラットなディレクトリ(`{name}.md`)であり、
 * query_spec / data_table のような集約サブディレクトリは持たない
 * (usecase_spec はドメインの集約に従属しない — 複数の集約をまたいで組み合わせるため)。
 */

import { readFileSync } from 'node:fs';
import type { Finding } from '../../kernel/finding.js';
import { SpecReporter } from '../parse-common.js';
import { parseSafeFrontmatter } from '../safe-frontmatter.js';
import { detectRepoRoot, isDirectory, toRelative, walkFiles } from '../../io/paths.js';
import type { UsecaseSpec, UsecaseSpecModel } from './types.js';
import { parseUsecaseSpec } from './parse-usecase.js';

/** ローダーが積む Finding の検証器 ID。ローダーが担うのは Y0(スキーマ適合)のみ。 */
export const Y0_VERIFIER_ID = 'Y0';

/** ディレクトリガイド・テンプレートは仕様ではないので読み飛ばす。 */
const GUIDE_FILE = 'README.md';

/** ローダーの任意設定。 */
export interface LoadUsecasesOptions {
  /** Finding の location.file をこのディレクトリからの相対パスにする。省略時は製品の根の宣言(product.md)を上に探す。 */
  readonly repoRoot?: string;
}

/** loadUsecaseSpecModel の結果。 */
export interface LoadUsecasesResult {
  /** 構築したモデル。ディレクトリが無い場合は `available: false` の空モデル。 */
  readonly model: UsecaseSpecModel;
  /** 構築中に検出した Y0 違反。空とは限らない。 */
  readonly findings: Finding[];
  /**
   * モデルへ入れずに捨てた仕様・行の数(読めなかった・スキーマに合わなかったファイルと、仕様の中で読めずに落とした行)。0 なら、Y0 の違反が残っていてもモデルは欠けていない。
   */
  readonly dropped: number;
}

/**
 * specs/frontend/usecases 配下を走査してユースケース仕様のモデルを構築する。
 *
 * `{name}.md` を usecase_spec として読み、README.md と `template.usecase_spec.md` は読み飛ばす。
 *
 * ディレクトリが無い場合は「タスクをまだ仕様化していない」を意味する正常な状態として
 * `available: false` の空モデルを返す(query_spec / screen_spec と同じ流儀)。
 *
 * @param rootDir specs/frontend/usecases の絶対パス
 * @param options 相対パス基準などの任意設定
 * @returns モデルと Y0 違反のリスト
 */
export function loadUsecaseSpecModel(
  rootDir: string,
  options: LoadUsecasesOptions = {},
): LoadUsecasesResult {
  if (!isDirectory(rootDir)) return missingUsecaseSpecModel();

  const repoRoot = options.repoRoot ?? detectRepoRoot(rootDir);
  const findings: Finding[] = [];
  const usecases: UsecaseSpec[] = [];
  let dropped = 0;
  for (const absolute of walkFiles(rootDir, isUsecaseSpecFile)) {
    const read = readUsecaseSpec(absolute, rootDir, repoRoot, findings);
    if (read.spec === null) dropped += 1;
    else {
      usecases.push(read.spec);
      dropped += read.dropped;
    }
  }
  return { model: { available: true, usecases }, findings, dropped };
}

/** usecase_spec として読む対象か。README とテンプレートは仕様ではない。 */
function isUsecaseSpecFile(name: string): boolean {
  if (!name.endsWith('.md')) return false;
  if (name === GUIDE_FILE) return false;
  return !/^template\..+\.md$/.test(name);
}

/** 1 つの usecase_spec ファイルを読んでパースする(仕様の中で落とした行の数も返す)。 */
function readUsecaseSpec(
  absolute: string,
  rootDir: string,
  repoRoot: string,
  findings: Finding[],
): { readonly spec: UsecaseSpec | null; readonly dropped: number } {
  const file = toRelative(repoRoot, absolute);
  const reporter = new SpecReporter(file);
  const source = readText(absolute, reporter);
  const data = source === null ? null : parseSafeFrontmatter(source, reporter);
  findings.push(...reporter.findings().map(rebrand));
  if (data === null) return { spec: null, dropped: 0 };

  const result = parseUsecaseSpec(data, file, toRelative(rootDir, absolute));
  findings.push(...result.findings.map(rebrand));
  return { spec: result.value, dropped: result.dropped };
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
 * usecase_spec 側のスキーマ違反であることが分かるよう Y0 に付け替える。
 */
function rebrand(finding: Finding): Finding {
  return { ...finding, verifier: Y0_VERIFIER_ID };
}

/**
 * ユースケース仕様の置き場が無いときの読み込みの結果(`available: false` の空モデル)。
 *
 * **ファイルを読まない純粋な値**である。ローダー自身の「置き場が無い」の分岐と、製品が採っていない種類の入力(読まない)が
 * 同じ値を作るための 1 本(予約の名前の置き場を読みに行かせる形は、その名前に有効な仕様が置かれると前提が崩れる)。
 */
export function missingUsecaseSpecModel(): LoadUsecasesResult {
  return { model: { available: false, usecases: [] }, findings: [], dropped: 0 };
}
