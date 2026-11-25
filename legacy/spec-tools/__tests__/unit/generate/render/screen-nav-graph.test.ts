/**
 * ナビゲーショングラフ(screens/README.md の screen-nav-graph ブロック)の生成器のテスト。
 *
 * 対象の要求: 「entry_point を起点に navigations を辿ったグラフを mermaid で描く。
 * on_fail は破線で区別する。1 件も無くても壊れない」。
 */

import { describe, expect, it } from 'vitest';
import {
  collectNavEdges,
  screenGroup,
  screenNavGraphGenerator,
} from '../../../../lib/generate/render/screen-nav-graph.js';
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

/** 生成された本文を取り出す。 */
function render(screens: readonly ReturnType<typeof screenSpec>[]): string {
  return screenNavGraphGenerator.generate(specModel([]), ctxWith(screens))[0]?.content ?? '';
}

describe('ナビゲーショングラフの生成', () => {
  it('screens/README.md の screen-nav-graph マーカーに差し込む', () => {
    const [section] = screenNavGraphGenerator.generate(specModel([]), ctxWith([]));

    expect(section?.file).toBe('docs/specs/frontend/screens/README.md');
    expect(section?.marker).toBe('screen-nav-graph');
  });

  it('置き場はあるが 0 件なら「まだ無い」と書く', () => {
    expect(render([])).toContain('まだ screen_spec はありません');
  });

  it('そもそも読み込めていない場合は 0 件と区別して書く', () => {
    const [section] = screenNavGraphGenerator.generate(specModel([]), GEN_CTX);

    expect(section?.content).toContain('読み込めなかった');
  });

  it('エントリポイントと遷移を mermaid の辺にする', () => {
    const content = render([
      screenSpec({ name: 'home', entryPoint: true, navigations: [{ on: 'link', to: 'screen-list' }] }),
      screenSpec({ name: 'list' }),
    ]);

    expect(content).toContain('```mermaid');
    expect(content).toContain('flowchart LR');
    expect(content).toContain('start((入口)) --> home');
    expect(content).toContain('home -->|link| list');
  });

  it('chrome から継承した遷移も普通の辺として描く', () => {
    const content = render([
      screenSpec({
        name: 'detail',
        navigations: [{ on: 'home_link', to: 'screen-list', viaChrome: 'chrome-member' }],
      }),
      screenSpec({ name: 'list' }),
    ]);

    expect(content).toContain('detail -->|home_link| list');
  });

  it('on_fail の行き先は破線にする', () => {
    const content = render([
      screenSpec({
        name: 'guarded',
        subject: 'workshop',
        precondition: 'state == draft',
        onFail: 'screen-login',
      }),
      screenSpec({ name: 'login' }),
    ]);

    expect(content).toContain('guarded -.->|入場条件を満たさない| login');
  });

  it('実在しない遷移先は辺にしない(S2 の担当)', () => {
    const content = render([screenSpec({ name: 'a', navigations: [{ on: 'x', to: 'screen-ghost' }] })]);

    expect(content).not.toContain('ghost');
  });

  it('動的セグメント(:param)は route のままラベルに出る。ラベルの角括弧は実体コードに逃がす', () => {
    const content = render([screenSpec({ name: 'detail', route: '/workshops/:id', label: '催し[詳細]' })]);

    expect(content).toContain('/workshops/:id');
    expect(content).toContain('催し#91;詳細#93;');
    expect(content).not.toContain('[詳細]');
  });
});

describe('renderNavGraph のオプション(ハンドブック用の描き分け)', () => {
  const model = {
    available: true,
    screens: [
      screenSpec({
        name: 'detail',
        chrome: 'chrome-main',
        navigations: [
          { on: 'entry.create.success', to: 'screen-detail' },
          { on: 'home_link', to: 'screen-list', viaChrome: 'chrome-main' },
        ],
      }),
      screenSpec({ name: 'list' }),
    ],
    chromes: [],
    unexposed: [],
    unreachableStates: [],
    unseenStates: [],
  } as const;

  it('omitChromeNavigations は共有クローム由来(viaChrome)の辺だけを落とす', async () => {
    const { renderNavGraph } = await import('../../../../lib/generate/render/screen-nav-graph.js');
    const content = renderNavGraph(model, { omitChromeNavigations: true });

    expect(content).toContain('detail -->|entry.create.success| detail');
    expect(content).not.toContain('home_link');
  });

  it('cardLinks は全節点にカード見出しへの click 指令を張る', async () => {
    const { renderNavGraph } = await import('../../../../lib/generate/render/screen-nav-graph.js');
    const content = renderNavGraph(model, { cardLinks: true });

    expect(content).toContain('click detail "#detail" "detail のカードへ"');
    expect(content).toContain('click list "#list" "list のカードへ"');
  });

  it('cardLinks のアンカーは見出しの実スラッグ(`_` → `-`)に合わせる', async () => {
    const { renderNavGraph } = await import('../../../../lib/generate/render/screen-nav-graph.js');
    const snakeModel = {
      available: true,
      screens: [screenSpec({ name: 'workshop_detail' })],
      chromes: [],
      unexposed: [],
      unreachableStates: [],
      unseenStates: [],
    } as const;
    const content = renderNavGraph(snakeModel, { cardLinks: true });

    expect(content).toContain('click workshop_detail "#workshop-detail" "workshop_detail のカードへ"');
  });

  it('オプション無しは従来どおり(全辺・click 無し = specs README 側の形)', async () => {
    const { renderNavGraph } = await import('../../../../lib/generate/render/screen-nav-graph.js');
    const content = renderNavGraph(model);

    expect(content).toContain('detail -->|home_link| list');
    expect(content).not.toContain('click ');
  });
});

describe('collectNavEdges(全図で共有する辺データの抽出)', () => {
  it('遷移と on_fail を宣言順に、実在する画面に解決して返す', () => {
    const screens = [
      screenSpec({
        name: 'guarded',
        subject: 'workshop',
        precondition: 'state == draft',
        onFail: 'screen-login',
        navigations: [
          { on: 'go', to: 'screen-login' },
          { on: 'ghost', to: 'screen-ghost' },
          { on: 'home_link', to: 'screen-login', viaChrome: 'chrome-main' },
        ],
      }),
      screenSpec({ name: 'login' }),
    ];
    const edges = collectNavEdges({ available: true, screens, chromes: [], unexposed: [], unreachableStates: [], unseenStates: [] });

    expect(edges.map((edge) => [edge.from.name, edge.on, edge.to.name, edge.kind, edge.viaChrome])).toEqual([
      ['guarded', 'go', 'login', 'navigation', false],
      ['guarded', 'home_link', 'login', 'navigation', true],
      ['guarded', '入場条件を満たさない', 'login', 'fallback', false],
    ]);
  });
});

describe('screenGroup(仕様ディレクトリへの機械的な写像)', () => {
  it('relPath の先頭セグメントをグループにする', () => {
    expect(screenGroup(screenSpec({ name: 'login', group: 'auth' }))).toBe('auth');
  });

  it('ディレクトリ直下の仕様(通常は無い)は (未分類) に寄せる', () => {
    const screen = { ...screenSpec({ name: 'stray' }), relPath: 'stray.md' };

    expect(screenGroup(screen)).toBe('(未分類)');
  });
});
