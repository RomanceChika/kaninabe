/**
 * K1(設定カタログ ⇔ 実装の `process.env` 参照)のユニットテスト。
 *
 * 規約網羅(config-spec-writing.md §検証):
 *   - 実装が読んでいてカタログに無い設定を落とすこと(暗黙の設定の禁止)
 *   - カタログにあってどこからも読まれていない設定を落とすこと(死んだ宣言)
 *   - 走査できない環境(app/ が無い)では何も言わないこと
 *   - 置き場の読み口(read_by)だけが読んでいる設定を「誰も読んでいない」にしないこと
 */

import { describe, expect, it } from 'vitest';
import { verifyEnvReferenceParity } from '../../../../lib/config/verifiers/k1-env-reference-parity.js';
import type { EnvScanResult, TargetScanResult } from '../../../../lib/config/env-scan.js';
import { configModel, configVariable } from '../../../helpers/config-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';

/** 読み口の走査結果(既定は「読み口を宣言した置き場が無い」)。 */
const NO_READERS: TargetScanResult = { scanned: [], references: [] };

/** 走査結果を組み立てる。 */
function scan(...names: readonly string[]): EnvScanResult {
  return {
    available: true,
    references: names.map((name) => ({ name, file: 'app/src/infrastructure/supabase/client.ts' })),
  };
}

describe('K1: 設定カタログと実装の参照の双方向', () => {
  it('宣言と参照が過不足なく一致していれば違反なし', () => {
    const config = configModel([configVariable('SUPABASE_URL'), configVariable('CRON_SECRET')]);
    expect(verifyEnvReferenceParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, scan: scan('SUPABASE_URL', 'CRON_SECRET'), targetScan: NO_READERS })).toEqual([]);
  });

  it('同じ設定が何度参照されていても違反にならない', () => {
    const config = configModel([configVariable('SUPABASE_URL')]);
    expect(
      verifyEnvReferenceParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, scan: scan('SUPABASE_URL', 'SUPABASE_URL'), targetScan: NO_READERS }),
    ).toEqual([]);
  });

  it('カタログに無い設定を実装が読んでいればエラー', () => {
    const config = configModel([configVariable('SUPABASE_URL')]);
    const findings = verifyEnvReferenceParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, scan: scan('SUPABASE_URL', 'STRIPE_SECRET'), targetScan: NO_READERS });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('K1');
    expect(findings[0]?.message).toContain('STRIPE_SECRET');
  });

  it('カタログに無い設定が複数の場所で読まれていても指摘は 1 件', () => {
    const config = configModel([]);
    const findings = verifyEnvReferenceParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, scan: scan('STRIPE_SECRET', 'STRIPE_SECRET'), targetScan: NO_READERS });
    expect(findings).toHaveLength(1);
  });

  it('誰も読んでいない設定がカタログにあればエラー', () => {
    const config = configModel([configVariable('SUPABASE_URL'), configVariable('OLD_FLAG')]);
    const findings = verifyEnvReferenceParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, scan: scan('SUPABASE_URL'), targetScan: NO_READERS });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe('カタログの設定 OLD_FLAG を読んでいる実装がありません');
  });

  it('app/ が無い環境(走査できない)では何も言わない', () => {
    const config = configModel([configVariable('SUPABASE_URL')]);
    expect(
      verifyEnvReferenceParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, scan: { available: false, references: [] }, targetScan: NO_READERS }),
    ).toEqual([]);
  });

  it('置き場の読み口だけが読んでいる設定は「誰も読んでいない」にならない', () => {
    const config = configModel([configVariable('SUPABASE_ACCESS_TOKEN', { targets: ['ci'] })]);
    const targetScan: TargetScanResult = {
      scanned: ['ci'],
      references: [
        { name: 'SUPABASE_ACCESS_TOKEN', file: '.github/workflows/ci.yml', target: 'ci' },
      ],
    };
    expect(verifyEnvReferenceParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, scan: scan(), targetScan })).toEqual([]);
  });

  it('読み口だけにあってカタログに無い設定はエラー', () => {
    const config = configModel([]);
    const targetScan: TargetScanResult = {
      scanned: ['ci'],
      references: [{ name: 'DEPLOY_HOOK_URL', file: '.github/workflows/ci.yml', target: 'ci' }],
    };
    const findings = verifyEnvReferenceParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, scan: scan(), targetScan });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('DEPLOY_HOOK_URL');
  });

  it('カタログを読めていない(スキーマ違反)ときは何も言わない', () => {
    const config = { available: true, catalog: null };
    expect(verifyEnvReferenceParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, scan: scan('SUPABASE_URL'), targetScan: NO_READERS })).toEqual([]);
  });
});
