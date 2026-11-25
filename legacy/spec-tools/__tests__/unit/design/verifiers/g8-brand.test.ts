/**
 * G8(ロゴがテンプレート既定のまま出ていない)のテスト。
 *
 * 見るのは 4 点:
 *   (a) brand.icon が宣言されている(無ければ error)
 *   (b) 宣言したファイルが実在する
 *   (c) 宣言したファイルが Next テンプレート既定の favicon.ico と一致しない(SHA-256 比較)
 *   (d) app/src/app/favicon.ico が残っていない
 * `placeholder` を宣言している間は (b)(c) が warning に格下げされることも確かめる。
 * app/ が無い環境では (b)(c)(d) を飛ばすこと(束 ⑲-1。placeholder を回避の道具にしない)も見る。
 */

import { describe, expect, it } from 'vitest';
import { g8Brand } from '../../../../lib/design/verifiers/g8-brand.js';
import { brand, brandFileCheck, brandStatus, designInput, tokenSpec } from '../../../helpers/design-builder.js';

/** 削除済みの `app/src/app/favicon.ico`(Next テンプレート既定)の SHA-256。検証器の定数と同じ値。 */
const DEFAULT_FAVICON_SHA256 = '2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932';

describe('G8 ロゴ(brand.icon)の検査', () => {
  it('トークン仕様が無ければ何も報告しない', () => {
    expect(g8Brand.verify(designInput({ spec: null }))).toEqual([]);
  });

  it('brand セクションそのものが無ければ (a) を error で挙げる', () => {
    const spec = tokenSpec({ brand: null });

    const findings = g8Brand.verify(designInput({ spec }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'G8', severity: 'error' });
    expect(findings[0]?.message).toContain('宣言されていません');
  });

  it('brand.icon が宣言されていなければ (a) を error で挙げる', () => {
    const spec = tokenSpec({ brand: brand({ icon: null }) });

    const findings = g8Brand.verify(designInput({ spec }));

    expect(findings.some((f) => f.message.includes('宣言されていません'))).toBe(true);
  });

  it('宣言したアイコンが実在しなければ (b) を error で挙げる', () => {
    const spec = tokenSpec({ brand: brand({ icon: 'app/src/app/icon.svg' }) });
    const status = brandStatus({ icon: brandFileCheck({ exists: false, sha256: null }) });

    const findings = g8Brand.verify(designInput({ spec, brand: status }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'G8', severity: 'error' });
    expect(findings[0]?.message).toContain('実在しません');
  });

  it('宣言したアイコンが既定の favicon.ico と同一内容なら (c) を error で挙げる', () => {
    const spec = tokenSpec({ brand: brand({ icon: 'app/src/app/icon.svg' }) });
    const status = brandStatus({ icon: brandFileCheck({ sha256: DEFAULT_FAVICON_SHA256 }) });

    const findings = g8Brand.verify(designInput({ spec, brand: status }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'G8', severity: 'error' });
    expect(findings[0]?.message).toContain('ついそのまま');
  });

  it('app/src/app/favicon.ico が残っていれば (d) を常に error で挙げる', () => {
    const spec = tokenSpec({ brand: brand({}) });
    const status = brandStatus({ icon: brandFileCheck({}), faviconIcoExists: true });

    const findings = g8Brand.verify(designInput({ spec, brand: status }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'G8', severity: 'error' });
    expect(findings[0]?.message).toContain('favicon.ico が残っています');
  });

  it('すべて満たしていれば違反ゼロ', () => {
    const spec = tokenSpec({ brand: brand({}) });
    const status = brandStatus({ icon: brandFileCheck({}) });

    expect(g8Brand.verify(designInput({ spec, brand: status }))).toEqual([]);
  });

  it('placeholder があれば (b)(c) は warning に格下げされる', () => {
    const spec = tokenSpec({ brand: brand({ placeholderReason: '実物のロゴ待ち' }) });
    const status = brandStatus({ icon: brandFileCheck({ exists: false, sha256: null }) });

    const findings = g8Brand.verify(designInput({ spec, brand: status }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'G8', severity: 'warning' });
  });

  it('placeholder があっても (a) brand.icon 未宣言は error のまま', () => {
    const spec = tokenSpec({ brand: brand({ icon: null, placeholderReason: '実物のロゴ待ち' }) });

    const findings = g8Brand.verify(designInput({ spec }));

    expect(findings.some((f) => f.severity === 'error' && f.message.includes('宣言されていません'))).toBe(true);
  });

  it('placeholder があっても (d) favicon.ico 残骸は error のまま', () => {
    const spec = tokenSpec({ brand: brand({ placeholderReason: '実物のロゴ待ち' }) });
    const status = brandStatus({ icon: brandFileCheck({}), faviconIcoExists: true });

    const findings = g8Brand.verify(designInput({ spec, brand: status }));

    expect(findings.some((f) => f.severity === 'error' && f.message.includes('残っています'))).toBe(true);
  });

  it('apple_icon / og_image も宣言されていれば同じ (b)(c) を見る', () => {
    const spec = tokenSpec({
      brand: brand({ appleIcon: 'app/src/app/apple-icon.png', ogImage: 'app/src/app/opengraph-image.png' }),
    });
    const status = brandStatus({
      icon: brandFileCheck({}),
      appleIcon: brandFileCheck({ declaredPath: 'app/src/app/apple-icon.png', exists: false, sha256: null }),
      ogImage: brandFileCheck({
        declaredPath: 'app/src/app/opengraph-image.png',
        sha256: DEFAULT_FAVICON_SHA256,
      }),
    });

    const findings = g8Brand.verify(designInput({ spec, brand: status }));

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.location.pointer).sort()).toEqual(['brand.apple_icon', 'brand.og_image']);
  });

  it('app/ が無い環境では実在を見る (b)(c)(d) を飛ばす(placeholder に頼らせない。束 ⑲-1)', () => {
    const spec = tokenSpec({ brand: brand({ icon: 'app/src/app/icon.svg' }) });
    const status = brandStatus({
      icon: brandFileCheck({ exists: false, sha256: null }),
      faviconIcoExists: true,
      appGrounded: false,
    });

    expect(g8Brand.verify(designInput({ spec, brand: status }))).toEqual([]);
  });

  it('app/ が無くても (a) 宣言そのものの不備は error で見る(仕様だけで判定できる)', () => {
    const spec = tokenSpec({ brand: null });

    const findings = g8Brand.verify(designInput({ spec, brand: brandStatus({ appGrounded: false }) }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'G8', severity: 'error' });
  });
});
