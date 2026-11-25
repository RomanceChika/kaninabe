/**
 * G0(トークン仕様のスキーマ適合)のテスト。
 *
 * styling.md / template.design_token_spec.md が要求する各項目
 * (theme / palette / groups / tokens の名前 / value と ref の排他 / contrast)に
 * 1 つ以上のケースを置く。
 */

import { describe, expect, it } from 'vitest';
import { parseDesignTokens } from '../../../../lib/model/design/parse-tokens.js';

/** 最小限の妥当な仕様。 */
const VALID = {
  doc_type: 'design_token_spec',
  scope: 'frontend',
  id: 'design-tokens',
  theme: 'night_workshop',
  palette: { 'indigo-600': '#31417a', 'paper-50': '#FAF6EF' },
  groups: [
    {
      group: 'color',
      purpose: '地と文字',
      tokens: [
        { name: 'color-accent', ref: 'indigo-600', note: '主ボタン' },
        { name: 'color-canvas', ref: 'paper-50' },
      ],
    },
    { group: 'space', purpose: '余白', tokens: [{ name: 'space-4', value: '16px' }] },
  ],
  contrast: [{ fg: 'color-canvas', bg: 'color-accent', min: 4.5 }],
};

/** パースして違反だけ取り出す。 */
function findings(data: unknown) {
  return parseDesignTokens(data, 'docs/specs/frontend/design/tokens.md').findings;
}

describe('G0 トークン仕様のスキーマ', () => {
  it('妥当な仕様は違反ゼロで読める', () => {
    const result = parseDesignTokens(VALID, 'docs/specs/frontend/design/tokens.md');

    expect(result.findings).toEqual([]);
    expect(result.value?.theme).toBe('night_workshop');
    expect(result.value?.tokens).toHaveLength(3);
  });

  it('ref は palette の実値に解決され、hex は小文字に揃う', () => {
    const spec = parseDesignTokens(VALID, 'x.md').value;

    expect(spec?.tokens[1]).toMatchObject({ name: 'color-canvas', value: '#faf6ef', ref: 'paper-50' });
  });

  it('doc_type が違えば失敗する', () => {
    const found = findings({ ...VALID, doc_type: 'screen_spec' });

    expect(found.some((finding) => finding.message.includes('doc_type'))).toBe(true);
  });

  it('theme が無ければ仕様を構築しない', () => {
    const result = parseDesignTokens({ ...VALID, theme: undefined }, 'x.md');

    expect(result.value).toBeNull();
  });

  it('theme が snake_case でなければ失敗する', () => {
    const found = findings({ ...VALID, theme: 'Night-Workshop' });

    expect(found.some((finding) => finding.message.includes('snake_case'))).toBe(true);
  });

  it('palette が無ければ失敗する', () => {
    const found = findings({ ...VALID, palette: undefined, groups: [] });

    expect(found.some((finding) => finding.message.includes('palette がありません'))).toBe(true);
  });

  it('palette の値が hex でなければ失敗する(YAML の # の引用忘れを含む)', () => {
    const found = findings({ ...VALID, palette: { 'indigo-600': null } });

    expect(found.some((finding) => finding.suggestion.includes('引用符'))).toBe(true);
  });

  it('トークン名がグループ名で始まらなければ失敗する', () => {
    const found = findings({
      ...VALID,
      groups: [{ group: 'space', purpose: 'x', tokens: [{ name: 'gap-4', value: '16px' }] }],
    });

    expect(found.some((finding) => finding.message.includes('space- で始まる'))).toBe(true);
  });

  it('value と ref を両方書けば失敗する', () => {
    const found = findings({
      ...VALID,
      groups: [
        {
          group: 'color',
          purpose: 'x',
          tokens: [{ name: 'color-a', ref: 'indigo-600', value: '#000000' }],
        },
      ],
    });

    expect(found.some((finding) => finding.message.includes('同時に書けません'))).toBe(true);
  });

  it('value も ref も無ければ失敗する', () => {
    const found = findings({
      ...VALID,
      groups: [{ group: 'color', purpose: 'x', tokens: [{ name: 'color-a' }] }],
    });

    expect(found.some((finding) => finding.message.includes('value も ref もありません'))).toBe(true);
  });

  it('存在しない palette を ref すれば失敗する', () => {
    const found = findings({
      ...VALID,
      groups: [{ group: 'color', purpose: 'x', tokens: [{ name: 'color-a', ref: 'nowhere' }] }],
    });

    expect(found.some((finding) => finding.message.includes('nowhere'))).toBe(true);
  });

  it('トークンに hex を直接書けば失敗する(色の名前空間を 1 つに保つ)', () => {
    const found = findings({
      ...VALID,
      groups: [{ group: 'color', purpose: 'x', tokens: [{ name: 'color-a', value: '#123456' }] }],
    });

    expect(found.some((finding) => finding.message.includes('hex を直接書く'))).toBe(true);
  });

  it('contrast が色トークン以外を指せば失敗する', () => {
    const found = findings({
      ...VALID,
      contrast: [{ fg: 'space-4', bg: 'color-canvas', min: 4.5 }],
    });

    expect(found.some((finding) => finding.message.includes('色トークンではありません'))).toBe(true);
  });

  it('contrast に min が無ければ失敗する', () => {
    const found = findings({ ...VALID, contrast: [{ fg: 'color-accent', bg: 'color-canvas' }] });

    expect(found.some((finding) => finding.message.includes('min がありません'))).toBe(true);
  });

  it('externals は理由まで必須', () => {
    const found = findings({
      ...VALID,
      externals: [{ name: 'font-serif-jp', from: 'app/src/app/layout.tsx' }],
    });

    expect(found.some((finding) => finding.message.includes('reason'))).toBe(true);
  });

  it('externals が揃っていれば読める', () => {
    const spec = parseDesignTokens(
      { ...VALID, externals: [{ name: 'font-serif-jp', from: 'a.tsx', reason: 'b' }] },
      'x.md',
    ).value;

    expect(spec?.externals).toHaveLength(1);
  });

  it('フロントマターがマッピングでなければ仕様を構築しない', () => {
    const result = parseDesignTokens(['a'], 'x.md');

    expect(result.value).toBeNull();
    expect(result.findings).toHaveLength(1);
  });

  it('decorative は色トークンに書ける(G3 網羅の床の受け入れ理由)', () => {
    const spec = parseDesignTokens(
      {
        ...VALID,
        groups: [
          {
            group: 'color',
            purpose: '地と文字',
            tokens: [
              { name: 'color-accent', ref: 'indigo-600', decorative: '区切り線にしか使わない' },
              { name: 'color-canvas', ref: 'paper-50' },
            ],
          },
          { group: 'space', purpose: '余白', tokens: [{ name: 'space-4', value: '16px' }] },
        ],
      },
      'x.md',
    ).value;

    expect(spec?.tokens[0]).toMatchObject({ name: 'color-accent', decorative: '区切り線にしか使わない' });
    expect(spec?.tokens[1]?.decorative).toBeNull();
  });

  it('decorative は色以外のトークン(ref を持たない)には書けず失敗する', () => {
    const found = findings({
      ...VALID,
      groups: [
        ...VALID.groups.slice(0, 1),
        { group: 'space', purpose: '余白', tokens: [{ name: 'space-4', value: '16px', decorative: '理由' }] },
      ],
    });

    expect(found.some((finding) => finding.message.includes('decorative は色トークン'))).toBe(true);
  });

  it('brand が無ければ null になる(必須かどうかの判定は G8 の役目)', () => {
    const spec = parseDesignTokens(VALID, 'x.md').value;

    expect(spec?.brand).toBeNull();
  });

  it('brand.icon を読める', () => {
    const spec = parseDesignTokens(
      { ...VALID, brand: { icon: 'app/src/app/icon.svg' } },
      'x.md',
    ).value;

    expect(spec?.brand).toMatchObject({ icon: 'app/src/app/icon.svg', appleIcon: null, ogImage: null, placeholder: null });
  });

  it('brand.placeholder(理由つき)を読める', () => {
    const spec = parseDesignTokens(
      {
        ...VALID,
        brand: { icon: 'app/src/app/icon.svg', placeholder: { reason: '実物のロゴ待ち' } },
      },
      'x.md',
    ).value;

    expect(spec?.brand?.placeholder).toEqual({ reason: '実物のロゴ待ち' });
  });

  it('brand.placeholder に reason が無ければ失敗する', () => {
    const found = findings({
      ...VALID,
      brand: { icon: 'app/src/app/icon.svg', placeholder: {} },
    });

    expect(found.some((finding) => finding.message.includes('reason'))).toBe(true);
  });

  it('brand がマッピングでなければ失敗する', () => {
    const found = findings({ ...VALID, brand: 'app/src/app/icon.svg' });

    expect(found.some((finding) => finding.message.includes('brand はマッピング'))).toBe(true);
  });

  it('note(注記だけの欄)の型違いは error を出すが、落とした行としては数えない', () => {
    const data = structuredClone(VALID);
    (data.groups[0]!.tokens[0] as Record<string, unknown>)['note'] = 5;

    const result = parseDesignTokens(data, 'x.md');

    expect(result.findings.some((f) => f.severity === 'error' && f.message.includes('note は文字列'))).toBe(true);
    expect(result.dropped).toBe(0);
    expect(result.value?.tokens[0]?.note).toBeNull();
  });
});
