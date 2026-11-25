/**
 * 外部連携の章の「有料の資源を使う口」の節(`external-paid-section.ts`)の行のテスト。
 *
 * 口ごとに 1 行・宣言した上限・枠・役・枠を消費する RPC を並べる。有料の連携が無ければ行を出さない。
 */

import { describe, expect, it } from 'vitest';
import { paidRows } from '../../../../../lib/generate/render/book/external-paid-section.js';
import type { ExternalAbuseDecl, ExternalAuthzDecl } from '../../../../../lib/model/external/types.js';
import { stubGuards } from '../../../../helpers/model-builder.js';
import { externalCatalog, integration } from '../../../../helpers/external-builder.js';
import type { IntegrationOpts } from '../../../../helpers/external-builder.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../../helpers/platform.js';
import { NO_GATES } from '../../../../helpers/generate-context.js';
import type { GenerateContext } from '../../../../../lib/gen-kit/generator.js';

const LOC = { file: 'external.md' };
const CTX: GenerateContext = { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards() };
const ABUSE: ExternalAbuseDecl = { maxBodyBytes: { '/api/a': 262144, '/api/b': 100 }, quota: { max: 5, per: '1 day', key: 'actor' }, location: LOC };
const AUTHZ: ExternalAuthzDecl = { kind: 'role', role: 'member', location: LOC };
const PAID: IntegrationOpts = { effect: 'read', endpoints: ['/api/a', '/api/b'], spend: 'paid', abuse: ABUSE, meter: 'consume_quota', authz: AUTHZ };

describe('paidRows', () => {
  it('口ごとに 1 行、本文の上限・枠・枠の出どころ・口を使える役・枠を消費する RPC を並べる', () => {
    const rows = paidRows(externalCatalog([integration('chat', PAID)]), CTX);

    expect(rows).toEqual([
      ['`/api/a`', 'chat の説明', '262144 バイト(256 KiB)', '実行者ごと 5 回 / 1 day', '仕様に直接書いた数', '`member`', '`consume_quota`'],
      ['`/api/b`', 'chat の説明', '100 バイト', '実行者ごと 5 回 / 1 day', '仕様に直接書いた数', '`member`', '`consume_quota`'],
    ]);
  });

  it('宣言が欠けた行は「宣言なし」と出す(隠さない)', () => {
    const rows = paidRows(externalCatalog([integration('chat', { ...PAID, abuse: undefined, meter: undefined, authz: undefined })]), CTX);

    expect(rows[0]).toEqual(['`/api/a`', 'chat の説明', '宣言なし', '宣言なし', '—', '宣言なし', '宣言なし']);
  });

  it('有料の連携が無い(spend が無い・受信)なら行を出さない', () => {
    expect(paidRows(externalCatalog([integration('chat', { effect: 'read', endpoints: ['/api/a'] })]), CTX)).toEqual([]);
    expect(paidRows(externalCatalog([integration('chat', { ...PAID, direction: 'inbound', endpoints: undefined })]), CTX)).toEqual([]);
  });
});
