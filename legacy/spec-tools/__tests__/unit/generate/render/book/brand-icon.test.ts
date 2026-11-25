/**
 * ロゴの事実の組み立て(render/book/brand-icon.ts)のテスト。
 *
 * 「brand が無ければ出さない」「SVG を読めていなければ出さない(既知の穴)」
 * 「placeholder なら仮の印を付ける」の 3 点を検める。
 */

import { describe, expect, it } from 'vitest';

import { brandIconFact } from '../../../../../lib/generate/render/book/brand-icon.js';
import { GEN_CTX } from '../../../../helpers/generate-context.js';
import { brand, tokenSpec } from '../../../../helpers/design-builder.js';

describe('brandIconFact', () => {
  it('デザイン仕様が無ければ null', () => {
    expect(brandIconFact(undefined, GEN_CTX)).toBeNull();
    expect(brandIconFact(null, GEN_CTX)).toBeNull();
  });

  it('brand.icon が宣言されていなければ null', () => {
    const spec = tokenSpec({ brand: null });

    expect(brandIconFact(spec, GEN_CTX)).toBeNull();
  });

  it('SVG を読めていなければ null(PNG 等は埋め込まない既知の穴)', () => {
    const spec = tokenSpec({ brand: brand({}) });

    expect(brandIconFact(spec, GEN_CTX)).toBeNull();
  });

  it('SVG を読めていれば画像の事実を返す(相対パスは assets/brand-icon.svg)', () => {
    const spec = tokenSpec({ brand: brand({}) });
    const ctx = { ...GEN_CTX, book: { brandIconSvg: '<svg></svg>' } };

    const icon = brandIconFact(spec, ctx);

    expect(icon?.src).toBe('./assets/brand-icon.svg');
    expect(icon?.provisional).toBe(false);
  });

  it('placeholder があれば仮の印を付ける', () => {
    const spec = tokenSpec({ brand: brand({ placeholderReason: '実物のロゴ待ち' }) });
    const ctx = { ...GEN_CTX, book: { brandIconSvg: '<svg></svg>' } };

    expect(brandIconFact(spec, ctx)?.provisional).toBe(true);
  });
});
