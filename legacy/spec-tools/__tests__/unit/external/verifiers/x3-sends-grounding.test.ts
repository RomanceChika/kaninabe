/**
 * X3(送る情報の接地)のユニットテスト。
 *
 * 規約網羅(external-spec-writing.md §検証):
 *   - sends.fields[] の entity.field が entity_spec に実在すること
 *   - 存在しない entity・存在しないフィールドはエラー
 *   - "." を含まない参照(形式違反)もエラー
 *   - text だけの sends(fields が空)は何も見ない
 */

import { describe, expect, it } from 'vitest';
import { verifySendsGrounding } from '../../../../lib/external/verifiers/x3-sends-grounding.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import { externalCatalog, integration } from '../../../helpers/external-builder.js';

/** member.display_name を持つ最小ドメインモデル。 */
const DOMAIN = specModel([
  aggregate('member', { entity: entitySpec('member', { fields: [field('display_name', { kind: 'string' })] }) }),
]);

describe('X3: 送る情報の接地', () => {
  it('実在する entity.field なら違反なし', () => {
    const catalog = externalCatalog([
      integration('anthropic_chat', {
        service: 'anthropic',
        effect: 'read',
        port: 'ChatPort',
        adapter: 'app/src/infrastructure/anthropic/chat.ts',
        config: ['ANTHROPIC_API_KEY'],
        sends: { fields: ['member.display_name'] },
      }),
    ]);

    expect(verifySendsGrounding(DOMAIN, catalog)).toEqual([]);
  });

  it('存在しない entity を指すとエラー', () => {
    const catalog = externalCatalog([
      integration('anthropic_chat', { sends: { fields: ['piece.title'] } }),
    ]);

    const findings = verifySendsGrounding(DOMAIN, catalog);

    expect(findings.some((f) => f.verifier === 'X3' && f.message.includes('piece.title'))).toBe(true);
  });

  it('存在するエンティティの存在しないフィールドを指すとエラー', () => {
    const catalog = externalCatalog([
      integration('anthropic_chat', { sends: { fields: ['member.nonexistent'] } }),
    ]);

    const findings = verifySendsGrounding(DOMAIN, catalog);

    expect(findings.some((f) => f.message.includes('member.nonexistent'))).toBe(true);
  });

  it('"." を含まない参照は形式違反としてエラー', () => {
    const catalog = externalCatalog([
      integration('anthropic_chat', { sends: { fields: ['display_name'] } }),
    ]);

    const findings = verifySendsGrounding(DOMAIN, catalog);

    expect(findings.some((f) => f.message.includes('display_name'))).toBe(true);
  });

  it('text だけの sends(fields 空)は違反なし', () => {
    const catalog = externalCatalog([
      integration('discord_webhook', { sends: { fields: [], text: '生成した本文' } }),
    ]);

    expect(verifySendsGrounding(DOMAIN, catalog)).toEqual([]);
  });
});
