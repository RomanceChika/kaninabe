/**
 * code-api-views(ビューの migration と、surface_spec の `surface-views` の一覧)のユニットテスト。
 *
 * 対象の要求: 一覧の 2 つの前文(surface のロール / 内部実行のロール)と、ビューの migration に出る
 * ロール名・スキーマ名は**設定から組まれ、生成器が綴りを持たない**(部品化 ③-a)。設定を別のもの
 * (`FOREIGN_PLATFORM`)にしたとき、出力に Supabase の綴りが 1 つも残らないことを見る。
 */

import { describe, expect, it } from 'vitest';
import { apiViewsGenerator } from '../../../../lib/generate/render/code-api-views.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import type { PlatformProfile } from '../../../../lib/model/product/platform-profile.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { stubGuards } from '../../../helpers/model-builder.js';
import { accessSpec, aggregate, entitySpec, field, readRule, specModel } from '../../../helpers/model-builder-v8plus.js';
import { FOREIGN_PLATFORM, leaksSupabaseSpelling, TEST_LAYOUT, TEST_PLATFORM } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** surface に出る 1 表と内部の 1 表を持つ最小の入力。 */
function input(platform: PlatformProfile): { readonly model: SpecModel; readonly ctx: GenerateContext } {
  const model = specModel({
    aggregates: [
      aggregate({
        name: 'workshop',
        entity: entitySpec('workshop', [field('id', { kind: 'uuid' }), field('title', { kind: 'string' })]),
        access: accessSpec('workshop', { reads: [readRule('member', { kind: 'all' })] }),
      }),
    ],
  });
  const ctx: GenerateContext = {
    roots: TEST_ROOTS,
    platform,
    layout: TEST_LAYOUT, gates: NO_GATES,
    guards: stubGuards(),
    dataTables: dataTableModel([
      dataTable('workshops', { entity: 'workshop', surfaceMigration: '20260101000001_api_view_workshops.sql' }),
      dataTable('jobs', { framework: 'jobs', internal: true, surfaceMigration: '20260101000002_api_view_jobs.sql' }),
    ]),
    surface: {
      available: true,
      spec: { id: 'surface', handWrittenViews: [], location: { file: 'docs/specs/backend/surface.md', pointer: '' } },
    },
  };
  return { model, ctx };
}

/** 生成した全節の本文を 1 本につなぐ。 */
function render(platform: PlatformProfile): string {
  const { model, ctx } = input(platform);
  return apiViewsGenerator.generate(model, ctx).map((section) => section.content).join('\n');
}

describe('code-api-views', () => {
  it('本番の設定では、前文と migration にその設定のロール名・スキーマ名が出る', () => {
    const text = render(TEST_PLATFORM);
    expect(text).toContain('`anon` / `authenticated`');
    expect(text).toContain('`service_role`');
    expect(leaksSupabaseSpelling(text)).toBe(true);
  });

  it('別の設定(FOREIGN_PLATFORM)では、前文も migration も別の名前になり、Supabase の綴りが 1 つも残らない', () => {
    const text = render(FOREIGN_PLATFORM);
    expect(text).toContain('`visitor` / `signed_in`');
    expect(text).toContain('`worker`');
    expect(text).toContain('edge.');
    expect(leaksSupabaseSpelling(text)).toBe(false);
  });
});
