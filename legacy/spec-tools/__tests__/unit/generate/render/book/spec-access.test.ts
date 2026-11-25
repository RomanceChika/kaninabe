/**
 * 新しい形の章の「できること」「見える範囲」の表の行の束ね(`render/book/spec/access-section.ts`)のテスト。
 *
 * 誰が以外が同じ規則は 1 行にまとめる・同じ役を 2 度書いた規則は 1 度だけ出す・並びは最初に現れた順。
 */

import { describe, expect, it } from 'vitest';
import { mergedRows } from '../../../../../lib/generate/render/book/spec/access-section.js';

describe('mergedRows', () => {
  it('誰が以外が同じ規則を 1 行にまとめ、同じ役を別の行で重ねて書いても 1 度だけ出す', () => {
    const rows = mergedRows([
      { key: 'close', by: ['host', 'host'], rest: ['閉じる'] },
      { key: 'title', by: ['host'], rest: ['題'] },
      { key: 'title', by: ['staff', 'host'], rest: ['題'] },
      { key: 'note', by: ['staff'], rest: ['note'] },
    ]);

    expect(rows).toEqual([
      { by: ['host', 'host'], rest: ['閉じる'] },
      { by: ['host', 'staff'], rest: ['題'] },
      { by: ['staff'], rest: ['note'] },
    ]);
  });

  it('表示名が同じでも、鍵(仕様の値)が違う規則は合わせない', () => {
    const rows = mergedRows([
      { key: 'title', by: ['host'], rest: ['題'] },
      { key: 'subtitle', by: ['staff'], rest: ['題'] },
    ]);

    expect(rows).toHaveLength(2);
  });
});
