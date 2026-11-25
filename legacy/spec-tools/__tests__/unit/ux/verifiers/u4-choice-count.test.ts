/**
 * U4(同時操作数)のテスト。
 *
 * ux-lint.md の U4 が要求する 3 つ(状態ごとに数えること・閾値の境界・予約 ID の条件で
 * 絞ること)にケースを置く。状態機械に触れない画面の扱いも検査対象に含める。
 */

import { describe, expect, it } from 'vitest';
import { choiceCountVerifier } from '../../../../lib/ux/verifiers/u4-choice-count.js';
import { MAX_SIMULTANEOUS_ACTIONS } from '../../../../lib/model/ux/types.js';
import {
  accessSpec,
  aggregate,
  del,
  entitySpec,
  event,
  field,
  machine,
  specModel,
} from '../../../helpers/model-builder.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { UX_CTX, uxInput } from '../../../helpers/ux-builder.js';

/** open 状態から実行できるイベントを count 個持つ状態機械のモデル。deleteWhen は物理削除の条件。 */
function domainWith(count: number, deleteWhen?: string) {
  const events = Array.from({ length: count }, (_, index) =>
    event(`e${index}`, { from: ['open'], to: 'closed' }),
  );
  return specModel([
    aggregate('thing', {
      entity: entitySpec('thing', { fields: [field('state', { kind: 'state', machine: 'thing' })] }),
      stateMachines: [
        machine('thing', { states: ['open', 'closed'], initial: 'open', events }),
      ],
      access: accessSpec('thing', { deletes: [del('member', deleteWhen)] }),
    }),
  ]);
}

/** `e0`〜`e{count-1}` の操作 ID。 */
function eventIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `thing.e${index}`);
}

describe('U4 同時操作数', () => {
  it('閾値は文脈(台帳から引いたもの)が決める — 上げれば通り、下げれば指摘する', () => {
    const actions = eventIds(MAX_SIMULTANEOUS_ACTIONS + 1);
    const input = uxInput({ domain: domainWith(actions.length), screens: [screenSpec({ name: 's', actions })] });
    const limits = (maxSimultaneousActions: number) => ({ ...UX_CTX, limits: { maxSimultaneousActions, maxWritableFields: 7 } });

    expect(choiceCountVerifier.verify(input, limits(MAX_SIMULTANEOUS_ACTIONS + 1))).toEqual([]);
    const lowered = choiceCountVerifier.verify(input, limits(3));
    expect(lowered[0]?.finding.counterexample?.['limit']).toBe('3');
    expect(lowered[0]?.finding.message).toContain('目安 3 個');
  });

  it('閾値ちょうどは通る(超えたときだけ警告する)', () => {
    const actions = eventIds(MAX_SIMULTANEOUS_ACTIONS);
    const findings = choiceCountVerifier.verify(
      uxInput({ domain: domainWith(actions.length), screens: [screenSpec({ name: 's', actions })] }),
      UX_CTX,
    );

    expect(findings).toEqual([]);
  });

  it('1 つの状態で閾値を超えると警告する', () => {
    const actions = eventIds(MAX_SIMULTANEOUS_ACTIONS + 1);
    const findings = choiceCountVerifier.verify(
      uxInput({ domain: domainWith(actions.length), screens: [screenSpec({ name: 's', actions })] }),
      UX_CTX,
    );

    // open でだけ並ぶ。closed では 1 つも並ばない。
    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe('U4');
    expect(findings[0]?.subject).toBe('thing.open');
    expect(findings[0]?.finding.severity).toBe('warning');
    expect(findings[0]?.finding.counterexample?.['state']).toBe('thing.open');
  });

  it('宣言の総数が閾値を超えても、状態で分かれていれば通る', () => {
    // 8 個の操作を宣言していても、遷移表が 4 個ずつに分けていれば同時には並ばない。
    const events = [
      ...Array.from({ length: 4 }, (_, i) => event(`a${i}`, { from: ['open'], to: 'closed' })),
      ...Array.from({ length: 4 }, (_, i) => event(`b${i}`, { from: ['closed'], to: 'open' })),
    ];
    const domain = specModel([
      aggregate('thing', {
        entity: entitySpec('thing', { fields: [field('state', { kind: 'state', machine: 'thing' })] }),
        stateMachines: [machine('thing', { states: ['open', 'closed'], initial: 'open', events })],
      }),
    ]);
    const actions = events.map((e) => `thing.${e.id}`);

    expect(choiceCountVerifier.verify(uxInput({ domain, screens: [screenSpec({ name: 's', actions })] }), UX_CTX)).toEqual([]);
  });

  it('予約 ID は when が許す状態でだけ数える', () => {
    const actions = [...eventIds(MAX_SIMULTANEOUS_ACTIONS), 'thing.delete'];
    const findings = choiceCountVerifier.verify(
      uxInput({
        domain: domainWith(MAX_SIMULTANEOUS_ACTIONS, 'state == closed'),
        screens: [screenSpec({ name: 's', actions })],
      }),
      UX_CTX,
    );

    expect(findings).toEqual([]);
  });

  it('条件の無い予約 ID はどの状態でも数える', () => {
    const actions = [...eventIds(MAX_SIMULTANEOUS_ACTIONS), 'thing.delete'];
    const findings = choiceCountVerifier.verify(
      uxInput({
        domain: domainWith(MAX_SIMULTANEOUS_ACTIONS),
        screens: [screenSpec({ name: 's', actions })],
      }),
      UX_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.subject).toBe('thing.open');
  });

  it('状態機械に触れない画面は宣言の数をそのまま数える', () => {
    // 接地しない ID は S2 がエラーにする。U4 は「ボタンはボタン」として数える(数え落とさない)。
    const actions = Array.from({ length: MAX_SIMULTANEOUS_ACTIONS + 1 }, (_, i) => `ui.op${i}`);
    const findings = choiceCountVerifier.verify(
      uxInput({ domain: domainWith(0), screens: [screenSpec({ name: 's', actions })] }),
      UX_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.subject).toBe('');
    expect(findings[0]?.finding.counterexample?.['state']).toBeUndefined();
  });

  describe('部品ごとの数え方(kind を持つ部品は部品の実数で数え、手書きの部品の操作は画面の和)', () => {
    /** `kind: actions` の部品 1 つだけを持つ画面。 */
    function withPart(buttons: readonly string[], more: readonly string[] = [], count = buttons.length) {
      return choiceCountVerifier.verify(
        uxInput({
          domain: domainWith(Math.max(count, more.length, 1) + 8),
          screens: [
            screenSpec({
              name: 's',
              actions: [...buttons, ...more],
              slots: [{ slot: 'body.center', components: [{ name: 'bar', kind: 'actions', reads: 'q', buttons }] }],
            }),
          ],
        }),
        UX_CTX,
      );
    }

    it('部品が載せた操作は、画面の和ではなく部品の実数で数える(8 個を宣言しても部品が閾値以下なら通る)', () => {
      const buttons = eventIds(MAX_SIMULTANEOUS_ACTIONS);
      // 8 個目は別の部品(宣言だけの手書き)で、画面の和は 8 でも部品側は 7、残りは 1。
      expect(withPart(buttons, ['thing.e7'])).toEqual([]);
    });

    it('部品の中が閾値を超えたら、部品の名前と状態を添えて指摘する', () => {
      const findings = withPart(eventIds(MAX_SIMULTANEOUS_ACTIONS + 1));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.subject).toBe('bar/thing.open');
      expect(findings[0]?.finding.message).toContain('部品 bar');
      expect(findings[0]?.finding.counterexample?.['part']).toBe('bar');
    });

    it('部品に載らない操作(手書きの部品が持つもの)は従来どおり画面の和で数える', () => {
      const rest = Array.from({ length: MAX_SIMULTANEOUS_ACTIONS + 1 }, (_, index) => `thing.e${index + 20}`);
      const findings = choiceCountVerifier.verify(
        uxInput({
          domain: domainWith(40),
          screens: [
            screenSpec({
              name: 's',
              actions: ['thing.e0', ...rest],
              slots: [{ slot: 'body.center', components: [{ name: 'bar', kind: 'actions', reads: 'q', buttons: ['thing.e0'] }] }],
            }),
          ],
        }),
        UX_CTX,
      );

      expect(findings.map((finding) => finding.subject)).toEqual(['thing.open']);
    });

    it('フォームは 1 個・表の編集は 1 個として、行のボタンに足す', () => {
      const buttons = eventIds(MAX_SIMULTANEOUS_ACTIONS);
      const findings = choiceCountVerifier.verify(
        uxInput({
          domain: domainWith(MAX_SIMULTANEOUS_ACTIONS + 1),
          screens: [
            screenSpec({
              name: 's',
              actions: [...buttons, 'thing.e7'],
              slots: [
                {
                  slot: 'body.center',
                  components: [
                    { name: 'rows', kind: 'table', reads: 'q', buttons, edit: 'thing.e7' },
                    { name: 'form', kind: 'form', action: 'thing.e7' },
                  ],
                },
              ],
            }),
          ],
        }),
        UX_CTX,
      );

      // 表は行のボタン 7 + 編集 1 = 8 > 7(open 状態)。フォーム(1)は閾値以下。
      expect(findings.map((finding) => finding.subject)).toEqual(['rows/thing.open']);
    });

    it('重ね表示の中の部品も数える', () => {
      const findings = choiceCountVerifier.verify(
        uxInput({
          domain: domainWith(MAX_SIMULTANEOUS_ACTIONS + 1),
          screens: [
            screenSpec({
              name: 's',
              overlays: [
                {
                  id: 'dialog',
                  slots: [
                    {
                      slot: 'body.center',
                      components: [{ name: 'bar', kind: 'actions', reads: 'q', buttons: eventIds(MAX_SIMULTANEOUS_ACTIONS + 1) }],
                    },
                  ],
                },
              ],
            }),
          ],
        }),
        UX_CTX,
      );

      expect(findings.map((finding) => finding.subject)).toEqual(['bar/thing.open']);
    });
  });
});
