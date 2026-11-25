/**
 * 書式 markdown の欄(`format: markdown`)を表・詳細が描くときの生成のテスト。
 *
 * 確かめるのは「書式 markdown の欄は `@kaninabe/runtime/markdown-view` の `MarkdownView` に値を渡して描き、生の HTML を差し込む口
 * (`dangerouslySetInnerHTML` など)を生成物に書かない」「書式のない text の欄は今までどおり文字のまま」「値無しは値無しの表示」
 * 「書式 markdown の欄が無い部品は描画の部品を import しない」。
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
        { ...field('story', { kind: 'text' }, { label: '紹介' }), format: 'markdown', maxLength: 20000 },
        { ...field('plain_note', { kind: 'text' }, { label: 'メモ' }), maxLength: 20000 },
        { ...field('body', { kind: 'text' }, { required: true, label: '本文' }), format: 'markdown', maxLength: 20000 },
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
    projection: ['id', 'title', 'story', 'plain_note', 'body'],
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

describe.each(['table', 'detail'] as const)('書式 markdown の欄の描画(%s)', (kind) => {
  it('書式 markdown の欄は MarkdownView に値を渡し、生の HTML の差し込み口を書かない', () => {
    const text = source(kind, ['title', 'body']);

    expect(text).toContain("import { MarkdownView } from '@kaninabe/runtime/markdown-view';");
    expect(text).toContain('<MarkdownView value={row.body} />');
    expect(text).not.toContain('dangerouslySetInnerHTML');
    expect(text).not.toContain('innerHTML');
  });

  it('値が無いかもしれない書式 markdown の欄は、値無しの表示(NONE)に倒す', () => {
    const text = source(kind, ['story']);

    expect(text).toContain('row.story ? <MarkdownView value={row.story} /> : NONE');
    expect(text).toContain('const NONE = ');
  });

  it('書式のない text の欄は文字のまま出し、描画の部品を import しない', () => {
    const text = source(kind, ['title', 'plain_note']);

    expect(text).not.toContain('MarkdownView');
    expect(text).toContain('row.plainNote ?? NONE');
  });
});
