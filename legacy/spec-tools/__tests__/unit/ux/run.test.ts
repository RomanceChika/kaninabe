/**
 * U 群の実行口(受け入れの適用)のテスト。
 *
 * ux-lint.md の「画面ごとの受け入れ(ux:)」が要求すること — 画面 + 原則の ID + subject の一致で消えること・
 * どれか 1 つでも違えば消えないこと・用済み宣言の検出・存在しない原則の検出・重複の検出・
 * 画面をまたぐ指摘(U2)は語を書いた画面のどれかで受け入れられること。
 * 個々の検査の中身は verifiers/ 配下のテストが持つ。
 */

import { describe, expect, it } from 'vitest';
import { runUxVerification } from '../../../lib/ux/run.js';
import { createGuardServices } from '../../../lib/guard/services.js';
import { aggregate, entitySpec, event, field, machine, specModel } from '../../helpers/model-builder.js';
import { screenInput, screenSpec } from '../../helpers/screen-builder.js';
import { UNSELECTED } from '../../helpers/verify-inputs.js';

const CONTEXT = { guards: createGuardServices(), actions: UNSELECTED };

type Accept = { principle: string; subject?: string; reason?: string };

/** 行き止まりの画面 1 枚(U3 が必ず 1 件出る)に受け入れを書いて U 群を実行する。 */
function run(ux?: readonly Accept[], extra: readonly ReturnType<typeof screenSpec>[] = []) {
  const input = screenInput({
    screens: [screenSpec({ name: 'thanks', ...(ux === undefined ? {} : { ux }) }), ...extra],
  });
  return runUxVerification({ domain: input.domain, screens: input.screens, context: CONTEXT });
}

describe('U 群の実行口', () => {
  it('受け入れが無ければ指摘がそのまま残る', () => {
    const result = run();

    expect(result.warningCount).toBe(1);
    expect(result.acceptedCount).toBe(0);
    expect(result.findings.map((finding) => finding.verifier)).toEqual(['U3']);
  });

  it('画面 + 原則の ID + subject が一致する受け入れで指摘が消える(画面そのものへの指摘は subject を省略)', () => {
    const result = run([{ principle: 'U3', reason: '完了画面なので出口を持たない' }]);

    expect(result.findings).toEqual([]);
    expect(result.warningCount).toBe(0);
    expect(result.acceptedCount).toBe(1);
  });

  it('subject が違う受け入れでは消えない(用済みとして警告する)', () => {
    const result = run([{ principle: 'U3', subject: 'other' }]);

    expect(result.findings.map((finding) => finding.verifier)).toEqual(['U3', 'U0']);
    expect(result.findings[1]?.message).toContain('いま指摘が出ていません');
    expect(result.findings[1]?.suggestion).toContain('画面を直して指摘が消えたのなら');
    expect(result.findings[1]?.suggestion).toContain('綴り違い');
  });

  it('原則の ID が違う受け入れでは消えない', () => {
    const result = run([{ principle: 'U1' }]);

    expect(result.findings.map((finding) => finding.verifier)).toEqual(['U3', 'U0']);
  });

  it('別の画面に書いた受け入れでは消えない(画面は自明の主語である)', () => {
    const result = run(undefined, [screenSpec({ name: 'other', ux: [{ principle: 'U3' }], navigations: [{ on: 'x', to: 'screen-thanks' }] })]);

    // other は出口があるので指摘が無い。thanks の U3 は消えず、other の受け入れは用済みになる。
    expect(result.findings.map((finding) => finding.verifier)).toEqual(['U3', 'U0']);
  });

  it('同じ画面に同じ原則・同じ subject の受け入れが重複していたら警告する', () => {
    // 理由が食い違う重複は「どちらの判断が生きているか」を読めなくする。
    const result = run([
      { principle: 'U3', reason: '完了画面なので出口を持たない' },
      { principle: 'U3', reason: '出口はあとで足す' },
    ]);

    expect(result.warningCount).toBe(0);
    expect(result.acceptedCount).toBe(1);
    expect(result.staleCount).toBe(1);
    const stale = result.findings.filter((finding) => finding.verifier === 'U0');
    expect(stale).toHaveLength(1);
    expect(stale[0]?.message).toContain('受け入れが重複しています');
    expect(stale[0]?.counterexample?.['reason']).toBe('出口はあとで足す');
  });

  it('重複した宣言には「用済み」を重ねて言わない', () => {
    const result = run([{ principle: 'U3', subject: 'other' }, { principle: 'U3', subject: 'other' }]);

    const stale = result.findings.filter((finding) => finding.verifier === 'U0');
    expect(stale.map((finding) => finding.message)).toEqual([
      expect.stringContaining('いま指摘が出ていません'),
      expect.stringContaining('受け入れが重複しています'),
    ]);
  });

  it('存在しない原則の ID を書いた受け入れを警告する', () => {
    const result = run([{ principle: 'U9' }]);

    const stale = result.findings.filter((finding) => finding.verifier === 'U0');
    expect(stale).toHaveLength(1);
    expect(stale[0]?.message).toContain('原則 U9 は存在しません');
    expect(stale[0]?.severity).toBe('warning');
  });

  it('画面をまたぐ指摘(U2)は、語を書いた画面のどれかの受け入れで消える', () => {
    const domain = specModel([
      aggregate('thing', {
        entity: entitySpec('thing', { fields: [field('state', { kind: 'state', machine: 'thing' })] }),
        stateMachines: [
          machine('thing', { states: ['open', 'left'], initial: 'open', events: [event('leave', { from: ['open'], to: 'left', label: '退会する' })] }),
        ],
      }),
    ]);
    const screens = (ux: readonly Accept[]) =>
      screenInput({
        domain,
        screens: [
          screenSpec({
            name: 'a',
            navigations: [{ on: 'x', to: 'screen-b' }],
            overlays: [{ id: 'c', openedBy: 't', actions: ['thing.leave'] }],
          }),
          screenSpec({
            name: 'b',
            ux,
            navigations: [{ on: 'x', to: 'screen-a' }],
            overlays: [{ id: 'c', openedBy: 't', label: '退会にする', actions: ['thing.leave'] }],
          }),
        ],
      });

    const open = screens([]);
    expect(runUxVerification({ domain, screens: open.screens, context: CONTEXT }).findings.map((f) => f.verifier)).toEqual(['U2']);
    const accepted = screens([{ principle: 'U2', subject: 'thing.leave', reason: '意図して分ける' }]);
    const result = runUxVerification({ domain, screens: accepted.screens, context: CONTEXT });
    expect(result.findings).toEqual([]);
    expect(result.acceptedCount).toBe(1);
  });

  it('指摘はすべて warning(verify のエラー 0 条件に影響しない)', () => {
    const result = run([{ principle: 'U9' }]);

    expect(result.findings.every((finding) => finding.severity === 'warning')).toBe(true);
  });

  it('画面をまだ仕様化していないリポジトリでは何も実行しない', () => {
    const input = screenInput({ screensUnavailable: true });
    const result = runUxVerification({ domain: input.domain, screens: input.screens, context: CONTEXT });

    expect(result).toEqual({
      findings: [],
      available: false,
      screenCount: 0,
      warningCount: 0,
      staleCount: 0,
      acceptedCount: 0,
    });
  });
});
