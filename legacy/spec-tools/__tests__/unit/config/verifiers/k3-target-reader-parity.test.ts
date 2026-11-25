/**
 * K3(置き場の宣言 `targets` ⇔ その置き場の読み口 `read_by`)のユニットテスト。
 *
 * 規約網羅(config-spec-writing.md §検証):
 *   - `targets` にその置き場を持つのに読み口が読んでいない行を落とすこと
 *   - 読み口が読んでいるのに `targets` にその置き場が無い行を落とすこと(取り違え)
 *   - 読み口を宣言していない置き場については何も言わないこと
 *   - カタログに 1 行も無い名前は K1 の領分として指摘しないこと(1 つの間違いに 2 つの指摘を出さない)
 */

import { describe, expect, it } from 'vitest';
import { verifyTargetReaderParity } from '../../../../lib/config/verifiers/k3-target-reader-parity.js';
import type { TargetScanResult } from '../../../../lib/config/env-scan.js';
import { configModel, configVariable } from '../../../helpers/config-builder.js';

/** CI の読み口が name を読んでいる、という走査結果を作る。 */
function ciReaders(...names: readonly string[]): TargetScanResult {
  return {
    scanned: ['ci'],
    references: names.map((name) => ({ name, file: '.github/workflows/ci.yml', target: 'ci' })),
  };
}

describe('K3: 置き場の宣言と読み口の双方向', () => {
  it('宣言と読み口が一致していれば違反なし', () => {
    const config = configModel([
      configVariable('SUPABASE_ACCESS_TOKEN', { targets: ['ci'] }),
      configVariable('SUPABASE_URL'),
    ]);
    expect(
      verifyTargetReaderParity({ config, targetScan: ciReaders('SUPABASE_ACCESS_TOKEN') }),
    ).toEqual([]);
  });

  it('targets にその置き場を持つのに読み口が読んでいなければエラー', () => {
    const config = configModel([configVariable('SUPABASE_DB_PASSWORD', { targets: ['ci'] })]);
    const findings = verifyTargetReaderParity({ config, targetScan: ciReaders() });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('K3');
    expect(findings[0]?.message).toBe(
      '設定 SUPABASE_DB_PASSWORD は targets に ci を持つのに、その置き場の読み口が読んでいません',
    );
  });

  it('読み口が読んでいるのに targets にその置き場が無ければエラー(置き場の取り違え)', () => {
    const config = configModel([configVariable('SUPABASE_ACCESS_TOKEN')]);
    const findings = verifyTargetReaderParity({ config, targetScan: ciReaders('SUPABASE_ACCESS_TOKEN') });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe(
      '.github/workflows/ci.yml が読んでいる設定 SUPABASE_ACCESS_TOKEN の targets に ci がありません',
    );
  });

  it('カタログに 1 行も無い名前は指摘しない(K1 が「宣言がありません」で落とす)', () => {
    const config = configModel([]);
    expect(verifyTargetReaderParity({ config, targetScan: ciReaders('GITHUB_TOKEN') })).toEqual([]);
  });

  it('読み口を宣言した置き場が無ければ何も言わない', () => {
    const config = configModel([configVariable('SUPABASE_ACCESS_TOKEN', { targets: ['ci'] })]);
    expect(verifyTargetReaderParity({ config, targetScan: { scanned: [], references: [] } })).toEqual([]);
  });

  it('カタログを読めていない(スキーマ違反)ときは何も言わない', () => {
    const config = { available: true, catalog: null };
    expect(verifyTargetReaderParity({ config, targetScan: ciReaders('SUPABASE_ACCESS_TOKEN') })).toEqual([]);
  });
});
