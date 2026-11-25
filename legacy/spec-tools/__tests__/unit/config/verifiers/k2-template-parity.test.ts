/**
 * K2(設定カタログ ⇔ 雛形 app/.env.example)のユニットテスト。
 *
 * 規約網羅(config-spec-writing.md §検証):
 *   - 雛形に行が無い設定を落とすこと(引き継いだ人が埋められない設定を作らない)
 *   - 免除(not_in_template_reason)があれば落とさないこと
 *   - 免除を宣言したのに雛形に載っている行を落とすこと(掃除漏れ)
 *   - 雛形にあってカタログに無い行を落とすこと
 *   - 雛形が無い環境では何も言わないこと
 */

import { describe, expect, it } from 'vitest';
import { verifyTemplateParity } from '../../../../lib/config/verifiers/k2-template-parity.js';
import { configModel, configVariable } from '../../../helpers/config-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';

describe('K2: 設定カタログと雛形の双方向', () => {
  it('宣言と雛形が一致していれば違反なし', () => {
    const config = configModel([configVariable('SUPABASE_URL'), configVariable('CRON_SECRET')]);
    expect(verifyTemplateParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, template: ['SUPABASE_URL', 'CRON_SECRET'] })).toEqual([]);
  });

  it('雛形に行が無ければエラー', () => {
    const config = configModel([configVariable('DISCORD_BOT_TOKEN')]);
    const findings = verifyTemplateParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, template: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('K2');
    expect(findings[0]?.message).toBe('設定 DISCORD_BOT_TOKEN が app/.env.example にありません');
  });

  it('理由つきで免除されていれば雛形に無くても違反なし', () => {
    const config = configModel([
      configVariable('WALK_SEED', { notInTemplateReason: '走査のたびに渡すつまみ' }),
    ]);
    expect(verifyTemplateParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, template: [] })).toEqual([]);
  });

  it('免除を宣言したのに雛形に載っていればエラー(掃除漏れ)', () => {
    const config = configModel([
      configVariable('WALK_SEED', { notInTemplateReason: '走査のたびに渡すつまみ' }),
    ]);
    const findings = verifyTemplateParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, template: ['WALK_SEED'] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('not_in_template_reason');
  });

  it('雛形にあってカタログに無い行はエラー', () => {
    const config = configModel([configVariable('SUPABASE_URL')]);
    const findings = verifyTemplateParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, template: ['SUPABASE_URL', 'LEGACY_KEY'] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe('app/.env.example の LEGACY_KEY が設定カタログにありません');
  });

  it('雛形が無い環境では何も言わない', () => {
    const config = configModel([configVariable('SUPABASE_URL')]);
    expect(verifyTemplateParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config, template: null })).toEqual([]);
  });

  it('カタログを読めていない(スキーマ違反)ときは何も言わない', () => {
    expect(verifyTemplateParity({ roots: TEST_ROOTS, layout: TEST_LAYOUT, config: { available: true, catalog: null }, template: [] })).toEqual([]);
  });
});
