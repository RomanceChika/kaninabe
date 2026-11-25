/**
 * X2(設定への接地)のユニットテスト。
 *
 * 規約網羅(external-spec-writing.md §検証):
 *   - config[] の各 id が config カタログに実在すること
 *   - degrade: not_configured | fallback ⇒ requirement が optional_degrades か production_only
 *   - degrade: refuse ⇒ requirement が required
 *   - **食い違い(縮退すると宣言したのに設定は必須、等)はエラー**
 *   - 設定カタログが未選択なら何も言わない(事実: 無い)・阻害なら判定を出さず、見ていないことを `configGroundingGaps` が名指す
 */

import { describe, expect, it } from 'vitest';
import { configGroundingGaps, verifyConfigGrounding } from '../../../../lib/external/verifiers/x2-config-grounding.js';
import { configCatalog, configVariable } from '../../../helpers/config-builder.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';
import type { ConfigVariableDecl } from '../../../../lib/model/config/types.js';

/** 読込済みの設定カタログの入力の状態。 */
const configModel = (variables: readonly ConfigVariableDecl[]) => loadedInput(configCatalog(variables));
import { externalCatalog, integration } from '../../../helpers/external-builder.js';

describe('X2: 設定への接地', () => {
  it('requirement が degrade と整合していれば違反なし', () => {
    const config = configModel([
      configVariable('DISCORD_NOTICE_WEBHOOK_URL', { requirement: 'optional_degrades' }),
    ]);
    const catalog = externalCatalog([
      integration('discord_webhook', { degrade: 'not_configured', config: ['DISCORD_NOTICE_WEBHOOK_URL'] }),
    ]);

    expect(verifyConfigGrounding({ catalog, config })).toEqual([]);
  });

  it('config が config カタログに実在しなければエラー', () => {
    const config = configModel([configVariable('OTHER_VAR', { requirement: 'optional_degrades' })]);
    const catalog = externalCatalog([
      integration('discord_webhook', { config: ['DISCORD_NOTICE_WEBHOOK_URL'] }),
    ]);

    const findings = verifyConfigGrounding({ catalog, config });

    expect(findings.some((f) => f.message.includes('config カタログに実在しません'))).toBe(true);
  });

  it('degrade: not_configured なのに requirement: required は食い違いでエラー', () => {
    const config = configModel([configVariable('DISCORD_NOTICE_WEBHOOK_URL', { requirement: 'required' })]);
    const catalog = externalCatalog([
      integration('discord_webhook', { degrade: 'not_configured', config: ['DISCORD_NOTICE_WEBHOOK_URL'] }),
    ]);

    const findings = verifyConfigGrounding({ catalog, config });

    expect(
      findings.some(
        (f) => f.message.includes('degrade: not_configured') && f.message.includes('どちらでもない'),
      ),
    ).toBe(true);
  });

  it('degrade: fallback は optional_degrades でも production_only でも通る', () => {
    const config = configModel([
      configVariable('DISCORD_BOT_TOKEN', { requirement: 'production_only' }),
    ]);
    const catalog = externalCatalog([
      integration('discord_guild', {
        degrade: 'fallback',
        effect: 'read',
        config: ['DISCORD_BOT_TOKEN'],
        port: 'GuildMembershipPort',
        adapter: 'app/src/infrastructure/discord/guild.ts',
      }),
    ]);

    expect(verifyConfigGrounding({ catalog, config })).toEqual([]);
  });

  it('degrade: refuse は requirement: required だけが通る', () => {
    const config = configModel([configVariable('CRON_SECRET', { requirement: 'optional_degrades' })]);
    const catalog = externalCatalog([
      integration('discord_webhook', { degrade: 'refuse', config: ['CRON_SECRET'] }),
    ]);

    const findings = verifyConfigGrounding({ catalog, config });

    expect(findings.some((f) => f.message.includes('degrade: refuse なのに') && f.message.includes('required ではない'))).toBe(true);
  });

  it('設定カタログが未選択なら何も見ない(設定カタログは無いという事実。見ていない記録も出さない)', () => {
    const catalog = externalCatalog([
      integration('discord_webhook', { config: ['DISCORD_NOTICE_WEBHOOK_URL'] }),
    ]);

    expect(verifyConfigGrounding({ catalog, config: UNSELECTED })).toEqual([]);
    expect(configGroundingGaps({ catalog, config: UNSELECTED })).toEqual([]);
  });

  it('設定カタログが阻害なら判定を出さず、設定を挙げた連携だけを名指して見ていないと言う(読込済み・設定を挙げない連携は言わない)', () => {
    const catalog = externalCatalog([
      integration('discord_webhook', { config: ['DISCORD_NOTICE_WEBHOOK_URL'] }),
      integration('plain', { config: [], adapter: 'app/src/infrastructure/plain/x.ts', port: 'PlainPort' }),
    ]);

    for (const reason of ['missing', 'load-failed', 'invalid'] as const) {
      const config = blockedInput<never>(reason);

      expect(verifyConfigGrounding({ catalog, config })).toEqual([]);
      const gaps = configGroundingGaps({ catalog, config });
      expect(gaps).toHaveLength(1);
      expect(gaps[0]?.gap).toEqual({ input: 'config', state: 'blocked', reason });
      expect(gaps[0]?.subjects).toEqual(['discord_webhook']);
    }
    expect(configGroundingGaps({ catalog, config: configModel([]) })).toEqual([]);
    expect(configGroundingGaps({ catalog: externalCatalog([integration('plain', { config: [] })]), config: blockedInput<never>() })).toEqual([]);
  });
});
