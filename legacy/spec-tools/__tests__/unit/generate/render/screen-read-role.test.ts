/**
 * 表・詳細の併読の欄の見出しに添える役割(`対応者の表示名`)の生成のテスト(束 画面 4c)。
 *
 * 規則の導出は `includeRoleField`(read-shows.test.ts)が持つ。ここで確かめるのは、導出が付けると決めた列だけが
 * 「{source の ref の欄の見出し}の{欄の見出し}」の式になり、そのために source の見出しの表を import すること、
 * 付けない列は従来どおり併読先の見出しだけであること。アプリの語彙は 1 語も使わない(W1)。
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

/** 依頼(担当者への ref と会場への ref が 1 つずつ)・担当者・会場。担当者の label は集約の label と違い、会場は同じ。 */
const DOMAIN = specModel([
  aggregate('request', {
    entity: entitySpec('request', {
      fields: [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('title', { kind: 'string' }, { required: true, label: '題名' }),
        field('handled_by', { kind: 'ref', entity: 'person' }, { label: '担当者' }),
        field('venue_id', { kind: 'ref', entity: 'venue' }, { label: '会場' }),
      ],
    }),
  }),
  aggregate('person', {
    entity: { ...entitySpec('person', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('display_name', { kind: 'string' }, { label: '表示名' })] }), label: 'メンバー' },
  }),
  aggregate('venue', {
    entity: { ...entitySpec('venue', { fields: [field('id', { kind: 'uuid' }, { auto: true }), field('name', { kind: 'string' }, { label: '会場名' })] }), label: '会場' },
  }),
]);

/** 読み(一覧と詳細。担当者と会場を併読する)。 */
const QUERIES = [
  querySpec({
    name: 'request_list',
    source: 'request',
    for: ['staff'],
    scopeUsed: 'all',
    projection: ['id', 'title', 'handled_by', 'venue_id'],
    includes: [
      { entity: 'person', scopeUsed: 'all', projection: ['id', 'display_name'] },
      { entity: 'venue', scopeUsed: 'all', projection: ['id', 'name'] },
    ],
  }),
  querySpec({
    name: 'request_detail',
    source: 'request',
    for: ['staff'],
    scopeUsed: 'all',
    returns: 'one',
    params: [{ name: 'request_id', ref: 'request.id' }],
    projection: ['id', 'title', 'handled_by', 'venue_id'],
    includes: [
      { entity: 'person', scopeUsed: 'all', projection: ['id', 'display_name'] },
      { entity: 'venue', scopeUsed: 'all', projection: ['id', 'name'] },
    ],
  }),
];

/** 生成の文脈(部品 1 つの画面)。 */
function context(component: ComponentInit): GenerateContext {
  return {
    guards: createGuardServices(),
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    queries: { available: true, queries: QUERIES },
    screens: {
      available: true,
      screens: [
        screenSpec({
          name: 'request_admin',
          reads: ['query-request-list', 'query-request-detail'],
          slots: [{ slot: 'body.center', components: [component] }],
        }),
      ],
      chromes: [],
      unexposed: [],
      unreachableStates: [],
      unseenStates: [],
    },
  };
}

/** 役割が付く欄(担当者の表示名)と付かない欄(会場の会場名)の式。 */
const WITH_ROLE = '{`${requestFieldLabels.handled_by}の${personFieldLabels.display_name}`}';
const WITHOUT_ROLE = '{venueFieldLabels.name}';

describe('併読の欄の見出しの役割', () => {
  it('表: 併読先の label と違う ref の欄の見出しを前に添え(source の見出しの表も import する)、同じ label の併読には添えない', () => {
    const plan = buildScreenReads(
      DOMAIN,
      context({ name: 'request_table', kind: 'table', reads: 'query-request-list', label: '依頼', shows: ['title', 'person.display_name', 'venue.name'] }),
    )[0];
    if (plan === undefined) throw new Error('計画が導かれませんでした');
    const source = renderScreenTableBody(plan, 'docs/specs/frontend/screens/x.md', TEST_BODY_MODULES).join('\n');

    expect(source).toContain(WITH_ROLE);
    expect(source).toContain(WITHOUT_ROLE);
    expect(source).toContain("import { requestFieldLabels } from '@/domain/generated/request.labels';");
    expect(source).toContain('の${personFieldLabels.display_name}');
  });

  it('詳細も同じ式で項目名を出す', () => {
    const plan = buildScreenReads(
      DOMAIN,
      context({ name: 'request_summary', kind: 'detail', reads: 'query-request-detail', shows: ['person.display_name', 'venue.name'] }),
    )[0];
    if (plan === undefined) throw new Error('計画が導かれませんでした');
    const source = renderScreenDetailBody(plan, 'docs/specs/frontend/screens/x.md', TEST_BODY_MODULES).join('\n');

    expect(source).toContain(WITH_ROLE);
    expect(source).toContain(WITHOUT_ROLE);
  });
});
