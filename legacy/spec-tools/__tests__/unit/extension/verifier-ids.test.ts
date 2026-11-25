/**
 * 検査 ID の綴りを、コードの文字列リテラルから集める純関数のユニットテスト。
 */

import { describe, expect, it } from 'vitest';
import { collectVerifierIds } from '../../helpers/verifier-id-literals.js';

describe('collectVerifierIds', () => {
  it('引用符で囲まれた検査 ID の形(英大文字 1〜2 字 + 数字)だけを集める', () => {
    const ids = collectVerifierIds([
      "const VERIFIER_ID = 'T2';\nconst other = \"W15\";",
      'const id = `V9`; const word = \'Table\'; const lower = \'t8\'; const long = \'ABC1\'; const bare = T8;',
    ]);

    expect([...ids].sort()).toEqual(['T2', 'V9', 'W15']);
  });

  it('ソースが無ければ空の集合', () => {
    expect(collectVerifierIds([]).size).toBe(0);
  });
});
