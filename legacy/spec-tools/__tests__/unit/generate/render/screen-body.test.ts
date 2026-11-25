import { describe, expect, it } from 'vitest';

import { screenBodyGenerator } from '../../../../lib/generate/render/screen-body.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { ChromeSpec, ScreenSpec } from '../../../../lib/model/screen/types.js';
import {
  accessSpec,
  aggregate,
  del,
  entitySpec,
  event,
  machine,
  specModel,
} from '../../../helpers/model-builder.js';
import { chromeSpec, screenSpec } from '../../../helpers/screen-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';

/** screen_spec / chrome_spec を読み込み済みの文脈を作る。 */
function ctxWith(
  screens: readonly ScreenSpec[],
  chromes: readonly ChromeSpec[] = [],
): GenerateContext {
  return {
    ...GEN_CTX,
    screens: { available: true, screens, chromes, unexposed: [], unreachableStates: [], unseenStates: [] },
  };
}

/** actions の接地先(遷移 submit と削除 delete を持つ entry 集約)。 */
function entryModel() {
  return specModel([
    aggregate('entry', {
      entity: entitySpec('entry'),
      stateMachines: [
        machine('entry', {
          states: ['draft', 'submitted'],
          initial: 'draft',
          stateLabels: { draft: '下書き' },
          events: [event('submit', { from: ['draft'], to: 'submitted', by: ['performer'] })],
        }),
      ],
      access: accessSpec('entry', { deletes: [del('performer', 'state == draft')] }),
    }),
  ]);
}

describe('screenBodyGenerator', () => {
  it('入場表・骨格・操作・重ね表示・遷移を screen_spec 個別ファイルへ生成する', () => {
    const screen = screenSpec({
      name: 'workshop_detail',
      group: 'workshop',
      route: '/workshops/:id',
      chrome: 'chrome-member',
      requiresAuth: true,
      subject: 'workshop',
      reads: ['query-workshop-detail'],
      actions: ['entry.submit'],
      overlays: [
        {
          id: 'delete_confirm',
          openedBy: 'submit_bar',
          actions: ['entry.delete'],
          closesOn: ['entry.delete.success', 'cancel'],
        },
      ],
      navigations: [
        { on: 'entry.submit.success', to: 'screen-workshop-detail' },
        { on: 'home_link', to: 'screen-workshop-list', viaChrome: 'chrome-member' },
      ],
      requires: ['error', 'not_found'],
    });
    const chrome = chromeSpec({ name: 'member' });

    const sections = screenBodyGenerator.generate(entryModel(), ctxWith([screen], [chrome]));
    const screenSection = sections.find((section) => section.marker === 'screen-body');

    expect(screenSection?.file).toBe('docs/specs/frontend/screens/workshop/workshop_detail.md');
    const content = screenSection?.content ?? '';
    expect(content).toContain('| route | `/workshops/:id` |');
    expect(content).toContain('| requires_auth | ✓ |');
    expect(content).toContain('| reads（query_spec） | query-workshop-detail |');
    expect(content).toContain('| 表示義務（states.requires） | error, not_found |');
    // 骨格は README のワイヤーフレームと同じレンダラー(chrome の外枠つき)
    expect(content).toContain('+-- chrome: member');
    expect(content).toContain('+-- screen: workshop_detail');
    expect(content).toContain('+-- overlay: delete_confirm (opened_by: submit_bar)');
    // 操作は画面と重ね表示を 1 母集合にし、ドメイン仕様の導出を併記する
    expect(content).toContain(
      '| `entry.submit` | 状態遷移(state_spec: entry) | performer | draft(下書き) → submitted | 画面 |',
    );
    expect(content).toContain(
      '| `entry.delete` | 削除(access_spec: entry の deletes) | performer | performer: `state == draft` | overlay: delete_confirm |',
    );
    expect(content).toContain('| delete_confirm | submit_bar | entry.delete | entry.delete.success, cancel |');
    // chrome から展開された遷移は宣言元で見分けられる
    expect(content).toContain('| entry.submit.success | screen-workshop-detail | 画面 |');
    expect(content).toContain('| home_link | screen-workshop-list | chrome-member |');
  });

  it('排他表示の部品はスロット・グループ・状態つきで表にする', () => {
    const screen = screenSpec({
      name: 'home',
      slots: [
        {
          slot: 'body.center',
          components: [
            { name: 'entry_form', variant: 'no_entry' },
            { name: 'own_entry_panel', variant: 'own_entry' },
          ],
        },
      ],
    });

    const content = screenBodyGenerator.generate(entryModel(), ctxWith([screen]))[0]?.content ?? '';

    expect(content).toContain('| body.center | 排他1 | no_entry | entry_form |');
    expect(content).toContain('| body.center | 排他1 | own_entry | own_entry_panel |');
  });

  it('操作・遷移の無い画面は「無い」と明示し、variants / overlays の節は畳む', () => {
    const content =
      screenBodyGenerator.generate(entryModel(), ctxWith([screenSpec({ name: 'home' })]))[0]
        ?.content ?? '';

    expect(content).toContain('この画面から発火できる操作はない');
    expect(content).toContain('この画面から出る遷移はない');
    expect(content).not.toContain('### 排他表示');
    expect(content).not.toContain('### 重ね表示');
  });

  it('chrome_spec には骨格・遷移・継承している画面を生成する', () => {
    const chrome = chromeSpec({
      name: 'member',
      navigations: [{ on: 'home_link', to: 'screen-workshop-list' }],
    });
    const inheritor = screenSpec({ name: 'workshop_detail', route: '/workshops/:id', chrome: 'chrome-member' });

    const sections = screenBodyGenerator.generate(entryModel(), ctxWith([inheritor], [chrome]));
    const chromeSection = sections.find((section) => section.marker === 'chrome-body');

    expect(chromeSection?.file).toBe('docs/specs/frontend/chrome/member.md');
    const content = chromeSection?.content ?? '';
    expect(content).toContain('+-- chrome: member');
    expect(content).toContain('| home_link | screen-workshop-list |');
    expect(content).toContain('| screen-workshop-detail | `/workshops/:id` |');
  });

  it('screen_spec を読み込んでいない文脈では何も生成しない', () => {
    expect(screenBodyGenerator.generate(entryModel(), GEN_CTX)).toHaveLength(0);
  });
});
