/**
 * 画面の層の期待木(structure-screen-expectations.ts)のテスト。
 *
 * 対象の要求: 「手書きの器 `_screens/{名前}.tsx` が持ってよい名前の母集合は screen_spec の画面名
 * (kebab-case)であり、生成物の期待木は生成器が画面を書くまで空である」。
 * 逆方向の突合(実在・紛れ込み)はファイルシステムを読む構造テスト(app 側)が行う。
 */

import { describe, expect, it } from 'vitest';
import {
  containerName,
  screenExpectations,
} from '../../../../lib/generate/render/structure-screen-expectations.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { specModel } from '../../../helpers/model-builder.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 画面仕様を読み込み済みの文脈(`available` を切り替えられる)。 */
function ctxWith(names: readonly string[], available = true): GenerateContext {
  return {
    guards: createGuardServices(),
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    screens: {
      available,
      screens: names.map((name) => screenSpec({ name })),
      chromes: [],
      unexposed: [],
      unreachableStates: [],
      unseenStates: [],
    },
  };
}

describe('器の名前', () => {
  it('画面名の snake_case を kebab-case にする(実装ファイル名の規約)', () => {
    expect(containerName('venue_admin')).toBe('venue-admin');
    expect(containerName('home')).toBe('home');
  });
});

describe('画面の層の期待木', () => {
  it('器の名前の母集合は画面名の kebab-case を名前順に返す', () => {
    const { containers } = screenExpectations(specModel([]), ctxWith(['venue_admin', 'workshop_list', 'home']));

    expect(containers).toEqual(['home', 'venue-admin', 'workshop-list']);
  });

  it('生成物の期待木は(生成器が画面を書くまで)空である', () => {
    expect(screenExpectations(specModel([]), ctxWith(['venue_admin'])).generated).toEqual([]);
  });

  it('画面仕様を読めていなければ母集合は空(黙って何かを許さない)', () => {
    expect(screenExpectations(specModel([]), GEN_CTX)).toEqual({ generated: [], containers: [] });
    expect(screenExpectations(specModel([]), ctxWith(['venue_admin'], false)).containers).toEqual([]);
  });
});
