/**
 * U1(破壊的操作の確認)のテスト。
 *
 * ux-lint.md の U1 が要求すること: **確認が要るかは操作の属性の導出(`confirmRequired`)そのもの**であり、
 * 式の 4 項(負の tone・物理削除・戻る遷移が無く他人に影響する・確定)と action_spec の `ux` の上書きが
 * そのまま効くこと。確認の重ね表示の判定(`opened_by` が要る)も検査対象に含める。
 */

import { describe, expect, it } from 'vitest';
import { destructiveConfirmVerifier } from '../../../../lib/ux/verifiers/u1-destructive-confirm.js';
import type { ActionSpec } from '../../../../lib/model/trace/types.js';
import {
  accessSpec,
  aggregate,
  del,
  entitySpec,
  event,
  field,
  machine,
  role,
  roleSpec,
  specModel,
} from '../../../helpers/model-builder.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { actionSpec } from '../../../helpers/trace-builder.js';
import { UX_CTX, uxInput } from '../../../helpers/ux-builder.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';

/**
 * entry: draft ⇄(submit / revise)⇄ submitted。
 *   - withdraw(submitted → withdrawn): withdrawn は tone: negative(式の 1 項目)
 *   - lock(submitted → locked): locked は settles を持つ(式の 4 項目)
 *   - archive(draft → archived): 戻る遷移が無く、by が所有者でない member(式の 3 項目)
 * 下書きは物理削除できる(式の 2 項目)。submit / revise は可逆で所有者本人のみ(どれも要らない)。
 */
const DOMAIN = specModel(
  [
    aggregate('entry', {
      entity: entitySpec('entry', { fields: [field('state', { kind: 'state', machine: 'entry' })] }),
      stateMachines: [
        machine('entry', {
          states: ['draft', 'submitted', 'withdrawn', 'locked', 'archived'],
          initial: 'draft',
          final: ['withdrawn'],
          stateTone: { withdrawn: 'negative' },
          stateSettles: { locked: ['fee'] },
          settlesVocabulary: { fee: '料金' },
          events: [
            event('submit', { from: ['draft'], to: 'submitted', by: ['performer'] }),
            event('revise', { from: ['submitted'], to: 'draft', by: ['performer'] }),
            event('withdraw', { from: ['submitted'], to: 'withdrawn', by: ['performer'] }),
            event('lock', { from: ['submitted'], to: 'locked', by: ['performer'] }),
            event('archive', { from: ['draft'], to: 'archived', by: ['member'] }),
          ],
        }),
      ],
      access: accessSpec('entry', { deletes: [del('performer', 'state == draft')] }),
    }),
  ],
  roleSpec([role('member'), role('performer', 'entry.performer_id == actor.id', ['member'])]),
);

/** U1 を実行して指摘を返す(`actions` は action_spec。省略すると上書きなし)。 */
function run(init: Parameters<typeof uxInput>[0], actions?: readonly ActionSpec[]) {
  const ctx = actions === undefined ? UX_CTX : { ...UX_CTX, actions: loadedInput({ actions, unhandled: [], scans: [], unscanned: [], testTagBaseline: [] }) };
  return destructiveConfirmVerifier.verify(uxInput({ domain: DOMAIN, ...init }), ctx);
}

describe('U1 破壊的操作の確認', () => {
  it('負の意味の状態への遷移を直のボタンで起こすと警告する(subject は画面の接頭辞を除いた操作 ID)', () => {
    const findings = run({ screens: [screenSpec({ name: 'detail', actions: ['entry.submit', 'entry.withdraw'] })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe('U1');
    expect(findings[0]?.screens).toEqual(['screen-detail']);
    expect(findings[0]?.subject).toBe('entry.withdraw');
    expect(findings[0]?.finding.severity).toBe('warning');
    expect(findings[0]?.finding.message).toContain('負の意味の状態への遷移');
  });

  it('物理削除(deletes)は確認が要る', () => {
    const findings = run({ screens: [screenSpec({ name: 'detail', actions: ['entry.delete'] })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.finding.message).toContain('取り返しのつかない削除');
  });

  it('値を確定させる遷移(settles)は確認が要る', () => {
    const findings = run({ screens: [screenSpec({ name: 'detail', actions: ['entry.lock'] })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.finding.message).toContain('料金を確定させる遷移');
  });

  it('戻る遷移が無く他の人にも影響する遷移は確認が要る', () => {
    const findings = run({ screens: [screenSpec({ name: 'detail', actions: ['entry.archive'] })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.subject).toBe('entry.archive');
    expect(findings[0]?.finding.message).toContain('戻る遷移が無く、他の人にも影響する');
  });

  it('導出が要らないとする操作(可逆・所有者のみ・確定しない)は対象にしない', () => {
    const findings = run({ screens: [screenSpec({ name: 'detail', actions: ['entry.submit', 'entry.revise'] })] });

    expect(findings).toEqual([]);
  });

  it('action_spec の ux: confirm: none で上書きした操作は、確認が要らないものとして扱う', () => {
    const findings = run(
      { screens: [screenSpec({ name: 'detail', actions: ['entry.withdraw'] })] },
      [actionSpec({ handles: 'entry.withdraw', ux: { confirm: 'none', reason: '取下げは日常操作' } })],
    );

    expect(findings).toEqual([]);
  });

  it('action_spec の ux: confirm: required で上書きした操作は、導出が要らなくても確認が要る', () => {
    const findings = run(
      { screens: [screenSpec({ name: 'detail', actions: ['entry.submit'] })] },
      [actionSpec({ handles: 'entry.submit', ux: { confirm: 'required', reason: '提出は慎重に' } })],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.finding.message).toContain('action_spec の ux で確認を要るとしている');
  });

  it('opened_by を持つ重ね表示から実行するなら通る', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'detail',
          overlays: [{ id: 'withdraw_confirm', openedBy: 'action_bar', actions: ['entry.withdraw'] }],
        }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('画面本体にも同じ操作が書かれていても、確認があれば通る', () => {
    const findings = run({
      screens: [
        screenSpec({
          name: 'detail',
          actions: ['entry.withdraw'],
          overlays: [{ id: 'withdraw_confirm', openedBy: 'action_bar', actions: ['entry.withdraw'] }],
        }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('opened_by の無い重ね表示は確認と認めない', () => {
    // 開くきっかけが書かれていない重ね表示は、押す前に挟まる保証が仕様に無い。
    const findings = run({
      screens: [screenSpec({ name: 'detail', overlays: [{ id: 'withdraw_confirm', actions: ['entry.withdraw'] }] })],
    });

    expect(findings).toHaveLength(1);
  });

  it('同じ操作を複数回書いても指摘は 1 件', () => {
    const findings = run({
      screens: [screenSpec({ name: 'detail', actions: ['entry.withdraw'], overlays: [{ id: 'x', actions: ['entry.withdraw'] }] })],
    });

    expect(findings).toHaveLength(1);
  });

  it('画面をまだ仕様化していないリポジトリでは何も見ない', () => {
    const findings = destructiveConfirmVerifier.verify(
      uxInput({ domain: DOMAIN, screensUnavailable: true }),
      UX_CTX,
    );

    expect(findings).toEqual([]);
  });

  it('action_spec が阻害(採ったのに渡せない)なら判定を出さない。未選択は「action_spec は無い」事実で従来どおり判定する', () => {
    const screens = [screenSpec({ name: 'detail', actions: ['entry.withdraw'] })];
    const input = uxInput({ domain: DOMAIN, screens });

    expect(destructiveConfirmVerifier.verify(input, { ...UX_CTX, actions: blockedInput('invalid') })).toEqual([]);
    expect(destructiveConfirmVerifier.verify(input, { ...UX_CTX, actions: UNSELECTED })).toHaveLength(1);
  });
});
