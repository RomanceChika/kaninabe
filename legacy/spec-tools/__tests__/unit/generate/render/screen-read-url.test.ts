/**
 * 書式 url の欄(`format: url`)を表・詳細が描くときの生成のテスト。
 *
 * 確かめるのは「書式 url の欄は `<a href>` に直接出さず、`@kaninabe/runtime/url` の `safeHttpUrl` を通した値だけをリンクにする」
 * 「自由な文字列の欄(書式なし)は今までどおり文字のまま」「値無しは値無しの表示」「書式 url の欄が無い部品は安全なリンクの部品を import しない」。
 * 壊すと鳴る変異(`safeHttpUrl` を通さず `href={value}` にする)は、字面に `safeHttpUrl(` が必ずあることで固定する。
 */

import { describe, expect, it } from 'vitest';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { renderScreenDetailBody } from '../../../../lib/generate/render/screen-detail-body.js';
import { buildScreenReads } from '../../../../lib/generate/render/screen-read-plan.js';
import { renderScreenTableBody } from '../../../../lib/generate/render/screen-table-body.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT, TEST_BODY_MODULES } from '../../../helpers/platform.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import type { ComponentInit } from '../../../helpers/screen-builder.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

const DOMAIN = specModel([
  aggregate('item', {
    entity: entitySpec('item', {
      fields: [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('title', { kind: 'string' }, { required: true, label: '題名' }),
        { ...field('ticket_url', { kind: 'string' }, { label: 'チケット' }), format: 'url', maxLength: 500 },
        { ...field('web_note', { kind: 'string' }, { label: 'メモ' }), maxLength: 500 },
        { ...field('home_url', { kind: 'string' }, { required: true, label: 'ホーム' }), format: 'url', maxLength: 500 },
      ],
    }),
  }),
]);

const QUERIES = [
  querySpec({
    name: 'item_list',
    source: 'item',
    for: ['member'],
    scopeUsed: 'all',
    projection: ['id', 'title', 'ticket_url', 'web_note', 'home_url'],
  }),
];

function context(components: readonly ComponentInit[]): GenerateContext {
  return {
    guards: createGuardServices(),
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    queries: { available: true, queries: QUERIES },
    screens: {
      available: true,
      screens: [screenSpec({ name: 'item_list', reads: ['query-item-list'], navigations: [], slots: [{ slot: 'body.center', components }] })],
      chromes: [],
      unexposed: [],
      unreachableStates: [],
      unseenStates: [],
    },
  };
}

function source(kind: 'table' | 'detail', shows: readonly string[]): string {
  const component: ComponentInit = { name: 'parts', kind, reads: 'query-item-list', shows };
  const plan = buildScreenReads(DOMAIN, context([component]))[0];
  if (plan === undefined) throw new Error('計画が導かれませんでした');
  const file = 'screen-spec.md';
  return (kind === 'table' ? renderScreenTableBody(plan, file, TEST_BODY_MODULES) : renderScreenDetailBody(plan, file, TEST_BODY_MODULES)).join('\n');
}

describe.each(['table', 'detail'] as const)('書式 url の欄の描画(%s)', (kind) => {
  it('書式 url の欄は UrlLink に値を渡し、UrlLink は safeHttpUrl を通した href だけを <a> に置く', () => {
    const text = source(kind, ['title', 'ticket_url']);

    expect(text).toContain("import { safeHttpUrl } from '@kaninabe/runtime/url';");
    expect(text).toContain('<UrlLink value={row.ticketUrl} />');
    expect(text).toContain('const href = safeHttpUrl(value);');
    expect(text).toContain('<a href={href} rel="noopener noreferrer" target="_blank">{href}</a>');
    // 値そのものを href に置く形はどこにも無い。
    expect(text).not.toMatch(/href=\{row\./);
    expect(text).not.toMatch(/href=\{value\}/);
  });

  it('値無しは値無しの表示(NONE)になり、nullable でない書式 url の欄でも NONE を宣言する', () => {
    const text = source(kind, ['home_url']);

    expect(text).toContain('<UrlLink value={row.homeUrl} />');
    expect(text).toContain('const NONE = ');
    expect(text).toContain('return href === null ? <>{NONE}</>');
  });

  it('書式のない文字列の欄は文字のまま出し、安全なリンクの部品を import しない', () => {
    const text = source(kind, ['title', 'web_note']);

    expect(text).not.toContain('safeHttpUrl');
    expect(text).not.toContain('UrlLink');
    expect(text).not.toContain('<a ');
    expect(text).toContain('row.webNote ?? NONE');
  });
});
