/**
 * G7(宣言したトークンが実装から引かれている = 死語彙の検出)のテスト。
 *
 * G2(実装 → 仕様。参照が実在するか)の逆向き(仕様 → 実装。宣言が使われているか)を見る。
 * 実測(radius 全廃後も 4 語が緑のまま残った)を再現する形で、
 * 「使われているトークンは通す / 使われていないトークンは検出する / 生成物での言及は
 * 使用と認めない / CSS が無ければスキップする」の 4 点を確かめる。
 */

import { describe, expect, it } from 'vitest';
import { g7DeadTokens } from '../../../../lib/design/verifiers/g7-dead-tokens.js';
import { cssFile, designInput, group, tokenSpec, valueToken } from '../../../helpers/design-builder.js';

describe('G7 死語彙の検出', () => {
  it('実装が var(--…) で引いているトークンは通す', () => {
    const spec = tokenSpec({ groups: [group('space', [valueToken('space', 'space-4', '16px')])] });
    const findings = g7DeadTokens.verify(
      designInput({ spec, files: [cssFile('app/src/a.module.css', '.a { padding: var(--space-4); }')] }),
    );

    expect(findings).toEqual([]);
  });

  it('どの実装 CSS からも引かれていないトークンを検出する(radius 全廃後の実測を再現)', () => {
    const spec = tokenSpec({
      groups: [
        group('radius', [
          valueToken('radius', 'radius-sm', '2px'),
          valueToken('radius', 'radius-md', '4px'),
        ]),
      ],
    });
    const findings = g7DeadTokens.verify(
      designInput({ spec, files: [cssFile('app/src/a.module.css', '.a { color: var(--color-text); }')] }),
    );

    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.message.includes('死語彙'))).toBe(true);
    expect(findings.map((finding) => finding.counterexample?.['token'])).toEqual(['radius-sm', 'radius-md']);
  });

  it('生成物(tokens.css)での言及は使用と認めない', () => {
    const spec = tokenSpec({ groups: [group('space', [valueToken('space', 'space-4', '16px')])] });
    const findings = g7DeadTokens.verify(
      designInput({
        spec,
        files: [cssFile('app/src/domain/generated/tokens.css', ':root { --space-4: 16px; }', true)],
      }),
    );

    expect(findings).toHaveLength(1);
  });

  it('CSS を読めない環境では何も報告しない', () => {
    const spec = tokenSpec({ groups: [group('space', [valueToken('space', 'space-4', '16px')])] });

    expect(g7DeadTokens.verify(designInput({ spec, cssAvailable: false }))).toEqual([]);
  });

  it('トークン仕様が無ければ何も報告しない', () => {
    expect(g7DeadTokens.verify(designInput({ spec: null }))).toEqual([]);
  });
});
