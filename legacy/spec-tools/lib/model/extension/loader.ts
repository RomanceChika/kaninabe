/**
 * 拡張候補の台帳(`extension-candidates.md`)を読む I/O 境界。
 *
 * 台帳は**仕組みの宿題**であって製品の仕様ではないので、製品の根の宣言(`product.md`)が指す木ではなく、
 * **仕組み自身のパッケージの中**にある(`legacy/spec-tools/`)。置き場は検証される製品が変わっても動かない。
 * このファイルの住所を、実行している検査器の位置から引くのはそのためである(製品の根から導かない)。
 *
 * YAML → モデルの変換は `parse-candidates.ts` の純粋関数に委ね、ここは読めない環境で壊れないことだけを担保する
 * (規約: scripts-code-quality.md)。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Finding } from '../../kernel/finding.js';
import { FRAMEWORK_SPEC_TOOLS_DIR, isFile } from '../../io/paths.js';
import { SpecReporter } from '../parse-common.js';
import { parseSafeFrontmatter } from '../safe-frontmatter.js';
import { parseExtensionLedger } from './parse-candidates.js';
import type { ExtensionLedgerModel } from './types.js';

/** 台帳のファイル名(`legacy/spec-tools/` の直下)。 */
export const EXTENSION_LEDGER_FILE = 'extension-candidates.md';

/** Finding の `location.file` に出す台帳の住所(仕組み自身の住所なので綴りを持ってよい)。 */
export const EXTENSION_LEDGER_DISPLAY = `${FRAMEWORK_SPEC_TOOLS_DIR}/${EXTENSION_LEDGER_FILE}`;

/** 台帳の検証器 ID(スキーマ適合も整合も同じ検査 W5 の判定)。 */
export const EXTENSION_LEDGER_VERIFIER_ID = 'W5';

/**
 * 実行している検査器のパッケージの台帳の絶対パス。
 *
 * @returns `legacy/spec-tools/extension-candidates.md` の絶対パス
 */
export function defaultLedgerFile(): string {
  return fileURLToPath(new URL(`../../../${EXTENSION_LEDGER_FILE}`, import.meta.url));
}

/** loadExtensionLedger の結果。 */
export interface LoadExtensionLedgerResult {
  /** 構築したモデル。ファイルが無い場合は `available: false`。 */
  readonly model: ExtensionLedgerModel;
  /** 構築中に検出したスキーマ違反(W5)。 */
  readonly findings: Finding[];
}

/**
 * 台帳を読んでモデルを構築する。
 *
 * ファイルが無い場合は「台帳を持たない構成」を意味する正常な状態として `available: false` を返す
 * (その場合、警告はすべて未分類として数える)。
 *
 * @param file 台帳の絶対パス
 * @returns モデルとスキーマ違反
 */
export function loadExtensionLedger(file: string): LoadExtensionLedgerResult {
  if (!isFile(file)) return { model: { available: false, ledger: null }, findings: [] };
  const reporter = new SpecReporter(EXTENSION_LEDGER_DISPLAY);
  const source = readText(file, reporter);
  const data = source === null ? null : parseSafeFrontmatter(source, reporter);
  if (data === null) {
    return { model: { available: true, ledger: null }, findings: reporter.findings().map(rebrand) };
  }
  const result = parseExtensionLedger(data, reporter);
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

/** SpecReporter は V1 固定で積むので、台帳の違反と分かるよう W5 に付け替える。 */
function rebrand(finding: Finding): Finding {
  return { ...finding, verifier: EXTENSION_LEDGER_VERIFIER_ID };
}
