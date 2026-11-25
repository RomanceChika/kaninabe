/**
 * 画面一覧(screens/README.md の screen-list ブロック)の生成器のテスト。
 *
 * 対象の要求: 「screen_spec の一覧表(route / for / reads / actions)を生成する。
 * 1 件も無くても壊れない」。
 */

import { describe, expect, it } from 'vitest';
import { screenListGenerator } from '../../../../lib/generate/render/screen-list.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { specModel } from '../../../helpers/model-builder.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** screen_spec を載せた GenerateContext を作る。 */
function ctxWith(screens: readonly ReturnType<typeof screenSpec>[]): GenerateContext {
  return {
    guards: createGuardServices(),
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    screens: { available: true, screens, chromes: [], unexposed: [], unreachableStates: [], unseenStates: [] },
  };
}

describe('画面一覧の生成', () => {
  it('screens/README.md の screen-list マーカーに差し込む', () => {
    const [section] = screenListGenerator.generate(specModel([]), ctxWith([]));

    expect(section?.file).toBe('docs/specs/frontend/screens/README.md');
    expect(section?.marker).toBe('screen-list');
  });

  it('置き場はあるが 0 件なら「まだ無い」と書く', () => {
    const [section] = screenListGenerator.generate(specModel([]), ctxWith([]));

    expect(section?.content).toContain('まだ screen_spec はありません');
  });

  it('そもそも読み込めていない場合は 0 件と区別して書く', () => {
    const [section] = screenListGenerator.generate(specModel([]), GEN_CTX);

    expect(section?.content).toContain('読み込めなかった');
  });

  it('route / for / reads / actions を 1 行に並べる', () => {
    const ctx = ctxWith([
      screenSpec({
        name: 'workshop_detail',
        route: '/workshops/:id',
        for: ['member'],
        chrome: 'chrome-member',
        reads: ['query-workshop-detail'],
        actions: ['entry.create', 'entry.submit'],
      }),
    ]);

    const content = screenListGenerator.generate(specModel([]), ctx)[0]?.content ?? '';

    expect(content).toContain('| workshop_detail | `/workshops/:id` | member |');
    expect(content).toContain('query-workshop-detail');
    expect(content).toContain('entry.create, entry.submit');
    expect(content).toContain('chrome-member');
  });

  it('重ね表示だけが宣言した操作も actions 列に出す(V9)', () => {
    const ctx = ctxWith([
      screenSpec({
        name: 'workshop_manage',
        actions: ['workshop.publish'],
        slots: [{ slot: 'body.center', components: ['transition_bar'] }],
        overlays: [
          { id: 'cancel_confirm', openedBy: 'transition_bar', actions: ['workshop.cancel'] },
        ],
      }),
    ]);

    const content = screenListGenerator.generate(specModel([]), ctx)[0]?.content ?? '';

    // 落とすと「この画面は催しを中止できない」と読めてしまう(発火するのはどこに
    // 置かれたボタンでもその画面である)。出所が分かるように重ね表示の id を添える。
    expect(content).toContain('workshop.publish, workshop.cancel(cancel_confirm)');
  });

  it('入口と入場の関門(セッション・入場条件)を列で示す', () => {
    const ctx = ctxWith([
      screenSpec({ name: 'home', entryPoint: true }),
      screenSpec({ name: 'listing', requiresAuth: true }),
      screenSpec({
        name: 'guarded',
        requiresAuth: true,
        subject: 'workshop',
        precondition: 'state == draft',
        onFail: 'screen-home',
      }),
    ]);

    const content = screenListGenerator.generate(specModel([]), ctx)[0]?.content ?? '';

    expect(content).toContain('入口');
    expect(content).toContain('| 要ログイン |');
    expect(content).toContain('要ログイン / 条件 → screen-home');
  });
});
