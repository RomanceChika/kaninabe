/**
 * K1 設定カタログ ⇔ 実装の `process.env` 参照の双方向閉世界。
 *
 * config-spec-writing.md の要求:
 *   - 実装が読んでいる設定は、すべてカタログに行を持つこと(**暗黙の設定を作らない**)
 *   - カタログの行は、すべてどこかの実装から読まれていること(死んだ宣言を残さない)
 *
 * J2 が `app/vercel.json` の Cron 登録と閉じるのと同じ形である。「何を設定すれば動くか」は
 * これまで実装の `process.env` と雛形のコメントの中にしか無く、引き継ぎのたびに読み解く
 * 対象だった。片方だけ足すとここで落ちる。
 */

import type { Finding } from '../../kernel/finding.js';
import { absentFor } from '../../kernel/scope-owner.js';
import { CONFIG_CATALOG_ID } from '../../model/config/parse-config.js';
import type { ConfigSpecModel } from '../../model/config/types.js';
import type { EnvScanResult, TargetScanResult } from '../env-scan.js';
import { envScanRoots } from '../env-scan.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'K1';

/** K1 の指摘を組み立てる。 */
function k1Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** K1 の入力(走査は I/O 境界が済ませてある)。 */
export interface EnvParityInput {
  /** 読み込み済みの設定カタログ。 */
  readonly config: ConfigSpecModel;
  /** 実装側の走査結果(`available: false` なら何も見ない)。 */
  readonly scan: EnvScanResult;
  /**
   * 置き場の読み口(`vocabulary.target[].read_by`)の走査結果。
   *
   * 実装の `process.env` に現れない設定 —— CI の workflow だけが `secrets.NAME` で読む行 ——
   * も「誰かが読んでいる」側に数える。これが無いとカタログに載せた途端に
   * 「誰も読んでいません」で落ち、**CD が要る設定をカタログの閉世界の外に置く**という
   * 元の穴に戻る(設計メモ §1-1 の穴 3)。
   */
  readonly targetScan: TargetScanResult;
  /** 製品が宣言した根(道案内のパスを組み立てる)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(走査した置き場の道案内を組み立てる)。 */
  readonly layout: ProductLayout;
}

/**
 * カタログの宣言と実装の参照を双方向に突き合わせる。
 *
 * @param input カタログと走査結果
 * @returns 違反のリスト
 */
export function verifyEnvReferenceParity(input: EnvParityInput): Finding[] {
  const catalog = input.config.catalog;
  if (catalog === null || !input.scan.available) return [];

  const declared = new Map(catalog.variables.map((decl) => [decl.id, decl]));
  const findings: Finding[] = [];
  const references = [...input.scan.references, ...input.targetScan.references];

  const reported = new Set<string>();
  for (const reference of references) {
    if (declared.has(reference.name) || reported.has(reference.name)) continue;
    reported.add(reference.name);
    findings.push(
      k1Finding({
        message: `${reference.file} が読んでいる設定 ${reference.name} が設定カタログにありません`,
        location: catalog.location,
        suggestion:
          `${specPath(input.roots, 'backend/config.md')} の variables に "- id: ${reference.name}" の行を足す` +
          '(何を設定すれば動くかが実装の中にしか無い状態は、引き継ぎで最初に詰まる暗黙の挙動である)',
        counterexample: { variable: reference.name, file: reference.file },
      }),
    );
  }

  const used = new Set(references.map((reference) => reference.name));
  for (const decl of catalog.variables) {
    if (used.has(decl.id)) continue;
    const unread = k1Finding({
      message: `カタログの設定 ${decl.id} を読んでいる実装がありません`,
      location: decl.location,
      suggestion:
        `${envScanRoots(input.roots, input.layout).join(' / ')} か、置き場の read_by が指す場所のどこかで読むか、` +
        '使わなくなったなら行を消す' +
        '(誰も読まない設定を雛形に残すと、引き継いだ人が埋めようとして時間を溶かす)',
      counterexample: { variable: decl.id },
    });
    findings.push(absentFor({ kind: 'catalog', id: CONFIG_CATALOG_ID }, unread));
  }
  return findings;
}
