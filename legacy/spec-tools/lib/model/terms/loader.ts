/**
 * 用語の台帳(`terms.md`)を読む I/O 境界。
 *
 * 1 プロジェクト 1 ファイルなので、ディレクトリ走査ではなくファイル 1 枚を読む
 * (guarantee_spec / notification_spec と同じ形)。YAML → モデルの変換は parse-terms の純粋関数に
 * 委ね、ここは読めない環境で壊れないことだけを担保する(規約: scripts-code-quality.md)。
 */

import { readFileSync } from 'node:fs';
import type { Finding } from '../../kernel/finding.js';
import { SpecReporter } from '../parse-common.js';
import { parseSafeFrontmatter } from '../safe-frontmatter.js';
import { detectRepoRoot, isFile, toRelative } from '../../io/paths.js';
import type { TermLedgerModel } from './types.js';
import { parseTermLedger } from './parse-terms.js';

/**
 * ローダーが積む Finding の検証器 ID(台帳のスキーマ適合。error)。
 *
 * 1 つの ID が 1 つの検査を指すように、走査範囲の検査(`docs/run.ts` の `M0`。warning)とは別の番号を当てる。
 * 10 番は `summary:` の語の接地(M10。`verifiers/m10-summary-grounding.ts`)に使ったので、その次の 11 番である。
 */
export const LEDGER_SCHEMA_VERIFIER_ID = 'M11';

/** ローダーの任意設定。 */
export interface LoadTermLedgerOptions {
  /** Finding の location.file をこのディレクトリからの相対パスにする。省略時は製品の根の宣言(product.md)を上に探す。 */
  readonly repoRoot?: string;
}

/** loadTermLedgerModel の結果。 */
export interface LoadTermLedgerResult {
  /** 構築したモデル。ファイルが無い場合は `available: false` の空モデル。 */
  readonly model: TermLedgerModel;
  /** 構築中に検出した M11 違反(台帳のスキーマ違反)。 */
  readonly findings: Finding[];
}

/**
 * 台帳を読んでモデルを構築する。
 *
 * ファイルが無い場合は「台帳をまだ開設していない」を意味する正常な状態として
 * `available: false` の空モデルを返す(他のカタログと同じ扱い)。
 *
 * @param file 台帳(`terms.md`)の絶対パス
 * @param options 相対パス基準などの任意設定
 * @returns モデルと M11 違反のリスト
 */
export function loadTermLedgerModel(file: string, options: LoadTermLedgerOptions = {}): LoadTermLedgerResult {
  if (!isFile(file)) return { model: { available: false, ledger: null }, findings: [] };

  const repoRoot = options.repoRoot ?? detectRepoRoot(file);
  const reporter = new SpecReporter(toRelative(repoRoot, file));
  const source = readText(file, reporter);
  const data = source === null ? null : parseSafeFrontmatter(source, reporter);
  if (data === null) {
    return { model: { available: true, ledger: null }, findings: reporter.findings().map(rebrand) };
  }
  const result = parseTermLedger(data, reporter);
  return { model: { available: true, ledger: result.value }, findings: result.findings.map(rebrand) };
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

/** SpecReporter はドメイン仕様用に検証器 ID を V1 固定で積むため、台帳のスキーマ違反と分かるよう M11 に付け替える。 */
function rebrand(finding: Finding): Finding {
  return { ...finding, verifier: LEDGER_SCHEMA_VERIFIER_ID };
}
