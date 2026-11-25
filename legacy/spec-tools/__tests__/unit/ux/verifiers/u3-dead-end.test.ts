/**
 * U3(行き止まり)のテスト。
 *
 * ux-lint.md の U3 が要求する 2 つ(出口の有無・自己ループを出口と数えないこと)に
 * ケースを置く。chrome から継承した遷移が出口になることも検査対象に含める。
 */

import { describe, expect, it } from 'vitest';
import { deadEndVerifier } from '../../../../lib/ux/verifiers/u3-dead-end.js';
import { chromeSpec, screenSpec } from '../../../helpers/screen-builder.js';
import { UX_CTX, uxInput } from '../../../helpers/ux-builder.js';

/** U3 を実行して指摘を返す。 */
function run(init: Parameters<typeof uxInput>[0]) {
  return deadEndVerifier.verify(uxInput(init), UX_CTX);
}

describe('U3 行き止まり', () => {
  it('出て行く遷移があれば通る', () => {
    const findings = run({
      screens: [
        screenSpec({ name: 'home', navigations: [{ on: 'link', to: 'screen-list' }] }),
        screenSpec({ name: 'list', navigations: [{ on: 'back', to: 'screen-home' }] }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('遷移を 1 本も持たない画面を警告する', () => {
    const findings = run({ screens: [screenSpec({ name: 'thanks' })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe('U3');
    expect(findings[0]?.screens).toEqual(['screen-thanks']);
    expect(findings[0]?.subject).toBe('');
    expect(findings[0]?.finding.severity).toBe('warning');
    expect(findings[0]?.finding.message).toContain('行き止まり');
  });

  it('自分自身へ戻る遷移は出口として数えない', () => {
    // 操作の成功後に同じ画面へ戻る配線は再描画の宣言であって、先へ進む道ではない。
    const findings = run({
      screens: [screenSpec({ name: 'thanks', navigations: [{ on: 'x.success', to: 'screen-thanks' }] })],
    });

    expect(findings).toHaveLength(1);
  });

  it('chrome から継承した遷移も出口として数える', () => {
    const findings = run({
      screens: [screenSpec({ name: 'thanks', chrome: 'chrome-member' })],
      chromes: [chromeSpec({ name: 'member', navigations: [{ on: 'home_link', to: 'screen-home' }] })],
    });

    expect(findings).toEqual([]);
  });
});
