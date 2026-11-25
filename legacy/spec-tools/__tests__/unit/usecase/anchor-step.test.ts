/**
 * 保存点の冪等の錨の決め方(`lib/usecase/param-source-facts.ts` の `anchorStep`。点検 22 回目 C の O22-3)の単体テスト。
 * 錨は最初の作成の手順で、読み直しの構造・冪等キーの置き場・一致の証明の設計図が同じ 1 本を呼ぶ(写しを持たない)。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { anchorStep } from '../../../lib/usecase/param-source-facts.js';

describe('anchorStep(保存点の冪等の錨)', () => {
  it.each([
    ['最初の手順が作成', ['create', 'create', 'transition'], 0],
    ['遷移の後の最初の作成', ['transition', 'update', 'create', 'create'], 2],
    ['作成が無い', ['transition', 'delete'], -1],
    ['手順が無い', [], -1],
  ] as const)('%s', (_title, kinds, index) => {
    const steps = kinds.map((kind, at) => ({ kind, at }));
    expect(anchorStep({ steps })).toBe(index < 0 ? undefined : steps[index]);
  });

  it('錨の式の写しを持たない(呼び手は anchorStep を呼ぶだけ)', () => {
    const lib = path.resolve(import.meta.dirname, '../../../lib');
    for (const file of ['usecase/save-readback.ts', 'usecase/param-source.ts', 'world/eq-save-shape.ts']) {
      const text = readFileSync(path.join(lib, file), 'utf-8');
      expect(text, file).toContain('anchorStep(');
      expect(text, file).not.toMatch(/steps\.find\(\(\w+\) => \w+\.kind === 'create'\)/);
    }
  });
});
