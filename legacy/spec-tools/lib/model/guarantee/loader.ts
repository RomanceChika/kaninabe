/**
 * 保証台帳(docs/specs/backend/guarantees.md)を読む I/O 境界。
 *
 * 1 プロジェクト 1 ファイルなので、ディレクトリ走査ではなくファイル 1 枚を読む
 * (notification_spec / job_spec / config_spec / auth_spec と同じ形)。YAML → モデルの変換は
 * parse-guarantee の純粋関数に委ね、ここは読めない環境で壊れないことだけを担保する
 * (規約: scripts-code-quality.md)。
 */

import { readFileSync } from 'node:fs';
import type { Finding } from '../../kernel/finding.js';
import { SpecReporter } from '../parse-common.js';
import { parseSafeFrontmatter } from '../safe-frontmatter.js';
import { detectRepoRoot, isFile, toRelative } from '../../io/paths.js';
import type { LedgerOwner } from '../../kernel/ledger-owner.js';
import type { GuaranteeSpecModel } from './types.js';
import { parseGuaranteeCatalog } from './parse-guarantee.js';

/** ローダーが積む Finding の検証器 ID。ローダーが担うのは Z0(スキーマ適合)のみ。 */
export const Z0_VERIFIER_ID = 'Z0';

/** ローダーの任意設定。 */
export interface LoadGuaranteeOptions {
  /** Finding の location.file をこのディレクトリからの相対パスにする。省略時は製品の根の宣言(product.md)を上に探す。 */
  readonly repoRoot?: string;
  /** 台帳の持ち主(省略は製品)。仕組みの台帳は名前空間の予約と文書 ID が別(namespace.ts)。仕組みの台帳は `framework-loader.ts` が読む。 */
  readonly owner?: LedgerOwner;
}

/** loadGuaranteeSpecModel の結果。 */
export interface LoadGuaranteeResult {
  /** 構築したモデル。ファイルが無い場合は `available: false` の空モデル。 */
  readonly model: GuaranteeSpecModel;
  /** 構築中に検出した Z0 違反。 */
  readonly findings: Finding[];
  /**
   * 読めずにモデルへ入れなかった行(リストの要素・必須のリスト)の数。0 なら、`findings` に error が残っていてもモデルは欠けていない
   * (未知のキー・id の重複で先の行が残る形は行を落とさない)。ファイルを読めない・壊れているときは 0(モデル自体が無いので別の理由で阻害になる)。
   */
  readonly dropped: number;
}

/**
 * 保証台帳を読んでモデルを構築する。
 *
 * ファイルが無い場合は「保証台帳をまだ開設していない」を意味する正常な状態として
 * `available: false` の空モデルを返す(他のカタログと同じ扱い)。
 *
 * @param file docs/specs/backend/guarantees.md の絶対パス
 * @param options 相対パス基準などの任意設定
 * @returns モデルと Z0 違反のリスト
 */
export function loadGuaranteeSpecModel(
  file: string,
  options: LoadGuaranteeOptions = {},
): LoadGuaranteeResult {
  if (!isFile(file)) return missingGuaranteeSpecModel();

  const repoRoot = options.repoRoot ?? detectRepoRoot(file);
  const reporter = new SpecReporter(toRelative(repoRoot, file));
  const source = readText(file, reporter);
  const data = source === null ? null : parseSafeFrontmatter(source, reporter);
  if (data === null) {
    return { model: { available: true, catalog: null }, findings: reporter.findings().map(rebrand), dropped: 0 };
  }

  const result = parseGuaranteeCatalog(data, reporter, { owner: options.owner ?? 'product' });
  return { model: { available: true, catalog: result.value }, findings: result.findings.map(rebrand), dropped: reporter.droppedCount() };
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
 * 保証台帳側のスキーマ違反であることが分かるよう Z0 に付け替える。
 */
function rebrand(finding: Finding): Finding {
  return { ...finding, verifier: Z0_VERIFIER_ID };
}

/**
 * 保証台帳の置き場が無いときの読み込みの結果(`available: false` の空モデル)。
 *
 * **ファイルを読まない純粋な値**である。ローダー自身の「置き場が無い」の分岐と、製品が採っていない種類の入力(読まない)が
 * 同じ値を作るための 1 本(予約の名前の置き場を読みに行かせる形は、その名前に有効な仕様が置かれると前提が崩れる)。
 */
export function missingGuaranteeSpecModel(): LoadGuaranteeResult {
  return { model: { available: false, catalog: null }, findings: [], dropped: 0 };
}
