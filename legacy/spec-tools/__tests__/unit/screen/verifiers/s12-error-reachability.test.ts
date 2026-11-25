/**
 * S12(error 到達可能性)のテスト。
 *
 * 対象の要求: screen-spec-writing.md §states「reads の query_spec がどれも params を持たない
 * 画面は error を宣言しない」。reads が空の画面は対象外(OAuth コールバック等、読み取り以外の
 * 理由で error を宣言することがある)。
 */

import { describe, expect, it } from 'vitest';
import { errorReachabilityVerifier } from '../../../../lib/screen/verifiers/s12-error-reachability.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { SCREEN_CTX, screenInput, screenSpec } from '../../../helpers/screen-builder.js';

/** params 無しのクエリ 1 本。 */
function noParamsQuery(name: string) {
  return querySpec({ name, source: 'workshop', for: ['member'], scopeUsed: 'all' });
}

/** params 付きのクエリ 1 本。 */
function paramfulQuery(name: string) {
  return querySpec({
    name,
    source: 'workshop',
    for: ['member'],
    scopeUsed: 'own',
    params: [{ name: 'workshop_id', ref: 'workshop.id' }],
  });
}

describe('S12 error 到達可能性', () => {
  it('reads が空の画面の error は対象外(読み取り以外の理由がありうる)', () => {
    const screen = screenSpec({ name: 'login', requires: ['error'], reads: [] });

    expect(errorReachabilityVerifier.verify(screenInput({ screens: [screen] }), SCREEN_CTX)).toEqual([]);
  });

  it('唯一の reads が params を持たないのに error を宣言していれば失敗する', () => {
    const screen = screenSpec({
      name: 'check_item_admin',
      requires: ['empty', 'error'],
      reads: ['query-check-item-list'],
    });
    const findings = errorReachabilityVerifier.verify(
      screenInput({ queries: [noParamsQuery('check_item_list')], screens: [screen] }),
      SCREEN_CTX,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('S12');
    expect(findings[0]?.message).toContain('check_item_admin');
    expect(findings[0]?.suggestion).toContain('states.requires から error を外す');
  });

  it('params 無しの reads だけでも error を宣言していなければ通る', () => {
    const screen = screenSpec({
      name: 'check_item_admin',
      requires: ['empty'],
      reads: ['query-check-item-list'],
    });

    expect(
      errorReachabilityVerifier.verify(
        screenInput({ queries: [noParamsQuery('check_item_list')], screens: [screen] }),
        SCREEN_CTX,
      ),
    ).toEqual([]);
  });

  it('reads のどれか 1 本でも params を持てば error を宣言してよい', () => {
    const screen = screenSpec({
      name: 'workshop_detail',
      requires: ['empty', 'error', 'not_found'],
      reads: ['query-workshop-detail', 'query-member-options'],
    });

    expect(
      errorReachabilityVerifier.verify(
        screenInput({
          queries: [paramfulQuery('workshop_detail'), noParamsQuery('member_options')],
          screens: [screen],
        }),
        SCREEN_CTX,
      ),
    ).toEqual([]);
  });

  it('query_spec がまだ書かれていない環境では何も見ない(queriesUnavailable)', () => {
    const screen = screenSpec({
      name: 'check_item_admin',
      requires: ['error'],
      reads: ['query-check-item-list'],
    });

    expect(
      errorReachabilityVerifier.verify(
        screenInput({ queriesUnavailable: true, screens: [screen] }),
        SCREEN_CTX,
      ),
    ).toEqual([]);
  });

  it('実在しない参照は否定できない側に倒す(S2 が別途指摘するので二重に倒さない)', () => {
    const screen = screenSpec({
      name: 'check_item_admin',
      requires: ['error'],
      reads: ['query-does-not-exist'],
    });

    expect(
      errorReachabilityVerifier.verify(screenInput({ queries: [], screens: [screen] }), SCREEN_CTX),
    ).toEqual([]);
  });
});

describe('S12: 読み取りクエリ(query_spec)が阻害のとき(保留せず、読めた分で否定できない側に倒す)', () => {
  const screen = () => screenSpec({ name: 'check_item_admin', requires: ['empty', 'error'], reads: ['query-check-item-list'] });

  it('読めた読みが params を持たないなら、阻害でも言う(読めた分についての真の検出)', () => {
    const input = screenInput({ queries: [noParamsQuery('check_item_list')], screens: [screen()] });

    expect(errorReachabilityVerifier.verify(input, SCREEN_CTX)).toHaveLength(1);
    expect(errorReachabilityVerifier.verify(input, { ...SCREEN_CTX, blockedInputs: ['queries'] })).toHaveLength(1);
  });

  it('読めずに落ちた読み(阻害)を指す reads は「params が無い」と言わない(否定できない側に倒す)', () => {
    const input = screenInput({ queries: [], screens: [screen()] });

    expect(errorReachabilityVerifier.verify(input, { ...SCREEN_CTX, blockedInputs: ['queries'] })).toEqual([]);
  });

  it('読み取りクエリの置き場ごと無い・読めない(available: false)ときは実行されず何も言わない(「実行済みで指摘なし」ではない。行は operation-input-notes が名指す)', () => {
    const input = screenInput({ queriesUnavailable: true, screens: [screen()] });

    expect(errorReachabilityVerifier.verify(input, SCREEN_CTX)).toEqual([]);
    expect(errorReachabilityVerifier.verify(input, { ...SCREEN_CTX, blockedInputs: ['queries'] })).toEqual([]);
  });
});
