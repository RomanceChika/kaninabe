/**
 * 設定仕様検証(K 群)の実行口。
 *
 * ローダー(K0)が構築したカタログと、実装・雛形・**置き場の読み口**の走査結果を検証器
 * (K1 / K2 / K3)に流すところまでをまとめる。走査(I/O)はここで済ませ、検証器には純粋な
 * データだけを渡す(規約: scripts-code-quality.md)。チェック内容の正は config-spec-writing.md。
 */

import type { Finding } from '../kernel/finding.js';
import type { ConfigSpecModel } from '../model/config/types.js';
import { readEnvTemplate, scanEnvReferences, scanTargetReaders } from './env-scan.js';
import { CONFIG_STEPS } from './checks.js';
import { scanUrlReads } from './url-read-scan.js';
import { scanSecretReads } from './secret-read-scan.js';
import { describeLogSinkRun } from './log-sink-note.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/** runConfigVerification の入力。 */
export interface ConfigRunInput {
  /** 読み込み済みの設定カタログ(K0 はローダーが済ませてある)。 */
  readonly config: ConfigSpecModel;
  /** リポジトリルートの絶対パス(実装の走査と雛形の読み取りに使う)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(走査する木と雛形の位置)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(ソースの根・E2E・設定の雛形・道具のスクリプトの置き場)。 */
  readonly layout: ProductLayout;
  /** 受信の署名の鍵として指されている設定の id(外部連携カタログの `signature_key`。K6 が `strength` を求める)。省略は無し。 */
  readonly inboundKeys?: readonly string[];
}

/** runConfigVerification の結果。 */
export interface ConfigRunResult {
  readonly findings: Finding[];
  /** カタログがあったか。false なら K1 / K2 は実行していない。 */
  readonly available: boolean;
  /** 読み込めた設定の件数(CLI のサマリ表示用)。 */
  readonly variableCount: number;
  /** 実装を走査できたか(app/ が無い構成では false)。 */
  readonly scanned: boolean;
  /** 読み口を走査できた置き場の数(K3 が見た置き場の本数。CLI のサマリ表示用)。 */
  readonly readerTargetCount: number;
  /** 検査から見えないこと(本番のログの転送先)を名指す行。実行ログが毎回出す。 */
  readonly notes: readonly string[];
}

/**
 * 設定カタログの検証(K1 / K2)を実行する。
 *
 * カタログが無い環境では検証をスキップし、その旨を報告できる形で返す
 * (設定仕様をまだ開設していないリポジトリでも壊れない)。
 *
 * @param input 設定カタログとリポジトリルート
 * @returns 全 Finding と、どこまで実行できたかの情報
 */
export function runConfigVerification(input: ConfigRunInput): ConfigRunResult {
  if (!input.config.available) {
    return { findings: [], available: false, variableCount: 0, scanned: false, readerTargetCount: 0, notes: [] };
  }
  const scan = scanEnvReferences(input.repoRoot, input.roots, input.layout);
  const template = readEnvTemplate(input.repoRoot, input.roots, input.layout);
  const urlReads = scanUrlReads(input.repoRoot, input.roots, input.layout);
  const secretReads = scanSecretReads(input.repoRoot, input.roots, input.layout);
  const targetScan = scanTargetReaders(input.repoRoot, input.config.catalog?.vocabulary.target ?? []);
  return {
    findings: CONFIG_STEPS.flatMap((step) => step.run(input, { scan, template, targetScan, urlReads, secretReads })),
    available: true,
    variableCount: input.config.catalog?.variables.length ?? 0,
    scanned: scan.available,
    readerTargetCount: targetScan.scanned.length,
    notes: describeLogSinkRun(input.config.catalog?.logging),
  };
}
