/**
 * 状態 → 意味色の読み取り(render/book/tone-map.ts)のテスト。
 *
 * 対象の要求: 「state-badge.tsx の `const {X}_TONE = {…} as const satisfies Record<keyof
 * typeof {machine}StateLabels, Tone>` の定型を読み取る。機械名は camelCase を snake_case へ
 * 戻す。定型が崩れたら空(見本側は neutral で描く)」。
 */

import { describe, expect, it } from 'vitest';

import { parseToneMap } from '../../../../../lib/generate/render/book/tone-map.js';

const SOURCE = [
  `const WORKSHOP_TONE = {`,
  `  draft: 'neutral',`,
  `  accepting: 'info',`,
  `  cancelled: 'critical',`,
  `} as const satisfies Record<keyof typeof workshopStateLabels, Tone>;`,
  ``,
  `const PROGRAM_ITEM_TONE = {`,
  `  listed: 'positive',`,
  `} as const satisfies Record<keyof typeof programItemStateLabels, Tone>;`,
].join('\n');

describe('parseToneMap', () => {
  it('複数の定型ブロックを機械名(snake_case)ごとに読み取る', () => {
    const map = parseToneMap(SOURCE);

    expect(map.get('workshop')).toEqual({ draft: 'neutral', accepting: 'info', cancelled: 'critical' });
    expect(map.get('program_item')).toEqual({ listed: 'positive' });
  });

  it('値域に無い値は読み取らない(発明しない)', () => {
    const map = parseToneMap(
      `const A_TONE = { x: 'sparkle' } as const satisfies Record<keyof typeof aStateLabels, Tone>;`,
    );

    expect(map.get('a')).toEqual({});
  });

  it('定型が無いソースは空の対応を返す', () => {
    expect(parseToneMap('export function nothing() {}').size).toBe(0);
  });
});
