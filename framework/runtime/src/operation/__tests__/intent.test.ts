/**
 * `intent.ts` の単体テスト(送信の意図の冪等キーと、書けたかどうかの境界。点検 20 回目 B20-1)。負例と正例を表で並べる。
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DbInfrastructureError } from '../commit-outcome';
import { intentKeyOf, temporaryFailureOf } from '../../domain/intent';

/** 正しい形の鍵(版 4・変種 8〜b)。 */
const KEY = randomUUID();

/** 鍵の 1 文字を置き換えた写し(版の桁 = 14 文字目・変種の桁 = 19 文字目)。 */
function withChar(index: number, char: string): string {
  return `${KEY.slice(0, index)}${char}${KEY.slice(index + 1)}`;
}

describe('送信の意図と、書けたかどうかの境界', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-RUNPLAN-008
  it('意図の冪等キーは UUID の形のときだけ取り出し(小文字に揃える)、それ以外は使わない', () => {
    const cases = [
      ['正しい形', { idempotencyKey: KEY }, KEY],
      ['大文字は小文字に揃える', { idempotencyKey: KEY.toUpperCase() }, KEY],
      ['意図が無い', undefined, undefined],
      ['null', null, undefined],
      ['文字列そのもの(意図の形でない)', KEY, undefined],
      ['鍵が無い', {}, undefined],
      ['鍵が文字列でない', { idempotencyKey: 42 }, undefined],
      ['UUID でない', { idempotencyKey: 'not-a-uuid' }, undefined],
      ['版の桁が範囲の外', { idempotencyKey: withChar(14, '0') }, undefined],
      ['変種の桁が範囲の外', { idempotencyKey: withChar(19, '7') }, undefined],
      ['前後に余計な字', { idempotencyKey: ` ${KEY}` }, undefined],
    ] as const;
    expect(cases.length).toBeGreaterThan(1);
    for (const [title, intent, expected] of cases) expect(intentKeyOf(intent), title).toBe(expected);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-RUNPLAN-009
  it('DB の失敗だけを書けたかどうかつきの一時的な失敗の値にし、それ以外の例外は null(呼び手が記録して投げ直す)', () => {
    for (const commit of ['not_committed', 'unknown'] as const) {
      const cause = new DbInfrastructureError('insert_x', { kind: 'transport_failed', commit, cause: new TypeError('fetch failed') });
      expect(temporaryFailureOf(cause), commit).toEqual({ kind: 'temporarily_unavailable', commit });
    }
    const unknown = new DbInfrastructureError('insert_x', { kind: 'unknown_failure', commit: 'unknown', sqlstate: '40001' });
    expect(temporaryFailureOf(unknown)).toEqual({ kind: 'temporarily_unavailable', commit: 'unknown' });
    // 名前だけ同じで書けたかどうかの欄が契約の外なら値にしない(想定外として投げ直す側)。
    const forged = Object.assign(new Error('x'), { name: 'DbInfrastructureError', commit: 'maybe' });
    const others = [new Error('bug'), 'boom', null, forged] as const;
    expect(others.length).toBeGreaterThan(1);
    for (const cause of others) expect(temporaryFailureOf(cause)).toBeNull();
  });
});
