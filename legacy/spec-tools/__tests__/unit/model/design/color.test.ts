/**
 * 色の計算(相対輝度とコントラスト比)のテスト。
 *
 * G3 の判定はこの関数の正しさに全面的に依存するので、WCAG の定義から検算できる
 * 既知の値(白黒 21:1・同色 1:1)と、3 桁 hex の展開・不正入力を押さえる。
 */

import { describe, expect, it } from 'vitest';
import { contrastRatio, isHex, parseHex, relativeLuminance } from '../../../../lib/model/design/color.js';

describe('color', () => {
  it('#rgb と #rrggbb を受け付ける', () => {
    expect(isHex('#fff')).toBe(true);
    expect(isHex('#faf6ef')).toBe(true);
    expect(isHex('faf6ef')).toBe(false);
    expect(isHex('#faf6e')).toBe(false);
  });

  it('3 桁 hex は各桁を 2 回繰り返して展開する', () => {
    expect(parseHex('#fa0')).toEqual([255, 170, 0]);
  });

  it('白と黒の相対輝度は 1 と 0', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
  });

  it('白黒のコントラスト比は 21:1', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 6);
  });

  it('同じ色どうしは 1:1', () => {
    expect(contrastRatio('#31417a', '#31417a')).toBeCloseTo(1, 6);
  });

  it('順序を入れ替えても同じ比になる', () => {
    expect(contrastRatio('#211d18', '#faf6ef')).toBe(contrastRatio('#faf6ef', '#211d18'));
  });

  it('不正な入力は null を返す(例外を投げない)', () => {
    expect(parseHex('rgb(0,0,0)')).toBeNull();
    expect(relativeLuminance('white')).toBeNull();
    expect(contrastRatio('#fff', 'white')).toBeNull();
  });
});
