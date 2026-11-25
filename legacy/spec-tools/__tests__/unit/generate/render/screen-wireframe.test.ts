/**
 * ワイヤーフレーム(screens/README.md の screen-wireframes ブロック)の生成器のテスト。
 *
 * 対象の要求: 「chrome の外枠・画面のスロット・入れ子・排他表示・重ね表示を宣言どおりに写す。
 * 1 件も無くても壊れない」。絵の見た目そのものではなく、**宣言の情報が落ちていないこと**を見る。
 */

import { describe, expect, it } from 'vitest';
import { screenWireframeGenerator } from '../../../../lib/generate/render/screen-wireframe.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { specModel } from '../../../helpers/model-builder.js';
import { chromeSpec, screenSpec } from '../../../helpers/screen-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** screen_spec / chrome_spec を載せた GenerateContext を作る。 */
function ctxWith(
  screens: readonly ReturnType<typeof screenSpec>[],
  chromes: readonly ReturnType<typeof chromeSpec>[] = [],
): GenerateContext {
  return { guards: createGuardServices(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, screens: { available: true, screens, chromes, unexposed: [], unreachableStates: [], unseenStates: [] } };
}

/** 生成された本文を返す。 */
function generate(ctx: GenerateContext): string {
  return screenWireframeGenerator.generate(specModel([]), ctx)[0]?.content ?? '';
}

/** 排他表示と入れ子を持つ催し詳細(実物と同じ形)。 */
function workshopDetail() {
  return screenSpec({
    name: 'workshop_detail',
    route: '/workshops/:id',
    chrome: 'chrome-member',
    slots: [
      { slot: 'header', components: ['page_title'] },
      {
        slot: 'body.center',
        components: [
          'workshop_summary',
          { name: 'entry_form', variant: 'no_entry' },
          { name: 'own_entry_panel', variant: 'own_entry' },
        ],
      },
      { slot: 'footer', components: ['submit_bar'], owner: 'own_entry_panel', under: 'body.center' },
    ],
  });
}

describe('ワイヤーフレームの生成', () => {
  it('screens/README.md の screen-wireframes マーカーに差し込む', () => {
    const [section] = screenWireframeGenerator.generate(specModel([]), ctxWith([]));

    expect(section?.file).toBe('docs/specs/frontend/screens/README.md');
    expect(section?.marker).toBe('screen-wireframes');
  });

  it('置き場はあるが 0 件なら「まだ無い」と書く', () => {
    expect(generate(ctxWith([]))).toContain('まだ screen_spec はありません');
  });

  it('そもそも読み込めていない場合は 0 件と区別して書く', () => {
    expect(generate(GEN_CTX)).toContain('読み込めなかった');
  });

  it('画面名と route を見出しにし、値域のスロットをすべて並べる', () => {
    const content = generate(ctxWith([screenSpec({ name: 'home', route: '/' })]));

    expect(content).toContain('**home** — `/`');
    expect(content).toContain('+-- screen: home');
    for (const slot of ['header', 'body.left', 'body.center', 'body.right', 'footer']) {
      expect(content).toContain(slot);
    }
    // 宣言していないスロットは「無い」と書く(空欄にすると書き忘れと区別できない)。
    expect(content).toContain('—');
  });

  it('chrome を外枠として先に描く', () => {
    const content = generate(
      ctxWith([workshopDetail()], [chromeSpec({ name: 'member', slots: [{ slot: 'header', components: ['app_header'] }] })]),
    );

    expect(content.indexOf('+-- chrome: member')).toBeLessThan(content.indexOf('+-- screen: workshop_detail'));
    expect(content).toContain('app_header');
  });

  it('排他表示はグループ番号と状態名つきで並べ、入れ子は親の下にぶら下げる', () => {
    const content = generate(ctxWith([workshopDetail()]));

    expect(content).toContain('[排他1 no_entry] entry_form');
    expect(content).toContain('[排他1 own_entry] own_entry_panel');
    expect(content).toContain('└ footer : submit_bar');
  });

  it('排他グループが 2 つあれば番号で区別する(各グループから 1 つずつ出ることが読める)', () => {
    const content = generate(
      ctxWith([
        screenSpec({
          name: 'dashboard',
          slots: [
            {
              slot: 'body.center',
              components: [
                { name: 'entry_form', variant: 'no_entry', group: 0 },
                { name: 'own_entry_panel', variant: 'own_entry', group: 0 },
                { name: 'empty_notice', variant: 'no_news', group: 1 },
                { name: 'news_list', variant: 'has_news', group: 1 },
              ],
            },
          ],
        }),
      ]),
    );

    // 1 と 2 が別グループとして読める(番号が無いと「全部で 1 つだけ」と誤読される)。
    expect(content).toContain('[排他1 no_entry] entry_form');
    expect(content).toContain('[排他1 own_entry] own_entry_panel');
    expect(content).toContain('[排他2 no_news] empty_notice');
    expect(content).toContain('[排他2 has_news] news_list');
  });

  it('凡例がグループ番号の読み方を説明する', () => {
    const content = generate(ctxWith([screenSpec({ name: 'a' })]));

    expect(content).toContain('[排他{n} {状態}]');
    expect(content).toContain('各グループから 1 つずつ');
  });

  it('重ね表示は開く部品とともに別枠で描く', () => {
    const content = generate(
      ctxWith([
        screenSpec({
          name: 'a',
          overlays: [
            {
              id: 'report_dialog',
              openedBy: 'report_button',
              slots: [{ slot: 'body.center', components: ['report_form'] }],
            },
          ],
        }),
      ]),
    );

    expect(content).toContain('+-- overlay: report_dialog (opened_by: report_button)');
    expect(content).toContain('report_form');
  });

  it('凡例を図と一緒に出す(離れると読めない)', () => {
    expect(generate(ctxWith([screenSpec({ name: 'a' })]))).toContain('凡例:');
  });
});
