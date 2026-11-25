/**
 * 画面の配線表(app/src/domain/generated/screens.ts)の生成器のテスト。
 *
 * 対象の要求: 「screen_spec から route・宣言した部品・遷移を出す。共有クロームから
 * 継承した分も含める。排他表示の所属は入れ子の内側へ受け継ぐ」。
 * この表は screenTest が「宣言に無いものが出ていないか」を数えるために引く。
 */

import { describe, expect, it } from 'vitest';
import { screenRoutesGenerator } from '../../../../lib/generate/render/code-screens.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { specModel } from '../../../helpers/model-builder.js';
import { chromeSpec, screenSpec } from '../../../helpers/screen-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { expandChromeNavigations } from '../../../../lib/model/screen/expand-chrome.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** screen_spec / chrome_spec を載せた GenerateContext を作る(ローダーと同じく chrome を展開する)。 */
function ctxWith(
  screens: readonly ReturnType<typeof screenSpec>[],
  chromes: readonly ReturnType<typeof chromeSpec>[] = [],
): GenerateContext {
  return {
    guards: createGuardServices(),
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    screens: { available: true, screens: expandChromeNavigations(screens, chromes), chromes, unexposed: [], unreachableStates: [], unseenStates: [] },
  };
}

/** 生成された本文を返す。 */
function generate(ctx: GenerateContext): string {
  return screenRoutesGenerator.generate(specModel([]), ctx)[0]?.content ?? '';
}

/** 排他表示と入れ子を持つ催し詳細(実物と同じ形)。 */
function workshopDetail() {
  return screenSpec({
    name: 'workshop_detail',
    route: '/workshops/:id',
    chrome: 'chrome-member',
    requiresAuth: true,
    navigations: [{ on: 'entry.submit.success', to: 'screen-workshop-detail' }],
    slots: [
      { slot: 'header', components: ['page_title'] },
      {
        slot: 'body.center',
        components: [
          { name: 'entry_form', variant: 'no_entry' },
          { name: 'own_entry_panel', variant: 'own_entry' },
        ],
      },
      { slot: 'footer', components: ['submit_bar'], owner: 'own_entry_panel', under: 'body.center' },
    ],
  });
}

describe('画面の配線表の生成', () => {
  it('ファイル全体モードで app/src/domain/generated/screens.ts を出力する', () => {
    const [section] = screenRoutesGenerator.generate(
      specModel([]),
      ctxWith([screenSpec({ name: 'a' })]),
    );

    expect(section?.file).toBe('app/src/domain/generated/screens.ts');
    expect(section?.wholeFile).toBe(true);
    expect(section?.content).toContain('AUTO-GENERATED');
  });

  it('画面仕様を読み込めていなければ何も出さない', () => {
    expect(screenRoutesGenerator.generate(specModel([]), GEN_CTX)).toEqual([]);
  });

  it('画面が 0 件でも型の付いた空表を出す', () => {
    const content = generate(ctxWith([]));

    expect(content).toContain(
      'export const screenRoutes = deepFreeze({} as const satisfies Record<string, GeneratedScreenRoute>);',
    );
  });

  it('route と requires_auth を画面名で引ける形で出す', () => {
    const content = generate(ctxWith([workshopDetail()]));

    expect(content).toContain('workshop_detail: {');
    expect(content).toContain("id: 'screen-workshop-detail',");
    expect(content).toContain("route: '/workshops/:id',");
    expect(content).toContain('requiresAuth: true,');
  });

  it('排他表示の部品にグループと状態名が付く', () => {
    const content = generate(ctxWith([workshopDetail()]));

    expect(content).toContain("testId: 'workshop_detail.body.center.entry_form',");
    expect(content).toContain("variantGroup: 'body.center#0',");
    expect(content).toContain("variantKey: 'no_entry',");
  });

  it('排他表示の内側の部品は親の所属を受け継ぐ', () => {
    const content = generate(ctxWith([workshopDetail()]));
    const line = content.indexOf(
      "testId: 'workshop_detail.body.center.own_entry_panel.footer.submit_bar',",
    );

    expect(line).toBeGreaterThan(-1);
    // 直後にグループと状態名(own_entry)が続く = 受け継いでいる。
    expect(content.slice(line, line + 200)).toContain("variantKey: 'own_entry',");
  });

  it('排他でない部品は variantGroup を持たない', () => {
    const content = generate(ctxWith([screenSpec({ name: 'home', slots: [{ slot: 'body.center', components: ['site_title'] }] })]));

    const table = content.slice(content.indexOf('export const screenRoutes'));

    expect(table).toContain("testId: 'home.body.center.site_title',");
    expect(table).not.toContain('variantGroup');
  });

  it('継承した共有クロームの部品と遷移が載る', () => {
    const chrome = chromeSpec({
      name: 'member',
      navigations: [{ on: 'signed_out', to: 'screen-login' }],
    });

    const content = generate(ctxWith([workshopDetail()], [chrome]));

    expect(content).toContain("testId: 'member.header.app_header',");
    expect(content).toContain("on: 'signed_out',");
    expect(content).toContain("to: 'screen-login',");
  });

  it('スロット(器)の testid を入れ子まで載せる', () => {
    const content = generate(ctxWith([workshopDetail()]));
    const table = content.slice(content.indexOf('export const screenRoutes'));

    // 部品ではなくスロット自身。葉の命名規則(screen-test.md)の許容集合になる。
    expect(table).toContain("'workshop_detail.header'");
    expect(table).toContain("'workshop_detail.body.center'");
    expect(table).toContain("'workshop_detail.body.center.own_entry_panel.footer'");
  });

  it('重ね表示は画面の components とは別の欄に載る', () => {
    const content = generate(
      ctxWith([
        screenSpec({
          name: 'workshop_manage',
          slots: [{ slot: 'body.center', components: ['transition_bar'] }],
          overlays: [
            {
              id: 'cancel_confirm',
              openedBy: 'transition_bar',
              slots: [{ slot: 'body.center', components: ['confirm_bar'] }],
            },
          ],
        }),
      ]),
    );
    const table = content.slice(content.indexOf('export const screenRoutes'));
    const overlays = table.slice(table.indexOf('overlays: ['));

    // 画面の components に混ざると「常に描かれているはず」の期待値になり、閉じた状態が落ちる。
    expect(table.slice(0, table.indexOf('overlays: ['))).not.toContain('confirm_bar');
    expect(overlays).toContain("id: 'cancel_confirm',");
    expect(overlays).toContain("'workshop_manage.overlay.cancel_confirm.body.center'");
    expect(overlays).toContain(
      "testId: 'workshop_manage.overlay.cancel_confirm.body.center.confirm_bar',",
    );
  });

  it('宣言した操作を actions に出す(重ね表示の分も畳んで含める)', () => {
    const content = generate(
      ctxWith([
        screenSpec({
          name: 'workshop_manage',
          actions: ['workshop.publish', 'workshop.cancel'],
          slots: [{ slot: 'body.center', components: ['transition_bar'] }],
          overlays: [
            {
              id: 'cancel_confirm',
              openedBy: 'transition_bar',
              // 画面側にも書いてある操作(S2 が navigations の接地に要求する)。1 つに畳む。
              actions: ['workshop.cancel'],
              slots: [{ slot: 'body.center', components: ['confirm_bar'] }],
            },
          ],
        }),
      ]),
    );
    const table = content.slice(content.indexOf('export const screenRoutes'));
    const actions = table.slice(table.indexOf('actions: ['), table.indexOf('overlays: ['));

    expect(actions).toContain("'workshop.publish'");
    // 画面と重ね表示の両方に書かれていても 1 つだけ(画面が発火する操作の集合である)。
    expect(actions.split("'workshop.cancel'").length - 1).toBe(1);
  });

  it('操作を宣言していない画面でも actions の欄は出す(利用側の分岐を増やさない)', () => {
    expect(generate(ctxWith([screenSpec({ name: 'home' })]))).toContain('actions: [],');
  });

  it('重ね表示が無ければ空の欄を出す(利用側の分岐を増やさない)', () => {
    const content = generate(ctxWith([screenSpec({ name: 'home' })]));

    expect(content).toContain('overlays: [],');
  });

  it('継承した共有クロームのスロットも載る', () => {
    const chrome = chromeSpec({ name: 'member' });

    const table = generate(ctxWith([workshopDetail()], [chrome]));

    expect(table).toContain("'member.header'");
  });

  it('precondition / on_fail の AST と行き先を出す(実装がエンジンの評価器にかけられる形)', () => {
    const content = generate(
      ctxWith([
        screenSpec({
          name: 'organizer_program',
          subject: 'workshop',
          precondition: 'state == confirmed',
          onFail: 'screen-workshop-manage',
        }),
      ]),
    );

    expect(content).toContain("import type { GuardExprData } from '@kaninabe/runtime/engine';");
    expect(content).toContain("readonly precondition?: GuardExprData;");
    const table = content.slice(content.indexOf('export const screenRoutes'));
    expect(table).toContain("kind: 'compare'");
    expect(table).toContain("path: 'state'");
    expect(table).toContain("op: '=='");
    expect(table).toContain("value: 'confirmed'");
    expect(table).toContain("raw: 'redirect(screen-workshop-manage)'");
    expect(table).toContain("screen: 'screen-workshop-manage'");
  });

  it('precondition を宣言していない画面は precondition / onFail の欄を持たない', () => {
    const content = generate(ctxWith([screenSpec({ name: 'home' })]));
    const table = content.slice(content.indexOf('export const screenRoutes'));
    const homeEntry = table.slice(table.indexOf('home: {'), table.indexOf('home: {') + 400);

    expect(homeEntry).not.toContain('precondition:');
    expect(homeEntry).not.toContain('onFail:');
  });

  it('操作を伴わない navigations(on にドットが無い)は navComponentTestIds に載る(継承した共有クロームの分を含む)', () => {
    const chrome = chromeSpec({
      name: 'member',
      navigations: [{ on: 'home_link', to: 'screen-workshop-list' }],
    });
    const content = generate(
      ctxWith(
        [
          screenSpec({
            name: 'workshop_list',
            chrome: 'chrome-member',
            navigations: [{ on: 'workshop_selected', to: 'screen-workshop-detail' }],
          }),
        ],
        [chrome],
      ),
    );

    const table = content.slice(content.indexOf('export const screenRoutes'));
    expect(table).toContain("'member.nav.home_link'");
    expect(table).toContain("'workshop_list.nav.workshop_selected'");
  });
});
