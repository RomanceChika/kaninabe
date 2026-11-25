/**
 * S1(ルートの形式と一意性)のテスト。
 *
 * 規約(scripts-code-quality.md)の「規約網羅」に従い、screen-spec-writing.md の S1 が
 * 要求する各項目(URL の形・動的セグメントは :param・route の一意性・name の一意性)に 1 つ以上のケースを置く。
 */

import { describe, expect, it } from 'vitest';
import { routeVerifier } from '../../../../lib/screen/verifiers/s1-route.js';
import { SCREEN_CTX, screenInput, screenSpec } from '../../../helpers/screen-builder.js';

/** S1 を実行して Finding を返す。 */
function run(screens: Parameters<typeof screenInput>[0]) {
  return routeVerifier.verify(screenInput(screens), SCREEN_CTX);
}

describe('S1 ルート', () => {
  it('URL の形(動的セグメントは :param)なら通る', () => {
    const findings = run({
      screens: [
        screenSpec({ name: 'home', route: '/' }),
        screenSpec({ name: 'workshop_list', route: '/workshops' }),
        screenSpec({ name: 'workshop_detail', route: '/workshops/:id' }),
        screenSpec({ name: 'shelf', route: '/stores/:store_id/shelves/:shelf_id' }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('末尾スラッシュを検出する', () => {
    const findings = run({ screens: [screenSpec({ name: 'a', route: '/workshops/' })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('URL の形ではありません');
  });

  it('先頭スラッシュの無いルートを検出する', () => {
    const findings = run({ screens: [screenSpec({ name: 'a', route: 'workshops' })] });

    expect(findings).toHaveLength(1);
  });

  it('旧い記法 [id](置き場の表記)は error で、:param への書き直しを名指す', () => {
    const findings = run({ screens: [screenSpec({ name: 'a', route: '/workshops/[id]' })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.counterexample).toMatchObject({ route: '/workshops/[id]' });
    expect(findings[0]?.suggestion).toContain('/workshops/:id に書き直す');
  });

  it('キャッチオール [...x] / [[...x]] は文法に無く error', () => {
    for (const route of ['/docs/[...slug]', '/docs/[[...slug]]']) {
      const findings = run({ screens: [screenSpec({ name: 'a', route })] });
      expect(findings, route).toHaveLength(1);
      expect(findings[0]?.suggestion, route).toContain('キャッチオール');
    }
  });

  it(':param と旧い記法の混在は error', () => {
    const findings = run({ screens: [screenSpec({ name: 'a', route: '/stores/:store_id/shelves/[shelf_id]' })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('混在');
  });

  it(': はセグメント全体を占める(/x/pre:id や /x/:id-:other は error)', () => {
    for (const route of ['/x/pre:id', '/x/:id-:other', '/x/:id.json']) {
      expect(run({ screens: [screenSpec({ name: 'a', route })] }), route).toHaveLength(1);
    }
  });

  it('動的セグメントの名前が空(/:)は error。名前は小文字で始まる', () => {
    for (const route of ['/:', '/x/:', '/x/:Id', '/x/:1']) {
      expect(run({ screens: [screenSpec({ name: 'a', route })] }), route).toHaveLength(1);
    }
    expect(run({ screens: [screenSpec({ name: 'a', route: '/:' })] })[0]?.message).toContain('名前が空');
  });

  it('同じ route の中で動的セグメントの名前が重複すれば error', () => {
    const findings = run({ screens: [screenSpec({ name: 'a', route: '/a/:id/b/:id' })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(':id が重複');
  });

  it('空のセグメント(//)は error', () => {
    expect(run({ screens: [screenSpec({ name: 'a', route: '/a//b' })] })).toHaveLength(1);
  });

  it('route の重複を検出する', () => {
    const findings = run({
      screens: [
        screenSpec({ name: 'a', route: '/workshops' }),
        screenSpec({ name: 'b', route: '/workshops' }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('route /workshops が複数の screen_spec');
  });

  it('name の重複を検出する(スロットパスが衝突するため)', () => {
    const findings = run({
      screens: [
        screenSpec({ name: 'a', route: '/x', group: 'g1' }),
        screenSpec({ name: 'a', route: '/y', group: 'g2' }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('name a が複数の screen_spec');
  });

  it('画面が 0 件でも壊れない', () => {
    expect(run({})).toEqual([]);
  });
});
