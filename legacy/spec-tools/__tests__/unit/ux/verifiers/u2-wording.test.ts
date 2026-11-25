/**
 * U2(操作の語の一貫性)のテスト。
 *
 * ux-lint.md の U2 が要求すること: 同じ操作の語は**画面と画面の間**で揃うこと(画面が書いた label の
 * 重ね表示 → フォーム、無ければイベントの label)。単一画面の「ボタンの語と確認の語が違う」は対象外。
 * 予約 ID の汎用の既定の語とは比べない。
 */

import { describe, expect, it } from 'vitest';
import { wordingVerifier } from '../../../../lib/ux/verifiers/u2-wording.js';
import { accessSpec, aggregate, del, entitySpec, event, field, machine, specModel } from '../../../helpers/model-builder.js';
import { screenSpec } from '../../../helpers/screen-builder.js';
import { UX_CTX, uxInput } from '../../../helpers/ux-builder.js';

/** thing: open →(leave。label「退会する」)→ left。open → close(label なし)。物理削除もある。 */
const DOMAIN = specModel([
  aggregate('thing', {
    entity: entitySpec('thing', { fields: [field('state', { kind: 'state', machine: 'thing' })] }),
    stateMachines: [
      machine('thing', {
        states: ['open', 'left', 'closed'],
        initial: 'open',
        events: [
          event('leave', { from: ['open'], to: 'left', label: '退会する' }),
          event('close', { from: ['open'], to: 'closed' }),
        ],
      }),
    ],
    access: accessSpec('thing', { deletes: [del('member')] }),
  }),
]);

/** U2 を実行して指摘を返す。 */
function run(screens: Parameters<typeof uxInput>[0] extends infer I ? (I extends { screens?: infer S } ? S : never) : never) {
  return wordingVerifier.verify(uxInput({ domain: DOMAIN, screens }), UX_CTX);
}

describe('U2 操作の語', () => {
  it('2 つの画面で同じ操作の語が違えば警告する(片方は label を引くだけでもよい)', () => {
    const findings = run([
      screenSpec({ name: 'profile', actions: ['thing.leave'] }),
      screenSpec({ name: 'admin', overlays: [{ id: 'leave_confirm', openedBy: 'table', label: '退会にする', actions: ['thing.leave'] }] }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe('U2');
    expect(findings[0]?.subject).toBe('thing.leave');
    // 受け入れられるのは語を書いた画面だけ(既定の語を引くだけの画面は主ではない)。
    expect(findings[0]?.screens).toEqual(['screen-admin']);
    expect(findings[0]?.finding.severity).toBe('warning');
    expect(findings[0]?.finding.message).toContain('「退会する」');
    expect(findings[0]?.finding.message).toContain('「退会にする」');
  });

  it('画面どうしで語が同じなら通る', () => {
    const overlay = { id: 'leave_confirm', openedBy: 'table', label: '退会する', actions: ['thing.leave'] };

    expect(run([screenSpec({ name: 'a', overlays: [overlay] }), screenSpec({ name: 'b', actions: ['thing.leave'] })])).toEqual([]);
  });

  it('単一画面の中のボタンの語(イベントの label)と確認の語の違いは対象外', () => {
    const findings = run([
      screenSpec({
        name: 'admin',
        actions: ['thing.leave'],
        overlays: [{ id: 'leave_confirm', openedBy: 'table', label: '退会にする', actions: ['thing.leave'] }],
      }),
    ]);

    expect(findings).toEqual([]);
  });

  it('フォーム部品の label も画面が書いた語として比べる', () => {
    const findings = run([
      screenSpec({ name: 'a', slots: [{ slot: 'body.center', components: [{ name: 'form', kind: 'form', label: '退会手続き', action: 'thing.leave' }] }] }),
      screenSpec({ name: 'b', actions: ['thing.leave'] }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.screens).toEqual(['screen-a']);
  });

  it('label の無いイベントは既定の語を持たないので、画面の label どうしだけを比べる', () => {
    const ok = run([
      screenSpec({ name: 'a', overlays: [{ id: 'x', openedBy: 't', label: '閉じる', actions: ['thing.close'] }] }),
      screenSpec({ name: 'b', actions: ['thing.close'] }),
    ]);
    expect(ok).toEqual([]);

    const split = run([
      screenSpec({ name: 'a', overlays: [{ id: 'x', openedBy: 't', label: '閉じる', actions: ['thing.close'] }] }),
      screenSpec({ name: 'b', overlays: [{ id: 'y', openedBy: 't', label: '締める', actions: ['thing.close'] }] }),
    ]);
    expect(split).toHaveLength(1);
    expect(split[0]?.screens).toEqual(['screen-a', 'screen-b']);
  });

  it('予約 ID の既定の語(表の「削除」など)とは比べない', () => {
    const findings = run([
      screenSpec({ name: 'a', actions: ['thing.delete'] }),
      screenSpec({ name: 'b', overlays: [{ id: 'x', openedBy: 't', label: 'ものを消す', actions: ['thing.delete'] }] }),
    ]);

    expect(findings).toEqual([]);
  });

  it('同じ予約 ID に画面が違う label を書いたら警告する', () => {
    const findings = run([
      screenSpec({ name: 'a', overlays: [{ id: 'x', openedBy: 't', label: 'ものを消す', actions: ['thing.delete'] }] }),
      screenSpec({ name: 'b', overlays: [{ id: 'y', openedBy: 't', label: '削除する', actions: ['thing.delete'] }] }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.subject).toBe('thing.delete');
  });

  it('画面をまだ仕様化していないリポジトリでは何も見ない', () => {
    expect(wordingVerifier.verify(uxInput({ domain: DOMAIN, screensUnavailable: true }), UX_CTX)).toEqual([]);
  });
});
