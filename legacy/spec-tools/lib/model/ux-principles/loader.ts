/**
 * UX 原則の台帳(`docs/specs/frontend/ux-principles.md`)を読む I/O 境界。
 *
 * 1 プロジェクト 1 ファイルなので、ディレクトリ走査ではなくファイル 1 枚を読む
 * (guarantee_spec / term_ledger と同じ形)。YAML → モデルの変換は parse-ux-principles の純粋関数に
 * 委ね、ここは読めない環境で壊れないことだけを担保する(規約: scripts-code-quality.md)。
 */

import { readFileSync } from 'node:fs';
import type { Finding } from '../../kernel/finding.js';
import { SpecReporter } from '../parse-common.js';
import { parseSafeFrontmatter } from '../safe-frontmatter.js';
import { detectRepoRoot, isFile, toRelative } from '../../io/paths.js';
import { parseUxPrinciples } from './parse-ux-principles.js';
import { NO_UX_PRINCIPLES, type UxPrinciplesModel } from './types.js';

/** 台帳の整合の検査の ID(スキーマ適合も、検査器の一覧との突合も、この 1 つ)。 */
export const U8_VERIFIER_ID = 'U8';

/** 台帳の置き場(`specs/frontend` からの相対)。 */
export const UX_PRINCIPLES_FILE = 'ux-principles.md';

/** ローダーの任意設定。 */
export interface LoadUxPrinciplesOptions {
  /** Finding の location.file をこのディレクトリからの相対パスにする。省略時は製品の根の宣言(product.md)を上に探す。 */
  readonly repoRoot?: string;
}

/** loadUxPrinciplesModel の結果。 */
export interface LoadUxPrinciplesResult {
  /** 構築したモデル。ファイルが無い場合は `available: false` の空モデル。 */
  readonly model: UxPrinciplesModel;
  /** 構築中に検出した U8 違反。 */
  readonly findings: Finding[];
  /**
   * 読めずにモデルへ入れなかった行(リストの要素・必須のリスト・読めなかった閾値と属性)の数。0 なら、`findings` に error が残っていても
   * モデルは欠けていない(未知のキー・id の重複で先の行が残る形は行を落とさない)。ファイルを読めない・壊れているときは 0(モデル自体が無いので別の理由で阻害になる)。
   */
  readonly dropped: number;
}

/**
 * 台帳を読んでモデルを構築する。
 *
 * ファイルが無い場合は「台帳をまだ開設していない」を意味する正常な状態として、
 * `available: false` の空モデルを返す(U 群は検査器の定数を既定値として動く)。
 *
 * @param file 台帳(`ux-principles.md`)の絶対パス
 * @param options 相対パス基準などの任意設定
 * @returns モデルと U8 違反のリスト
 */
export function loadUxPrinciplesModel(file: string, options: LoadUxPrinciplesOptions = {}): LoadUxPrinciplesResult {
  if (!isFile(file)) return missingUxPrinciplesModel();

  const repoRoot = options.repoRoot ?? detectRepoRoot(file);
  const reporter = new SpecReporter(toRelative(repoRoot, file));
  const source = readText(file, reporter);
  const data = source === null ? null : parseSafeFrontmatter(source, reporter);
  if (data === null) {
    return { model: { available: true, spec: null }, findings: reporter.findings().map(rebrand), dropped: 0 };
  }
  const result = parseUxPrinciples(data, reporter);
  return { model: { available: true, spec: result.value }, findings: result.findings.map(rebrand), dropped: reporter.droppedCount() };
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

/** SpecReporter はドメイン仕様用に検証器 ID を V1 固定で積むため、台帳側の違反と分かるよう U8 に付け替える。 */
function rebrand(finding: Finding): Finding {
  return { ...finding, verifier: U8_VERIFIER_ID };
}

/**
 * UX 原則の台帳の置き場が無いときの読み込みの結果(`available: false` の空モデル)。
 *
 * **ファイルを読まない純粋な値**である。ローダー自身の「置き場が無い」の分岐と、製品が採っていない種類の入力(読まない)が
 * 同じ値を作るための 1 本(予約の名前の置き場を読みに行かせる形は、その名前に有効な仕様が置かれると前提が崩れる)。
 */
export function missingUxPrinciplesModel(): LoadUxPrinciplesResult {
  return { model: NO_UX_PRINCIPLES, findings: [], dropped: 0 };
}
