/**
 * code-paid-entries(外部連携の有料の口 → 口ごとの定数表 `PAID_ENTRIES`)のユニットテスト。
 *
 * ①宣言が揃った有料の口だけを、宣言の並びで出す(口 1 本ごとに上限・役・meter・枠) ②宣言が揃わない連携・有料でない連携・受信の連携は載せない
 * (揃わない宣言から値を捏造しない) ③外部連携カタログが無ければ何も出さない ④カタログがあって有料の口が無ければ空の表を出す(閉世界)。
 */

import { describe, expect, it } from 'vitest';
import { paidEntriesGenerator } from '../../../../lib/generate/render/code-paid-entries.js';
import { DEEP_FREEZE_HELPER } from '../../../../lib/gen-kit/code-emit.js';
import type { ExternalAbuseDecl, ExternalAuthzDecl, ExternalQuotaDecl } from '../../../../lib/model/external/types.js';
import { stubGuards, specModel } from '../../../helpers/model-builder.js';
import { externalCatalog, integration } from '../../../helpers/external-builder.js';
import type { IntegrationOpts } from '../../../helpers/external-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';
import type { ExternalCatalogSpec } from '../../../../lib/model/external/types.js';

const LOC = { file: 'external.md' };

/** 健全な枠(上書きできる)。 */
function quota(over: Partial<ExternalQuotaDecl> = {}): ExternalQuotaDecl {
  return { source: 'AI_LIMIT', per: '1 day', key: 'actor', ...over };
}

/** 枠の数をリテラル(max)で持つ枠(source は持たない)。 */
const LITERAL_QUOTA: ExternalQuotaDecl = { max: 20, per: '1 day', key: 'actor' };

/** 健全な abuse。 */
function abuse(over: Partial<ExternalAbuseDecl> = {}): ExternalAbuseDecl {
  return { maxBodyBytes: { '/api/a': 100, '/api/b': 200 }, quota: quota(), location: LOC, ...over };
}

const AUTHZ: ExternalAuthzDecl = { kind: 'role', role: 'member', location: LOC };

/** 健全な有料の口。 */
const PAID: IntegrationOpts = { effect: 'read', endpoints: ['/api/a', '/api/b'], spend: 'paid', abuse: abuse(), meter: 'consume_quota', authz: AUTHZ };

/** 生成する(出力が 1 ファイルのときはその本文、無ければ null)。 */
function render(catalog: ExternalCatalogSpec | undefined): string | null {
  const ctx = {
    roots: TEST_ROOTS,
    platform: TEST_PLATFORM,
    layout: TEST_LAYOUT,
    gates: NO_GATES,
    guards: stubGuards(),
    ...(catalog === undefined ? {} : { external: { available: true, catalog } }),
  };
  const sections = paidEntriesGenerator.generate(specModel([]), ctx);
  if (sections.length === 0) return null;
  expect(sections).toHaveLength(1);
  expect(sections[0]?.file).toBe('app/src/domain/generated/paid-entries.ts');
  expect(sections[0]?.wholeFile).toBe(true);
  return sections[0]?.content ?? '';
}

describe('code-paid-entries', () => {
  it('宣言が揃った有料の口を、口の URL を鍵に、上限・役・meter・枠つきで宣言の並びのまま出す', () => {
    const content = render(externalCatalog([integration('chat', PAID)])) ?? '';

    expect(content).toContain('export const PAID_ENTRIES = deepFreeze({');
    expect(content.indexOf("'/api/a'")).toBeLessThan(content.indexOf("'/api/b'"));
    expect(content).toMatch(/'\/api\/a': \{\s+integration: 'chat',\s+maxBodyBytes: 100,\s+role: 'member',\s+meter: 'consume_quota',\s+quota: \{\s+source: 'AI_LIMIT',\s+per: '1 day',\s+key: 'actor',\s+\},\s+\},/u);
    expect(content).toMatch(/'\/api\/b': \{\s+integration: 'chat',\s+maxBodyBytes: 200,/u);
    expect(content).toContain('as const satisfies Readonly<Record<string, PaidEntry>>);');
    // 値は深く凍結する(実行時の書き換えで上限を外させない。点検 7 回目 B7-5)。補助の関数はファイルの中に置く。
    expect(content).toContain(DEEP_FREEZE_HELPER.join('\n'));
  });

  it('枠の数をリテラル(max)で書いた宣言は max を出し、source は出さない', () => {
    const content = render(externalCatalog([integration('chat', { ...PAID, abuse: abuse({ quota: LITERAL_QUOTA }) })])) ?? '';

    expect(content).toContain('max: 20,');
    expect(content).not.toContain('source:');
  });

  it('複数の連携の口が 1 つの表に並ぶ', () => {
    const content = render(externalCatalog([integration('chat', PAID), integration('other', { ...PAID, endpoints: ['/api/c'], abuse: abuse({ maxBodyBytes: { '/api/c': 300 } }) })])) ?? '';

    expect(content).toContain("integration: 'other'");
    expect(content).toContain("'/api/c'");
  });

  // 載せない形の表: [題, 連携の宣言]
  const SKIPPED: readonly (readonly [string, IntegrationOpts])[] = [
    ['spend の無い連携', { ...PAID, spend: undefined }],
    ['口(endpoints)の無い連携', { ...PAID, endpoints: undefined }],
    ['meter の無い連携', { ...PAID, meter: undefined }],
    ['authz の無い連携', { ...PAID, authz: undefined }],
    ['authz.kind: public の連携', { ...PAID, authz: { kind: 'public', location: LOC } }],
    ['役を持たない authz', { ...PAID, authz: { kind: 'role', location: LOC } }],
    ['枠(quota)の無い連携', { ...PAID, abuse: { maxBodyBytes: { '/api/a': 1 }, location: LOC } }],
    ['abuse の無い連携', { ...PAID, abuse: undefined }],
    ['受信の連携', { ...PAID, direction: 'inbound', endpoints: undefined }],
  ];

  it.each(SKIPPED)('載せない: %s(揃わない宣言から値を捏造しない)', (_title, opts) => {
    const content = render(externalCatalog([integration('chat', opts)])) ?? '';

    expect(content).toContain('export const PAID_ENTRIES = deepFreeze({} as const');
  });

  it('上限が宣言に無い口は載せない(口の一部だけが揃っていても、揃った口だけを出す)', () => {
    const content = render(externalCatalog([integration('chat', { ...PAID, abuse: abuse({ maxBodyBytes: { '/api/a': 100 } }) })])) ?? '';

    expect(content).toContain("'/api/a'");
    expect(content).not.toContain("'/api/b'");
  });

  it('外部連携カタログが無ければ何も出さない(ファイルを作らない)', () => {
    expect(render(undefined)).toBeNull();
    const ctx = { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards(), external: { available: false, catalog: null } };
    expect(paidEntriesGenerator.generate(specModel([]), ctx as never)).toEqual([]);
  });
});
