/**
 * S3(到達可能性)のテスト。
 *
 * screen-spec-writing.md の S3 が要求する 2 つ(エントリポイントの宣言・全画面への到達)に
 * ケースを置く。`on_fail` を辿らないことも検査対象に含める(辿ると孤立画面が隠れるため)。
 */

import { describe, expect, it } from 'vitest';
import { reachabilityVerifier } from '../../../../lib/screen/verifiers/s3-reachability.js';
import { SCREEN_CTX, screenInput, screenSpec } from '../../../helpers/screen-builder.js';

/** S3 を実行して Finding を返す。 */
function run(init: Parameters<typeof screenInput>[0]) {
  return reachabilityVerifier.verify(screenInput(init), SCREEN_CTX);
}

describe('S3 到達可能性', () => {
  it('エントリポイントから全画面へ辿れれば通る', () => {
    const findings = run({
      screens: [
        screenSpec({ name: 'home', entryPoint: true, navigations: [{ on: 'link', to: 'screen-list' }] }),
        screenSpec({ name: 'list', navigations: [{ on: 'row', to: 'screen-detail' }] }),
        screenSpec({ name: 'detail' }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it('エントリポイントが 1 つも無ければ失敗する', () => {
    const findings = run({ screens: [screenSpec({ name: 'home' })] });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('entry_point: true の画面が 1 つもありません');
  });

  it('どこからも辿れない画面を検出する', () => {
    const findings = run({
      screens: [screenSpec({ name: 'home', entryPoint: true }), screenSpec({ name: 'orphan' })],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('orphan');
  });

  it('on_fail の行き先は入口として数えない', () => {
    const findings = run({
      screens: [
        screenSpec({ name: 'home', entryPoint: true }),
        // login へは navigations が 1 本も向いておらず、on_fail だけが指している。
        screenSpec({ name: 'guarded', precondition: 'actor.role != anonymous', onFail: 'screen-login' }),
        screenSpec({ name: 'login' }),
      ],
    });

    expect(findings.map((finding) => finding.message).join(' ')).toContain('login');
  });

  it('自己ループだけの画面は入口を持たない', () => {
    const findings = run({
      screens: [
        screenSpec({ name: 'home', entryPoint: true }),
        screenSpec({ name: 'loop', navigations: [{ on: 'refresh', to: 'screen-loop' }] }),
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('loop');
  });

  it('画面が 0 件でも壊れない', () => {
    expect(run({})).toEqual([]);
  });
});
