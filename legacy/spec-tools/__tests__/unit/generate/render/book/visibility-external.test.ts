/**
 * 可視性の章(HTML の本。render/book/html/visibility-chapter.ts)に足した「外部サービスへ送る個人データ」節の
 * テスト。external_spec の `sends.fields` のうち entity_spec で `personal: true` の列だけを
 * 拾い、`personal: false` の列や entity_spec に実在しない参照は無視することを検める
 * (実在チェック自体は X3 の担当。ここは生成が正しく畳むかだけを見る)。
 */

import { describe, expect, it } from 'vitest';
import { bookHtmlPage, pageText } from '../../../../helpers/book-html.js';
import { aggregate, entitySpec, field, specModel } from '../../../../helpers/model-builder.js';
import { GEN_CTX } from '../../../../helpers/generate-context.js';
import { externalModel, integration } from '../../../../helpers/external-builder.js';

/** member(display_name = personal: true / instrument = personal: false)を持つモデル。 */
const DOMAIN = specModel([
  aggregate('member', {
    entity: entitySpec('member', {
      fields: [
        field('display_name', { kind: 'string' }, { personal: true, personalPlaceholder: '(消去済み)' }),
        field('instrument', { kind: 'string' }, { personal: false }),
      ],
    }),
  }),
]);

function content(external: ReturnType<typeof externalModel> | undefined): string {
  const page = bookHtmlPage(DOMAIN, external === undefined ? GEN_CTX : { ...GEN_CTX, external }, 'visibility.html');
  if (page === undefined) throw new Error('章が生成されませんでした');
  return pageText(page);
}

describe('可視性の章(HTML): 外部サービスへ送る個人データ', () => {
  it('personal: true の sends.fields だけを連携・相手とともに出す', () => {
    const external = externalModel([
      integration('anthropic_chat', {
        service: 'anthropic',
        effect: 'read',
        port: 'ChatPort',
        adapter: 'app/src/infrastructure/anthropic/chat.ts',
        config: ['ANTHROPIC_API_KEY'],
        sends: { fields: ['member.display_name', 'member.instrument'] },
      }),
    ]);
    const text = content(external);

    expect(text).toContain('外部サービスへ送る個人データ');
    expect(text).toMatch(/anthropic_chat \| anthropic \| member\.display_name$/m);
    expect(text).not.toContain('member.instrument');
  });

  it('personal な sends.fields が 1 つも無ければ節ごと出さない', () => {
    const external = externalModel([
      integration('discord_guild', {
        service: 'discord',
        effect: 'read',
        port: 'GuildMembershipPort',
        adapter: 'app/src/infrastructure/discord/guild.ts',
        sends: { fields: ['member.instrument'] },
      }),
    ]);
    const text = content(external);

    expect(text).not.toContain('外部サービスへ送る個人データ');
  });

  it('外部連携カタログが無い構成では節を作らない', () => {
    const text = content(undefined);

    expect(text).not.toContain('外部サービスへ送る個人データ');
  });
});
