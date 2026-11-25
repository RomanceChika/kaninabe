/**
 * 画面の部品のフォーム(`kind: form`)の**確認ダイアログの経路**(ADR-0015 の改訂 2 / screen-spec-writing.md
 * 「確認の器は overlay に統一する」)。
 *
 * 確かめるのは 3 つの向きである。
 *   - 導出: 操作の確認の要否(`action-attributes` の `confirmRequired` = 方針の導出)と、確認の器(その部品を `opened_by` に
 *     持ち、その操作を `actions` に含む重ね表示)が、フォームの計画に載る。題材の製品の作成・編集は 23 本とも「確認なし」なので、
 *     この経路は**架空の仕様**(`ux: { confirm: required }` の上書き)で赤 → 緑を固定する。
 *   - 字面: 確認の要るフォームだけが `ConfirmDialog` の配線(重ね表示の testid・見出し・文言・注意書きの出どころ)を持ち、
 *     要らないフォームは 1 バイトも変わらない。部品の子の `confirm_bar` は無い。
 *   - 葉の表: 確認の器はフォームの葉ではなく、重ね表示の部品(`overlays` の部品)である。
 *
 * アプリの語彙は 1 語も使わない(W1)。
 */

import { describe, expect, it } from 'vitest';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { renderScreenFormBody } from '../../../../lib/generate/render/screen-form-body.js';
import {
  buildScreenForms,
  screenFormExport,
  screenFormFile,
} from '../../../../lib/generate/render/screen-form-plan.js';
import type { ScreenFormPlan } from '../../../../lib/generate/render/screen-form-plan.js';
import { screenRoutesGenerator } from '../../../../lib/generate/render/code-screens.js';
import { createRule, accessSpec, aggregate, entitySpec, field, role, specModel, stubContext } from '../../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT, TEST_BODY_MODULES } from '../../../helpers/platform.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** 作成だけを持つ 1 集約の架空のドメイン。 */
const DOMAIN = specModel({
  roles: [role('anonymous'), role('member'), role('system')],
  aggregates: [
    aggregate({
      name: 'widget',
      entity: entitySpec('widget', [field('id', { kind: 'uuid' }), field('name', { kind: 'string' }, { required: true })]),
      access: accessSpec('widget', { creates: [createRule('member')] }),
    }),
  ],
});

/** 確認の重ね表示(その部品を `opened_by` に持ち、操作を `actions` に含み、`body.center` に `confirm_bar` を置く)。 */
const CONFIRM_OVERLAY = {
  id: 'create_confirm',
  openedBy: 'widget_form',
  label: '部品を登録する',
  actions: ['widget.create'],
  slots: [{ slot: 'body.center', components: ['confirm_bar'] }],
} as const;

/** 生成の文脈。`ux` を渡すと、その操作の方針の導出を上書きする。`overlay: false` は確認の重ね表示を宣言しない画面。 */
function context(ux?: { confirm: 'none' | 'required'; reason: string }, overlay = true): GenerateContext {
  const { guards } = stubContext();
  const screen = screenSpec({
    name: 'widget_admin',
    actions: ['widget.create'],
    ...(overlay ? { overlays: [CONFIRM_OVERLAY] } : {}),
    slots: [{ slot: 'body.center', components: [{ name: 'widget_form', kind: 'form', action: 'widget.create' }] }],
  });
  return {
    guards,
    roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES,
    actions: {
      actions: [actionSpec({ handles: 'widget.create', input: ['widget.name'], ...(ux === undefined ? {} : { ux }) })],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    },
    dataTables: dataTableModel([
      dataTable('widgets', {
        entity: 'widget',
        functions: [
          { name: 'insert_widget', args: ['text'], params: ['p_name'], kind: 'rpc', shape: 'create', alsoWrites: [] },
        ],
      }),
    ]),
    screens: {
      available: true,
      screens: [screen],
      chromes: [],
      unexposed: [],
      unreachableStates: [],
      unseenStates: [],
    },
  };
}

/** 本体を 1 つの文字列にする。 */
function source(plan: ScreenFormPlan): string {
  return renderScreenFormBody(plan, 'docs/specs/frontend/screens/admin/widget_admin.md', TEST_BODY_MODULES).join('\n');
}

/** 手で組んだ計画(確認の要否と確認の器だけを変える)。 */
function planWith(confirmRequired: boolean, confirmOverlay?: ScreenFormPlan['confirmOverlay']): ScreenFormPlan {
  return {
    screen: 'widget_admin',
    component: 'widget_form',
    path: 'body.center.widget_form',
    label: '部品を足す',
    action: 'widget.create',
    shape: 'create',
    entity: 'widget',
    controls: [{ field: 'name', kind: 'text' }],
    supplied: [],
    hasEnumLabels: false,
    confirmRequired,
    ...(confirmOverlay === undefined ? {} : { confirmOverlay }),
    file: screenFormFile('widget_admin', 'widget_form'),
    exportName: screenFormExport('widget_admin', 'widget_form'),
  };
}

describe('確認の要否と確認の器の導出', () => {
  it('方針の導出が確認を要求しない作成のフォームは確認を挟まない(重ね表示があっても確認の器を持たない)', () => {
    const plans = buildScreenForms(DOMAIN, context());

    expect(plans).toHaveLength(1);
    expect(plans[0]?.confirmRequired).toBe(false);
    expect(plans[0]?.confirmOverlay).toBeUndefined();
  });

  it('action_spec の ux で確認ありに上書きした操作のフォームは確認を挟み、確認の器(重ね表示)を計画に持つ', () => {
    const plans = buildScreenForms(DOMAIN, context({ confirm: 'required', reason: '取り消せないため' }));

    expect(plans).toHaveLength(1);
    expect(plans[0]?.confirmRequired).toBe(true);
    expect(plans[0]?.confirmOverlay).toEqual({
      id: 'create_confirm',
      dialog: 'overlay.create_confirm.body.center',
      bar: 'overlay.create_confirm.body.center.confirm_bar',
      labelKey: 'overlay.create_confirm',
    });
  });

  it('確認が要るのに重ね表示が無ければ確認の器を持たない(検査 S19 が先に止める。生成器は throw しない)', () => {
    const plans = buildScreenForms(DOMAIN, context({ confirm: 'required', reason: '取り消せないため' }, false));

    expect(plans[0]?.confirmRequired).toBe(true);
    expect(plans[0]?.confirmOverlay).toBeUndefined();
  });

  it('別の部品を opened_by にした重ね表示・別の操作を載せた重ね表示は、確認の器にならない', () => {
    const ux = { confirm: 'required', reason: '取り消せないため' } as const;
    const base = context(ux);
    const screen = base.screens?.screens[0];
    if (screen === undefined) throw new Error('画面がありません');
    const withOverlay = (overlay: typeof CONFIRM_OVERLAY | (Omit<typeof CONFIRM_OVERLAY, 'openedBy'> & { openedBy: string }) | (Omit<typeof CONFIRM_OVERLAY, 'actions'> & { actions: string[] })) =>
      buildScreenForms(DOMAIN, {
        ...base,
        screens: {
          available: true,
          screens: [
            screenSpec({
              name: 'widget_admin',
              actions: ['widget.create'],
              overlays: [overlay],
              slots: [{ slot: 'body.center', components: [{ name: 'widget_form', kind: 'form', action: 'widget.create' }] }],
            }),
          ],
          chromes: [],
          unexposed: [],
          unreachableStates: [],
          unseenStates: [],
        },
      });

    expect(withOverlay({ ...CONFIRM_OVERLAY, openedBy: 'other_part' })[0]?.confirmOverlay).toBeUndefined();
    expect(withOverlay({ ...CONFIRM_OVERLAY, actions: ['widget.delete'] })[0]?.confirmOverlay).toBeUndefined();
  });

  it('重ね表示に label が無ければ、確認の見出しのキーを持たない', () => {
    const base = context({ confirm: 'required', reason: '取り消せないため' });
    const plans = buildScreenForms(DOMAIN, {
      ...base,
      screens: {
        available: true,
        screens: [
          screenSpec({
            name: 'widget_admin',
            actions: ['widget.create'],
            overlays: [{ id: 'create_confirm', openedBy: 'widget_form', actions: ['widget.create'], slots: CONFIRM_OVERLAY.slots }],
            slots: [{ slot: 'body.center', components: [{ name: 'widget_form', kind: 'form', action: 'widget.create' }] }],
          }),
        ],
        chromes: [],
        unexposed: [],
        unreachableStates: [],
        unseenStates: [],
      },
    });

    expect(plans[0]?.confirmOverlay).toEqual({
      id: 'create_confirm',
      dialog: 'overlay.create_confirm.body.center',
      bar: 'overlay.create_confirm.body.center.confirm_bar',
    });
  });
});

describe('確認ダイアログの字面', () => {
  const overlay = {
    id: 'create_confirm',
    dialog: 'overlay.create_confirm.body.center',
    bar: 'overlay.create_confirm.body.center.confirm_bar',
    labelKey: 'overlay.create_confirm',
  };
  const text = source(planWith(true, overlay));

  it('確認の要るフォームは ActionForm に確認の配線を渡す(testid は重ね表示の器と中身 — 部品の子の葉ではない)', () => {
    expect(text).toContain('confirm={{');
    expect(text).toContain("const CONFIRM_DIALOG = widgetAdminTestIds['overlay.create_confirm.body.center'];");
    expect(text).toContain("const CONFIRM_BAR = widgetAdminTestIds['overlay.create_confirm.body.center.confirm_bar'];");
    expect(text).toContain('dialogTestId: CONFIRM_DIALOG');
    expect(text).toContain('confirmBarTestId: CONFIRM_BAR');
    expect(text).toContain('message: CONFIRM_MESSAGE');
    expect(text).toContain('confirmLabel: CONFIRM_LABEL');
    // 部品の子の `confirm_bar` は廃止した。
    expect(text).not.toContain('${TESTID}.confirm_bar');
    expect(text).not.toContain('confirm_dialog');
  });

  it('確認の見出しは重ね表示の label(無ければ送信ボタンの文言)で、確認の文言は「{見出し}。{注意書き}」(注意書きは生成物 action-attributes から)', () => {
    expect(text).toContain("const CONFIRM_LABEL = widgetAdminLabels['overlay.create_confirm'];");
    expect(text).toContain("import { actionAttributesFor } from '@/domain/generated/action-attributes';");
    expect(text).toContain("const CONFIRM_MESSAGE = `${CONFIRM_LABEL}。${actionAttributesFor('widget.create').confirmNotes.join('')}`;");

    const noLabel = source(planWith(true, { id: 'create_confirm', dialog: overlay.dialog, bar: overlay.bar }));
    expect(noLabel).toContain('const CONFIRM_LABEL = TITLE;');
    expect(noLabel).not.toContain("widgetAdminLabels['overlay");
  });

  it('確認の要らないフォーム・確認の器が無いフォームは確認の配線を 1 つも持たない(出力が変わらない)', () => {
    for (const plain of [source(planWith(false)), source(planWith(true))]) {
      expect(plain).not.toContain('confirm');
      expect(plain).not.toContain('action-attributes');
    }
  });

  it('葉の表: フォームの葉は送信だけ(確認の器は重ね表示の部品で、フォームの葉に数えない)', () => {
    const leaves = (ux?: { confirm: 'none' | 'required'; reason: string }): string => {
      const sections = screenRoutesGenerator.generate(DOMAIN, context(ux));
      return sections.map((section) => section.content).join('\n');
    };

    expect(leaves({ confirm: 'required', reason: '取り消せないため' })).not.toContain("'confirm_bar.confirm'");
    // 重ね表示の部品としては配線表に載る(開いたときに描かれるもの)。
    expect(leaves({ confirm: 'required', reason: '取り消せないため' })).toContain('widget_admin.overlay.create_confirm.body.center.confirm_bar');
  });
});
