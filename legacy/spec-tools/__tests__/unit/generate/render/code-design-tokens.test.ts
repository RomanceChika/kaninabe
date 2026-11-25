/**
 * デザイントークンの実装側生成(tokens.css / tokens.ts)のテスト。
 *
 * 生成物はコミットされ CI の鮮度チェック(C1)で比較されるので、**入力から出力が一意に定まる**
 * ことがこの生成器の要件である。1 つの仕様から 2 つのファイルが出ること、キーが引用符で
 * 囲まれること(トークン名はハイフンを含み TS の識別子にならない)を固定する。
 */

import { describe, expect, it } from 'vitest';
import { designTokensGenerator } from '../../../../lib/generate/render/code-design-tokens.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { colorToken, group, tokenSpec, valueToken } from '../../../helpers/design-builder.js';

/** 生成器はドメインモデルを見ないので、空のモデルで足りる。 */
const MODEL = { aggregates: new Map(), roles: null } as unknown as SpecModel;

/** テスト用の仕様(色 1 つ・余白 1 つ・外部変数 1 つ)。 */
const SPEC = tokenSpec({
  groups: [
    group('color', [colorToken('color-accent', '#31417a')]),
    group('space', [valueToken('space', 'space-4', '16px')]),
  ],
  externals: [{ name: 'font-serif-jp', from: 'app/src/app/layout.tsx', reason: 'next/font が作る' }],
});

/** 生成を実行する。 */
function run(spec: typeof SPEC | null) {
  return designTokensGenerator.generate(MODEL, {
    ...GEN_CTX,
    design: { available: spec !== null, spec },
  });
}

describe('code-design-tokens', () => {
  it('1 つの仕様から CSS と TS の 2 ファイルを出す', () => {
    const sections = run(SPEC);

    expect(sections.map((section) => section.file)).toEqual([
      'app/src/domain/generated/tokens.css',
      'app/src/domain/generated/tokens.ts',
    ]);
    expect(sections.every((section) => section.wholeFile === true)).toBe(true);
  });

  it('CSS は :root に変数を並べ、正の仕様をヘッダに書く', () => {
    const css = run(SPEC)[0]?.content ?? '';

    expect(css).toContain('AUTO-GENERATED');
    expect(css).toContain('docs/specs/frontend/design/tokens.md');
    expect(css).toContain(':root {');
    expect(css).toContain('--color-accent: #31417a;');
    expect(css).toContain('--space-4: 16px;');
  });

  it('CSS に外部供給の変数を注記として残す(値はここでは決められない)', () => {
    const css = run(SPEC)[0]?.content ?? '';

    expect(css).toContain('--font-serif-jp … app/src/app/layout.tsx');
  });

  it('TS はキーを引用符で囲む(トークン名は TS の識別子にならない)', () => {
    const ts = run(SPEC)[1]?.content ?? '';

    expect(ts).toContain("'color-accent': '#31417a',");
    expect(ts).toContain("'color-accent': 'var(--color-accent)',");
    expect(ts).toContain("export const designTheme = 'test_theme';");
    expect(ts).toContain('export type DesignTokenName');
  });

  it('同じ入力から同じ出力になる(鮮度チェックの前提)', () => {
    expect(run(SPEC)).toEqual(run(SPEC));
  });

  it('仕様が無ければ何も生成しない', () => {
    expect(run(null)).toEqual([]);
    expect(designTokensGenerator.generate(MODEL, GEN_CTX)).toEqual([]);
  });
});
