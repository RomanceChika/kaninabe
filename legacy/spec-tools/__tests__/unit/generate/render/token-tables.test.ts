import { describe, expect, it } from 'vitest';

import { tokenTablesGenerator } from '../../../../lib/generate/render/token-tables.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { DesignTokenSpec } from '../../../../lib/model/design/types.js';
import { group, tokenSpec, valueToken } from '../../../helpers/design-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { specModel } from '../../../helpers/model-builder.js';

/** トークン仕様を読み込み済みの文脈を作る。 */
function ctxWith(spec: DesignTokenSpec | null): GenerateContext {
  return { ...GEN_CTX, design: { available: true, spec } };
}

describe('tokenTablesGenerator', () => {
  it('トークン一覧(ref の解決値つき)とコントラスト検査(実比つき)を tokens.md に生成する', () => {
    const spec = tokenSpec({
      groups: [
        group('color', [
          { name: 'color-text', group: 'color', value: '#000000', ref: 'ink-900', note: '本文', decorative: null },
          { name: 'color-canvas', group: 'color', value: '#ffffff', ref: 'paper-0', note: null, decorative: null },
        ]),
        group('space', [valueToken('space', 'space-1', '4px')]),
      ],
      contrast: [{ fg: 'color-text', bg: 'color-canvas', min: 4.5 }],
    });

    const sections = tokenTablesGenerator.generate(specModel([]), ctxWith(spec));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('docs/specs/frontend/design/tokens.md');
    expect(sections[0]?.marker).toBe('token-tables');

    const content = sections[0]?.content ?? '';
    expect(content).toContain('| `--color-text` | color | #000000 | ink-900 | 本文 |');
    // 色以外(直値)は ref が無いので —
    expect(content).toContain('| `--space-1` | space | 4px | — | — |');
    // 黒と白の比は 21:1(G3 と同じ計算)
    expect(content).toContain('| color-text | color-canvas | 4.5:1 | 21.00:1 |');
  });

  it('hex でない値を含む組は実比を計算できないので — にする', () => {
    const spec = tokenSpec({
      groups: [
        group('color', [
          { name: 'color-text', group: 'color', value: '#000000', ref: 'ink-900', note: null, decorative: null },
        ]),
        group('shadow', [valueToken('shadow', 'shadow-sm', '0 1px 2px rgba(0,0,0,0.1)')]),
      ],
      contrast: [{ fg: 'color-text', bg: 'shadow-sm', min: 3 }],
    });

    const content =
      tokenTablesGenerator.generate(specModel([]), ctxWith(spec))[0]?.content ?? '';

    expect(content).toContain('| color-text | shadow-sm | 3:1 | — |');
  });

  it('トークン仕様を読み込んでいない文脈・spec が null の文脈では何も生成しない', () => {
    expect(tokenTablesGenerator.generate(specModel([]), GEN_CTX)).toHaveLength(0);
    expect(tokenTablesGenerator.generate(specModel([]), ctxWith(null))).toHaveLength(0);
  });
});
