/**
 * S6(レイアウト)のテスト。
 *
 * screen-spec-writing.md の S6 が要求する 5 つ(スロット値域・コンポーネント名の形式・
 * 1 スロット内の部品名の一意・画面内の重ね表示 id の一意・空の layout)にケースを置く。
 * chrome 自身と重ね表示のレイアウトも同じ検査にかかることを確認する。
 *
 * **chrome と画面のスロットは衝突しない**(chrome は外枠、画面はその内側)ことも
 * 挙動として固定する。
 */

import { describe, expect, it } from 'vitest';
import { layoutVerifier } from '../../../../lib/screen/verifiers/s6-layout.js';
import {
  SCREEN_CTX,
  chromeSpec,
  screenInput,
  screenSpec,
} from '../../../helpers/screen-builder.js';

/** S6 を実行して Finding を返す。 */
function run(init: Parameters<typeof screenInput>[0]) {
  return layoutVerifier.verify(screenInput(init), SCREEN_CTX);
}

describe('S6 レイアウト', () => {
  it('値域のスロットと snake_case の部品なら通る', () => {
    const findings = run({
      chromes: [chromeSpec({ name: 'member' })],
      screens: [
        screenSpec({
          name: 'a',
          chrome: 'chrome-member',
          slots: [
            { slot: 'header', components: ['page_title'] },
            { slot: 'body.left', components: ['filter_panel'] },
            { slot: 'body.center', components: ['entry_form'] },
            { slot: 'body.right', components: ['side_note'] },
            { slot: 'footer', components: ['submit_bar'] },
          ],
        }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('chrome と画面が同じスロットを宣言しても衝突にしない(chrome は外枠)', () => {
    const findings = run({
      chromes: [chromeSpec({ name: 'member', slots: [{ slot: 'header', components: ['app_header'] }] })],
      screens: [
        screenSpec({
          name: 'a',
          chrome: 'chrome-member',
          slots: [{ slot: 'header', components: ['page_title'] }],
        }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('語彙に無いスロットを検出する', () => {
    const findings = run({
      screens: [screenSpec({ name: 'a', slots: [{ slot: 'body.top', components: ['x'] }] })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('body.top');
  });

  it('入れ子のスロットも同じ語彙で見て、フルパスで示す', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'a',
          slots: [
            { slot: 'body.center', components: ['own_entry'] },
            { slot: 'footer', components: ['submit_bar'], owner: 'own_entry' },
            { slot: 'aside', components: ['note'], owner: 'own_entry' },
          ],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('body.center.own_entry.aside');
  });

  it('snake_case でないコンポーネント名を検出する', () => {
    const findings = run({
      screens: [screenSpec({ name: 'a', slots: [{ slot: 'header', components: ['EntryForm'] }] })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('EntryForm');
  });

  it('1 つのスロットに同じ部品が 2 つあれば失敗する', () => {
    const findings = run({
      screens: [
        screenSpec({ name: 'a', slots: [{ slot: 'body.center', components: ['row', 'row'] }] }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('部品 row が 2 つあります');
  });

  it('別のスロットに同じ部品名があるのは許す', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'a',
          slots: [
            { slot: 'header', components: ['title'] },
            { slot: 'footer', components: ['title'] },
          ],
        }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('1 つのレイアウトの中で label(表示名)が重複していれば失敗する', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'a',
          slots: [
            { slot: 'header', components: [{ name: 'page_title', label: '催し一覧' }] },
            { slot: 'body.center', components: [{ name: 'workshop_table', label: '催し一覧' }] },
          ],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('label "催し一覧" が page_title と workshop_table で重複しています');
  });

  it('label が違えば通り、宣言の無い部品はいくつあっても通る', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'a',
          slots: [
            { slot: 'header', components: [{ name: 'page_title', label: '催し一覧' }] },
            { slot: 'body.center', components: [{ name: 'workshop_table', label: '催しの表' }, 'note', 'hint'] },
          ],
        }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('画面内で重ね表示の id が重複していれば失敗する', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'a',
          slots: [{ slot: 'body.center', components: ['open_button'] }],
          overlays: [
            { id: 'report_dialog', openedBy: 'open_button' },
            { id: 'report_dialog', openedBy: 'open_button' },
          ],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('重ね表示 report_dialog が 2 つあります');
  });

  it('スロットがひとつも無い layout をエラーにする', () => {
    const findings = run({ screens: [screenSpec({ name: 'a', slots: [] })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('スロットが 1 つもありません');
  });

  it('排他表示(variants)の部品も、素の部品と同じ一意性の規則を受ける', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'a',
          slots: [
            {
              slot: 'body.center',
              components: ['entry_form', { name: 'entry_form', variant: 'own_entry' }],
            },
          ],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('部品 entry_form が 2 つあります');
  });

  it('排他表示の状態名が snake_case でなければ失敗する', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'a',
          slots: [{ slot: 'body.center', components: [{ name: 'entry_form', variant: 'NoEntry' }] }],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('排他表示の状態名 NoEntry が snake_case ではありません');
  });

  it('同じ排他グループに同じ状態名が 2 つあれば失敗する(「どれか 1 つ」が決まらない)', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'a',
          slots: [
            {
              slot: 'body.center',
              components: [
                { name: 'entry_form', variant: 'no_entry' },
                { name: 'other_form', variant: 'no_entry' },
              ],
            },
          ],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('排他表示の状態 no_entry が 2 つあります');
  });

  it('別の排他グループなら同じ状態名を使ってよい', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'a',
          slots: [
            {
              slot: 'body.center',
              components: [
                { name: 'entry_form', variant: 'empty', group: 0 },
                { name: 'side_panel', variant: 'empty', group: 1 },
              ],
            },
          ],
        }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('予約語 variants を部品名にすれば失敗する(排他グループの宣言と読み分けられない)', () => {
    const findings = run({
      screens: [screenSpec({ name: 'a', slots: [{ slot: 'body.center', components: ['variants'] }] })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('variants は予約語なので部品名に使えません');
  });

  it('chrome 自身のレイアウトも語彙を見る', () => {
    const findings = run({
      chromes: [chromeSpec({ name: 'member', slots: [{ slot: 'sidebar', components: ['nav'] }] })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('sidebar');
  });

  it('重ね表示のレイアウトも語彙を見る', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'a',
          overlays: [{ id: 'dialog', slots: [{ slot: 'body.middle', components: ['form'] }] }],
        }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('重ね表示 dialog のスロット body.middle');
  });
});
