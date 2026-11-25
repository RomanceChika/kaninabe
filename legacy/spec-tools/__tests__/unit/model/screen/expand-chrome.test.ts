/**
 * 共有クロームの遷移展開(ロード時のマクロ展開)のテスト。
 *
 * 対象の要求: 「chrome の navigations を継承画面へ足し、展開元が分かる印を付ける。
 * 継承しない画面・実在しない chrome では何もしない」。
 */

import { describe, expect, it } from 'vitest';
import { expandChromeNavigations } from '../../../../lib/model/screen/expand-chrome.js';
import { chromeSpec, screenSpec } from '../../../helpers/screen-builder.js';

/** signed_out と home_link を持つ共有クローム。 */
function member() {
  return chromeSpec({
    name: 'member',
    navigations: [
      { on: 'signed_out', to: 'screen-login' },
      { on: 'home_link', to: 'screen-workshop-list' },
    ],
  });
}

describe('共有クロームの遷移展開', () => {
  it('継承した画面へ chrome の遷移を足す', () => {
    const [screen] = expandChromeNavigations(
      [screenSpec({ name: 'a', chrome: 'chrome-member' })],
      [member()],
    );

    expect(screen?.navigations.map((navigation) => navigation.on)).toEqual([
      'signed_out',
      'home_link',
    ]);
    expect(screen?.navigations.every((navigation) => navigation.viaChrome === 'chrome-member')).toBe(
      true,
    );
  });

  it('画面自身の宣言を先に、継承ぶんを後ろに並べる', () => {
    const [screen] = expandChromeNavigations(
      [
        screenSpec({
          name: 'a',
          chrome: 'chrome-member',
          navigations: [{ on: 'row_selected', to: 'screen-b' }],
        }),
      ],
      [member()],
    );

    expect(screen?.navigations.map((navigation) => navigation.on)).toEqual([
      'row_selected',
      'signed_out',
      'home_link',
    ]);
    expect(screen?.navigations[0]?.viaChrome).toBeUndefined();
  });

  it('chrome を継承しない画面はそのまま', () => {
    const screens = [screenSpec({ name: 'a' })];

    expect(expandChromeNavigations(screens, [member()])).toEqual(screens);
  });

  it('実在しない chrome を指す画面はそのまま(S2 の担当)', () => {
    const screens = [screenSpec({ name: 'a', chrome: 'chrome-ghost' })];

    expect(expandChromeNavigations(screens, [member()])).toEqual(screens);
  });

  it('遷移を持たない chrome では何も足さない', () => {
    const screens = [screenSpec({ name: 'a', chrome: 'chrome-member' })];

    expect(expandChromeNavigations(screens, [chromeSpec({ name: 'member' })])).toEqual(screens);
  });
});
