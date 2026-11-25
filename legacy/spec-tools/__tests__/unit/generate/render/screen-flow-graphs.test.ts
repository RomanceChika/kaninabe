/**
 * 画面のグループの一覧(render/screen-flow-graphs.ts)のテスト。
 */

import { describe, expect, it } from 'vitest';

import { screenGroups } from '../../../../lib/generate/render/screen-flow-graphs.js';
import type { ScreenSpec, ScreenSpecModel } from '../../../../lib/model/screen/types.js';
import { screenSpec } from '../../../helpers/screen-builder.js';

/** 画面の並びから ScreenSpecModel を作る。 */
function model(screens: readonly ScreenSpec[]): ScreenSpecModel {
  return { available: true, screens, chromes: [], unexposed: [], unreachableStates: [], unseenStates: [] };
}

describe('screenGroups(グループの一覧)', () => {
  it('relPath の先頭ディレクトリを、宣言順・重複なしで返す', () => {
    const screens = [
      screenSpec({ name: 'login', group: 'auth' }),
      screenSpec({ name: 'list', group: 'workshop' }),
      screenSpec({ name: 'detail', group: 'workshop' }),
    ];

    expect(screenGroups(model(screens))).toEqual(['auth', 'workshop']);
  });
});
