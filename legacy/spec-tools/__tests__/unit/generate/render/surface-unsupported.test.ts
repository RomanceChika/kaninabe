/**
 * 後段が SQL の公開面(surface)を API として外へ出す能力を持たない構成(`surfaceExposure: unsupported`)の、生成側の振る舞い。
 *
 * 規約網羅(framework-modules §22 P2-1 / platform-profile.ts):
 *   - 公開スキーマの土台・ビュー(と一覧)・API スキーマの期待表の生成器は、能力が無ければ何も出さない
 *   - **表の権限(と ACL の期待表)の生成器は、能力に依らず出す**(剥奪と特権ロールへの付与・関数の実行権限の閉世界は、
 *     公開面を外へ出さない構成でも要る)。公開面に依る関数(土台・隠し列の述語)だけが呼べる側から外れる
 *   - 能力があれば(対照)同じ入力で出す —— 空振りの緑にしない
 *   - 能力を持たない宣言は理由を持つ(契約: `platformProfileProblems`)
 */

import { describe, expect, it } from 'vitest';
import { surfaceUnsupportedNotice } from '../../../../lib/generate/generate-context.js';
import { apiBaseGenerator } from '../../../../lib/generate/render/code-api-base.js';
import { apiExpectationsGenerator } from '../../../../lib/generate/render/code-api-expectations.js';
import { apiViewsGenerator } from '../../../../lib/generate/render/code-api-views.js';
import { grantsGenerator } from '../../../../lib/generate/render/code-grants.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { PlatformProfile } from '../../../../lib/model/product/platform-profile.js';
import { platformProfileProblems, surfaceUnsupportedReason } from '../../../../lib/sql/platform-sql.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { aggregate, entitySpec, field, specModel, stubGuards } from '../../../helpers/model-builder.js';
import { accessSpec } from '../../../helpers/model-builder-v8plus.js';
import { NO_GATES } from '../../../helpers/generate-context.js';
import { TEST_LAYOUT, TEST_PLATFORM } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

const UNSUPPORTED: PlatformProfile = { ...TEST_PLATFORM, surfaceExposure: { kind: 'unsupported', reason: '権限が SQL の外にある API 層' } };

const model = specModel([
  aggregate('workshop', {
    entity: entitySpec('workshop', { fields: [field('id', { kind: 'uuid' })] }),
    access: accessSpec('workshop'),
  }),
]);

function contextOf(platform: PlatformProfile): GenerateContext {
  return {
    roots: TEST_ROOTS,
    platform,
    layout: TEST_LAYOUT,
    gates: NO_GATES,
    guards: stubGuards(),
    dataTables: dataTableModel([dataTable('workshops', { entity: 'workshop', surfaceMigration: '20260101000001_api_view_workshops.sql' })]),
    surface: {
      available: true,
      spec: {
        id: 'surface',
        surfaceBaseMigration: '20260101000000_api_base.sql',
        grantsMigration: '20260101000002_grants.sql',
        handWrittenViews: [],
        location: { file: 'docs/specs/backend/surface.md' },
      },
    },
  };
}

const GENERATORS = [apiBaseGenerator, apiViewsGenerator, apiExpectationsGenerator] as const;

describe('surfaceExposure: 生成器', () => {
  it('能力がある構成では、公開面の 3 つの生成器と権限の生成器がそれぞれ出力を持つ(対照)', () => {
    for (const generator of [...GENERATORS, grantsGenerator]) {
      expect(generator.generate(model, contextOf(TEST_PLATFORM)).length, generator.id).toBeGreaterThan(0);
    }
  });

  it('能力が無い構成では、公開面の 3 つの生成器は何も出さない(宣言があっても migration も期待表も書かない)', () => {
    for (const generator of GENERATORS) expect(generator.generate(model, contextOf(UNSUPPORTED)), generator.id).toEqual([]);
  });

  it('能力が無い構成でも、権限の migration(表の剥奪・特権ロールへの付与・関数の実行権限の閉世界)と ACL の期待表は出す', () => {
    const sections = grantsGenerator.generate(model, contextOf(UNSUPPORTED));
    const migration = sections.find((section) => section.file.endsWith('_grants.sql'))?.content ?? '';
    const expectations = sections.find((section) => section.file.endsWith('acl-expectations.ts'))?.content ?? '';

    expect(sections.map((section) => section.file.split('/').pop())).toEqual(['20260101000002_grants.sql', 'acl-expectations.ts']);
    expect(migration).toContain("execute format('revoke all on routine %s from public");
    expect(migration).toContain('revoke execute on functions from public');
    // 公開面に依る関数(土台)は作られない構成なので、呼べる側に載せない(同じ署名の手書きの関数に口を開けない)。
    expect(expectations).toContain('export const functionExecutors');
    expect(expectations).not.toContain(`${TEST_PLATFORM.exposedSchema}.`.concat('actor_id()'));
  });
});

describe('surfaceExposure: generate の入口が未対応を名指す', () => {
  it('能力が無い構成では、検査側の T12 の行と同じ語で「generate: 未対応 — …(理由: …)」の 1 行を出す', () => {
    const notice = surfaceUnsupportedNotice(UNSUPPORTED, 'generate');
    expect(notice).toContain('generate: 未対応 — ');
    expect(notice).toContain('理由: 権限が SQL の外にある API 層');
    expect(notice).toContain('SQL の公開面の migration と期待表');
  });

  it('能力がある構成では何も言わない', () => {
    expect(surfaceUnsupportedNotice(TEST_PLATFORM, 'generate')).toBeNull();
  });
});

describe('surfaceExposure: 設定の契約', () => {
  it('能力が無い宣言の理由を返し、能力があれば null', () => {
    expect(surfaceUnsupportedReason(UNSUPPORTED)).toBe('権限が SQL の外にある API 層');
    expect(surfaceUnsupportedReason(TEST_PLATFORM)).toBeNull();
  });

  it('理由の無い unsupported は契約の違反', () => {
    expect(platformProfileProblems(TEST_PLATFORM)).toEqual([]);
    expect(platformProfileProblems(UNSUPPORTED)).toEqual([]);
    expect(platformProfileProblems({ ...TEST_PLATFORM, surfaceExposure: { kind: 'unsupported', reason: '  ' } })).toEqual([
      'surfaceExposure が unsupported なのに reason がありません。未対応の報告に出す理由を書いてください',
    ]);
  });
});
