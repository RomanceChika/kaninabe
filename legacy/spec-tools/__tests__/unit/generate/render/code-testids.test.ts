/**
 * testid 定数表(app/src/domain/generated/testids.ts)の生成器のテスト。
 *
 * 対象の要求: 「screen_spec / chrome_spec の layout から testid の骨格を出す。
 * 名前空間は画面名 / chrome 名。排他表示の状態名はパスに現れない」。
 */

import { describe, expect, it } from 'vitest';
import { testIdsGenerator } from '../../../../lib/generate/render/code-testids.js';
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
  return testIdsGenerator.generate(specModel([]), ctx)[0]?.content ?? '';
}

/** 排他表示と入れ子を持つ催し詳細(実物と同じ形)。 */
function workshopDetail() {
  return screenSpec({
    name: 'workshop_detail',
    route: '/workshops/:id',
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

describe('testId 定数の生成', () => {
  it('ファイル全体モードで app/src/domain/generated/testids.ts を出力する', () => {
    const [section] = testIdsGenerator.generate(specModel([]), ctxWith([screenSpec({ name: 'a' })]));

    expect(section?.file).toBe('app/src/domain/generated/testids.ts');
    expect(section?.wholeFile).toBe(true);
    expect(section?.content).toContain('AUTO-GENERATED');
  });

  it('画面仕様を読み込めていなければ何も出さない', () => {
    expect(testIdsGenerator.generate(specModel([]), GEN_CTX)).toEqual([]);
  });

  it('スロット自身と部品の両方を定数にする(器にも testid が要る)', () => {
    const content = generate(ctxWith([workshopDetail()]));

    expect(content).toContain("'body.center': 'workshop_detail.body.center',");
    expect(content).toContain("'header.page_title': 'workshop_detail.header.page_title',");
  });

  it('排他表示の状態名はパスに現れない(DOM 上はどちらか一方しか無い)', () => {
    const content = generate(ctxWith([workshopDetail()]));

    expect(content).toContain("'body.center.entry_form': 'workshop_detail.body.center.entry_form',");
    expect(content).not.toContain('no_entry');
  });

  it('入れ子は親のスロットパスを継ぐ', () => {
    const content = generate(ctxWith([workshopDetail()]));

    expect(content).toContain(
      "'body.center.own_entry_panel.footer.submit_bar': 'workshop_detail.body.center.own_entry_panel.footer.submit_bar',",
    );
  });

  it('chrome の名前空間は chrome 名(画面と衝突しない)', () => {
    const content = generate(
      ctxWith([], [chromeSpec({ name: 'member', slots: [{ slot: 'header', components: ['app_header'] }] })]),
    );

    expect(content).toContain('export const memberChromeTestIds = {');
    expect(content).toContain("'header.app_header': 'member.header.app_header',");
  });

  it('画面名から表を引く索引を出す', () => {
    const content = generate(ctxWith([screenSpec({ name: 'workshop_list' })]));

    expect(content).toContain('export const workshopListTestIds = {');
    expect(content).toContain('  workshop_list: workshopListTestIds,');
  });

  it('重ね表示は overlay.{id}. を前置きにして同じ表に載る', () => {
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

    // 画面と重ね表示は同じスロット名を持てるので、前置きが無いとキーが衝突する。
    expect(content).toContain("'body.center.transition_bar': 'workshop_manage.body.center.transition_bar',");
    expect(content).toContain(
      "'overlay.cancel_confirm.body.center.confirm_bar': 'workshop_manage.overlay.cancel_confirm.body.center.confirm_bar',",
    );
  });

  it('画面が 0 件でも索引は空で出す(import 側が壊れない)', () => {
    expect(generate(ctxWith([]))).toContain('export const screenTestIds = {} as const;');
  });

  it('label を持つ部品があれば表示名の表({画面名}Labels)を同伴する(キーは testid と同じスロットパス)', () => {
    const content = generate(
      ctxWith([
        screenSpec({
          name: 'workshop_list',
          slots: [
            { slot: 'header', components: [{ name: 'page_title', label: '催し一覧' }] },
            { slot: 'body.center', components: ['workshop_table'] },
          ],
        }),
      ]),
    );

    expect(content).toContain('export const workshopListLabels = {');
    const labelsBlock = content.slice(content.indexOf('workshopListLabels'));
    expect(labelsBlock).toContain("'header.page_title': '催し一覧',");
    // label の無い部品はキーを持たない。
    expect(labelsBlock).not.toContain('workshop_table');
  });

  it('画面そのものの label は screenTitle のキーで同じ表に載る(スロットパスと衝突しない)', () => {
    const content = generate(
      ctxWith(
        [
          screenSpec({
            name: 'workshop_detail',
            label: '催し詳細',
            slots: [{ slot: 'body.center', components: ['workshop_summary'] }],
          }),
        ],
        [chromeSpec({ name: 'member', label: 'メンバー向けクローム' })],
      ),
    );

    expect(content).toContain("'screenTitle': '催し詳細',");
    expect(content).toContain("'screenTitle': 'メンバー向けクローム',");
    // 内部名で配線する testid の表は label に触れられない。
    expect(content).toContain("'body.center.workshop_summary': 'workshop_detail.body.center.workshop_summary',");
    expect(content).not.toContain('workshop_detail.screenTitle');
  });

  it('重ね表示の label(確認の見出し)は overlay.{id} のキーで表示名の表に載る(部品のキーと衝突しない)', () => {
    const content = generate(
      ctxWith([
        screenSpec({
          name: 'workshop_manage',
          slots: [{ slot: 'body.center', components: ['transition_bar'] }],
          overlays: [
            {
              id: 'cancel_confirm',
              openedBy: 'transition_bar',
              label: '催しを中止する',
              slots: [{ slot: 'body.center', components: [{ name: 'confirm_bar', label: '確認' }] }],
            },
            { id: 'plain_confirm', openedBy: 'transition_bar', slots: [{ slot: 'body.center', components: ['confirm_bar'] }] },
          ]
        }),
      ]),
    );

    const labelsBlock = content.slice(content.indexOf('workshopManageLabels'));
    expect(labelsBlock).toContain("'overlay.cancel_confirm': '催しを中止する',");
    expect(labelsBlock).toContain("'overlay.cancel_confirm.body.center.confirm_bar': '確認',");
    // label の無い重ね表示はキーを持たない。
    expect(labelsBlock).not.toContain('plain_confirm');
  });

  it('操作を伴わない navigations(on にドットが無い)は nav.{on} の骨格を持つ', () => {
    const content = generate(
      ctxWith([
        screenSpec({
          name: 'workshop_list',
          slots: [{ slot: 'body.center', components: ['workshop_table'] }],
          navigations: [{ on: 'workshop_selected', to: 'screen-workshop-detail' }],
        }),
      ]),
    );

    expect(content).toContain("'nav.workshop_selected': 'workshop_list.nav.workshop_selected',");
  });

  it('{event}.success 形の navigations は nav.{on} を出さない(actions 側に骨格を持つため)', () => {
    const content = generate(
      ctxWith([
        screenSpec({
          name: 'workshop_detail',
          slots: [{ slot: 'body.center', components: ['entry_form'] }],
          navigations: [{ on: 'entry.submit.success', to: 'screen-workshop-detail' }],
        }),
      ]),
    );

    expect(content).not.toContain('nav.entry');
  });

  it('共有クロームから展開された navigations(viaChrome あり)は画面側に nav.{on} を出さない', () => {
    const content = generate(
      ctxWith([
        screenSpec({
          name: 'workshop_list',
          navigations: [{ on: 'home_link', to: 'screen-workshop-list', viaChrome: 'chrome-member' }],
        }),
      ]),
    );

    expect(content).not.toContain('nav.home_link');
  });

  it('chrome 自身の navigations(操作を伴わない)も nav.{on} の骨格を持つ', () => {
    const content = generate(
      ctxWith(
        [],
        [
          chromeSpec({
            name: 'member',
            slots: [{ slot: 'header', components: ['app_header'] }],
            navigations: [{ on: 'home_link', to: 'screen-workshop-list' }],
          }),
        ],
      ),
    );

    expect(content).toContain("'nav.home_link': 'member.nav.home_link',");
  });

  it('label が 1 つも無い画面・chrome は表示名の表を出さない', () => {
    const content = generate(
      ctxWith(
        [screenSpec({ name: 'a' })],
        [chromeSpec({ name: 'member', slots: [{ slot: 'header', components: ['app_header'] }] })],
      ),
    );

    expect(content).not.toContain('Labels');
  });
});
