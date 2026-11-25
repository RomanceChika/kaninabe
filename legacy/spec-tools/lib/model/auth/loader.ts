/**
 * 認証フロー仕様(docs/specs/backend/auth.md)を読む I/O 境界。
 *
 * 1 プロジェクト 1 ファイルなので、ディレクトリ走査ではなくファイル 1 枚を読む
 * (notification_spec / job_spec / config_spec と同じ形)。YAML → モデルの変換は
 * parse-auth の純粋関数に委ね、ここは読めない環境で壊れないことだけを担保する
 * (規約: scripts-code-quality.md)。
 */

import { readFileSync } from 'node:fs';
import type { Finding } from '../../kernel/finding.js';
import { SpecReporter } from '../parse-common.js';
import { parseSafeFrontmatter } from '../safe-frontmatter.js';
import { detectRepoRoot, isFile, toRelative } from '../../io/paths.js';
import type { AuthSpecModel } from './types.js';
import { parseAuthFlow } from './parse-auth.js';

/** ローダーが積む Finding の検証器 ID。ローダーが担うのは H0(スキーマ適合)のみ。 */
export const H0_VERIFIER_ID = 'H0';

/** ローダーの任意設定。 */
export interface LoadAuthOptions {
  /** Finding の location.file をこのディレクトリからの相対パスにする。省略時は製品の根の宣言(product.md)を上に探す。 */
  readonly repoRoot?: string;
}

/** loadAuthSpecModel の結果。 */
export interface LoadAuthResult {
  /** 構築したモデル。ファイルが無い場合は `available: false` の空モデル。 */
  readonly model: AuthSpecModel;
  /** 構築中に検出した H0 違反。 */
  readonly findings: Finding[];
  /**
   * 読めずにモデルへ入れなかった行(リストの要素・必須のリスト)の数。0 なら、`findings` に error が残っていてもモデルは欠けていない
   * (未知のキー・id の重複で先の行が残る形は行を落とさない)。ファイルを読めない・壊れているときは 0(モデル自体が無いので別の理由で阻害になる)。
   */
  readonly dropped: number;
}

/**
 * 認証フロー仕様を読んでモデルを構築する。
 *
 * ファイルが無い場合は「認証フロー仕様をまだ開設していない」を意味する正常な状態として
 * `available: false` の空モデルを返す(他のカタログと同じ扱い)。
 *
 * @param file docs/specs/backend/auth.md の絶対パス
 * @param options 相対パス基準などの任意設定
 * @returns モデルと H0 違反のリスト
 */
export function loadAuthSpecModel(file: string, options: LoadAuthOptions = {}): LoadAuthResult {
  if (!isFile(file)) return missingAuthSpecModel();

  const repoRoot = options.repoRoot ?? detectRepoRoot(file);
  const reporter = new SpecReporter(toRelative(repoRoot, file));
  const source = readText(file, reporter);
  const data = source === null ? null : parseSafeFrontmatter(source, reporter);
  if (data === null) {
    return { model: { available: true, flow: null }, findings: reporter.findings().map(rebrand), dropped: 0 };
  }

  const result = parseAuthFlow(data, reporter);
  return { model: { available: true, flow: result.value }, findings: result.findings.map(rebrand), dropped: reporter.droppedCount() };
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
 * 認証フロー仕様側のスキーマ違反であることが分かるよう H0 に付け替える。
 */
function rebrand(finding: Finding): Finding {
  return { ...finding, verifier: H0_VERIFIER_ID };
}

/**
 * 認証フロー仕様の置き場が無いときの読み込みの結果(`available: false` の空モデル)。
 *
 * **ファイルを読まない純粋な値**である。ローダー自身の「置き場が無い」の分岐と、製品が採っていない種類の入力(読まない)が
 * 同じ値を作るための 1 本(予約の名前の置き場を読みに行かせる形は、その名前に有効な仕様が置かれると前提が崩れる)。
 */
export function missingAuthSpecModel(): LoadAuthResult {
  return { model: { available: false, flow: null }, findings: [], dropped: 0 };
}
