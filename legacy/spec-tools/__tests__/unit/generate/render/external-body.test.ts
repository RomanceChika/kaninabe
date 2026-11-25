/**
 * external-body / book-external のユニットテスト。
 *
 * 生成は情報を足さない(宣言の展開のみ)。ここで固定するのは:
 *   - 差し込み先(external.md の external-body マーカー)と、連携の全数がマトリクスに出ること
 *   - sends(fields + text)が 1 セルに畳まれること
 *   - ハンドブックの章が丸ごと生成され、鍵が無いとどうなるかが人間向けに出ること
 */

import { describe, expect, it } from 'vitest';
import { externalBodyGenerator } from '../../../../lib/generate/render/external-body.js';
import { bookChapterSections, pageText } from '../../../helpers/book-html.js';
import { specModel, stubGuards } from '../../../helpers/model-builder.js';
import { externalModel, integration } from '../../../helpers/external-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT, TEST_PLATFORM } from '../../../helpers/platform.js';
import { EMPTY_LAYOUT } from '../../../../lib/model/product/layout.js';
import type { ProductLayout } from '../../../../lib/model/product/layout.js';
import { GeneratorPreconditionError } from '../../../../lib/kernel/generator-precondition.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 標準的な宣言(write 1 件 + read 1 件)。 */
function standard() {
  return externalModel([
    integration('discord_webhook', {
      sends: { fields: [], text: '通知の本文(個人名は含まない)' },
      summary: 'Discord Webhook へ POST する',
    }),
    integration('anthropic_chat', {
      service: 'anthropic',
      effect: 'read',
      port: 'ChatPort',
      adapter: 'app/src/infrastructure/anthropic/chat.ts',
      config: ['ANTHROPIC_API_KEY'],
      degrade: 'not_configured',
      timeoutMs: 60000,
      sends: { fields: ['member.display_name'], text: '表示名を渡す' },
      summary: 'チュートリアル AI',
    }),
  ]);
}

/** 生成の文脈。 */
const CTX = (external: ReturnType<typeof externalModel>, layout: ProductLayout = TEST_LAYOUT) => ({
  guards: stubGuards(),
  roots: TEST_ROOTS,
  platform: TEST_PLATFORM,
  layout,
  gates: NO_GATES,
  external,
});

/** 受信の連携 1 件。 */
function inboundModel() {
  return externalModel([
    integration('billing_hook', { direction: 'inbound', signature: 'hmac_sha256', signatureKey: 'K', eventIdTable: 't', emits: 'invoice.settle' }),
  ]);
}

describe('external-body', () => {
  it('連携の全数がマトリクスに出て、差し込み先が external.md になる', () => {
    const sections = externalBodyGenerator.generate(specModel([]), CTX(standard()));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/specs/backend/external.md');
    expect(sections[0]?.marker).toBe('external-body');
    const content = sections[0]?.content ?? '';
    expect(content).toContain('| `discord_webhook` |');
    expect(content).toContain('通知の本文(個人名は含まない)');
    expect(content).toContain('`member.display_name` / 表示名を渡す');
    expect(content).toContain('60000ms');
  });

  it('送信の連携が endpoints(手書きの口)を宣言していれば、口の表が出る(置き場は配置が決める)。宣言が無ければ節ごと出さない', () => {
    const withEndpoints = externalModel([
      integration('anthropic_chat', { service: 'anthropic', effect: 'read', endpoints: ['/api/ai/tutorial', '/api/ai/program-draft'] }),
    ]);
    const content = externalBodyGenerator.generate(specModel([]), CTX(withEndpoints))[0]?.content ?? '';
    const moved = externalBodyGenerator.generate(specModel([]), CTX(withEndpoints, FOREIGN_LAYOUT))[0]?.content ?? '';
    const noApp = externalBodyGenerator.generate(specModel([]), { ...CTX(withEndpoints, EMPTY_LAYOUT), roots: { ...TEST_ROOTS, app: null } })[0]?.content ?? '';

    expect(content).toContain('### この連携を使う手書きの口(ブラウザから叩かれ、サーバーの側で連携を呼ぶ)');
    expect(content).toContain('| `anthropic_chat` | `/api/ai/tutorial` | `app/src/app/api/ai/tutorial/route.ts` |');
    expect(content).toContain('| `anthropic_chat` | `/api/ai/program-draft` | `app/src/app/api/ai/program-draft/route.ts` |');
    expect(moved).toContain('| `anthropic_chat` | `/api/ai/tutorial` | `app/server_code/endpoints/api/ai/tutorial.handler.ts` |');
    expect(noApp).toContain('| `anthropic_chat` | `/api/ai/tutorial` | — |');
    expect(externalBodyGenerator.generate(specModel([]), CTX(standard()))[0]?.content).not.toContain('手書きの口');
  });

  it('test_cases が無ければ「まだ無い」と出る', () => {
    const model = externalModel([integration('discord_webhook')]);
    const sections = externalBodyGenerator.generate(specModel([]), CTX(model));

    expect(sections[0]?.content).toContain('まだ無い(任意宣言');
  });

  it('受け取る側の表の「口(生成)」は、置き場の配置が決める位置を示す(配置を差し替えるとその位置)', () => {
    const cell = (ctx: object): string =>
      (externalBodyGenerator.generate(specModel([]), ctx as Parameters<typeof externalBodyGenerator.generate>[1])[0]?.content ?? '')
        .split('\n')
        .find((line) => line.startsWith('| `billing_hook` | hmac_sha256'))
        ?.split('|')
        .at(-2)
        ?.trim() ?? '';

    expect(cell(CTX(inboundModel()))).toBe('`app/src/app/api/inbound/billing_hook/route.ts`');
    expect(cell(CTX(inboundModel(), FOREIGN_LAYOUT))).toBe('`app/server_code/endpoints/api/inbound/billing_hook.handler.ts`');
  });

  it('実装の木を持たない製品は、置き場が決まらなければ「—」(置き場が無いことが事実)。配置が解決すれば製品の根からの相対で示す', () => {
    const noApp = { ...TEST_ROOTS, app: null };
    const cell = (layout: ProductLayout): string =>
      (externalBodyGenerator.generate(specModel([]), { ...CTX(inboundModel(), layout), roots: noApp })[0]?.content ?? '')
        .split('\n')
        .find((line) => line.startsWith('| `billing_hook` | hmac_sha256'))
        ?.split('|')
        .at(-2)
        ?.trim() ?? '';

    expect(cell(EMPTY_LAYOUT)).toBe('—');
    expect(cell(TEST_LAYOUT)).toBe('`src/app/api/inbound/billing_hook/route.ts`');
  });

  it('実装の木があるのに配置が受信口の位置を解決できなければ、黙って「—」にせず前提の失敗で止める', () => {
    expect(() => externalBodyGenerator.generate(specModel([]), CTX(inboundModel(), EMPTY_LAYOUT))).toThrow(GeneratorPreconditionError);
  });

  it('仕様が無ければ何も生成しない', () => {
    expect(externalBodyGenerator.generate(specModel([]), { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});

/** 外部連携の章(HTML の本)のセクション。 */
const bookExternal = (ctx: unknown) => bookChapterSections(specModel([]), ctx as Parameters<typeof bookChapterSections>[1], 'external.html');

describe('book-external(HTML の本の外部連携の章)', () => {
  it('章が丸ごと生成され、鍵が無いとどうなるかが人間向けに出る', () => {
    const sections = bookExternal(CTX(standard()));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/book/external.html');
    expect(sections[0]?.wholeFile).toBe(true);
    const content = pageText(sections[0]?.content ?? '');
    expect(content).toContain('外と何をやり取りするか(外部連携)');
    expect(content).toContain('Discord Webhook へ POST する');
    expect(content).toContain('通知の本文(個人名は含まない)');
  });

  it('手書きの口(endpoints)を宣言していれば「ブラウザから叩かれる口」の節が出る。宣言が無ければ節ごと出さない', () => {
    const withEndpoints = externalModel([
      integration('anthropic_chat', { service: 'anthropic', effect: 'read', summary: 'チュートリアル AI', endpoints: ['/api/ai/tutorial'] }),
    ]);
    const content = pageText(bookExternal(CTX(withEndpoints))[0]?.content ?? '');

    expect(content).toContain('ブラウザから叩かれる口');
    expect(content).toContain('/api/ai/tutorial | チュートリアル AI');
    expect(pageText(bookExternal(CTX(standard()))[0]?.content ?? '')).not.toContain('ブラウザから叩かれる口');
  });

  it('読めていない仕様は章を作らない', () => {
    expect(bookExternal({ roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() })).toEqual([]);
  });
});
