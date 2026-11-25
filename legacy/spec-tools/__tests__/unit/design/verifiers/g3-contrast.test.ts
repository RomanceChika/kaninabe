/**
 * G3(宣言した色の重ね方が WCAG AA を満たす + contrast 網羅の床)のテスト。
 *
 * styling.md の G3 が要求する 3 点(満たす組み合わせは通す / 割る組み合わせはエラーにする /
 * 宣言していない組み合わせの比は見ない)と、min の使い分け(4.5 / 3)に 1 つ以上のケースを
 * 置く。加えて、2026-09 に足した**網羅の床**(色トークンが 1 度も contrast に現れないと
 * warning を出す)を別の describe に分ける ―― severity が error / warning で意味が違う
 * (前者は `npm run verify` の終了コードをブロックし、後者はブロックしない)ため、
 * 比の検査のテストが網羅の床の warning に巻き込まれないよう、比のテストは
 * severity: 'error' だけを見る。
 */

import { describe, expect, it } from 'vitest';
import { g3Contrast } from '../../../../lib/design/verifiers/g3-contrast.js';
import { colorToken, designInput, group, tokenSpec, valueToken } from '../../../helpers/design-builder.js';

/** 実際のパレットから 4 色。ink-900 on paper-50 は 15.55:1、warm-500 on paper-50 は 3.16:1。 */
const COLORS = [
  colorToken('color-text', '#211d18'),
  colorToken('color-canvas', '#faf6ef'),
  colorToken('color-border-strong', '#948a79'),
  colorToken('color-faint', '#e7dfd0'),
];

/** 宣言した組み合わせで G3 を実行する。 */
function run(contrast: readonly { fg: string; bg: string; min: number }[]) {
  return g3Contrast.verify(designInput({ spec: tokenSpec({ groups: [group('color', COLORS)], contrast }) }));
}

/** error(比の検査)だけを抜き出す。 */
function errors(findings: ReturnType<typeof run>) {
  return findings.filter((finding) => finding.severity === 'error');
}

describe('G3 コントラスト比の検査', () => {
  it('AA の本文(4.5)を満たす組み合わせは通る', () => {
    const findings = errors(run([{ fg: 'color-text', bg: 'color-canvas', min: 4.5 }]));

    expect(findings).toEqual([]);
  });

  it('UI 部品の境界(3)を満たす組み合わせは通る', () => {
    const findings = errors(run([{ fg: 'color-border-strong', bg: 'color-canvas', min: 3 }]));

    expect(findings).toEqual([]);
  });

  it('本文として使うには足りない色を検出する', () => {
    const findings = errors(run([{ fg: 'color-border-strong', bg: 'color-canvas', min: 4.5 }]));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('コントラスト比が足りません');
    expect(findings[0]?.counterexample?.['required']).toBe('4.5:1');
  });

  it('境界としても足りない色を検出する', () => {
    const findings = errors(run([{ fg: 'color-faint', bg: 'color-canvas', min: 3 }]));

    expect(findings).toHaveLength(1);
  });

  it('宣言していない組み合わせの比は見ない(消せば黙る = 既知の穴。網羅の床は別の warning で拾う)', () => {
    const findings = errors(run([]));

    expect(findings).toEqual([]);
  });

  it('直し方の案内は「行を消す」だけで終わらせない(理由を残すことまで言う)', () => {
    const findings = errors(run([{ fg: 'color-faint', bg: 'color-canvas', min: 3 }]));

    expect(findings[0]?.suggestion).toContain('コメント');
  });

  it('比は順序に依存しない(前景と背景を入れ替えても同じ)', () => {
    const forward = errors(run([{ fg: 'color-text', bg: 'color-canvas', min: 4.5 }]));
    const backward = errors(run([{ fg: 'color-canvas', bg: 'color-text', min: 4.5 }]));

    expect(forward).toEqual(backward);
  });

  it('トークン仕様が無ければ何も報告しない', () => {
    expect(g3Contrast.verify(designInput({ spec: null }))).toEqual([]);
  });
});

describe('G3 contrast 網羅の床(2026-09。行を消せば黙る穴の補い)', () => {
  it('contrast に一度も現れない色トークンを warning で挙げる', () => {
    const findings = run([]);
    const warnings = findings.filter((finding) => finding.severity === 'warning');

    expect(warnings).toHaveLength(COLORS.length);
    expect(warnings.every((finding) => finding.message.includes('contrast に一度も現れません'))).toBe(true);
  });

  it('fg・bg のどちらかにでも現れれば警告しない', () => {
    const findings = run([
      { fg: 'color-text', bg: 'color-canvas', min: 4.5 },
      { fg: 'color-border-strong', bg: 'color-canvas', min: 3 },
      { fg: 'color-faint', bg: 'color-canvas', min: 3 },
    ]);
    const warnings = findings.filter((finding) => finding.severity === 'warning');

    expect(warnings).toEqual([]);
  });

  it('severity は warning(error ではない。verify の終了コードをブロックしない)', () => {
    const findings = run([]);

    expect(findings.every((finding) => finding.severity === 'warning')).toBe(true);
  });

  it('palette を参照しない(ref が無い)トークンは色トークンとして数えない', () => {
    const spec = tokenSpec({
      groups: [group('space', [valueToken('space', 'space-4', '16px')])],
      contrast: [],
    });
    const findings = g3Contrast.verify(designInput({ spec }));

    expect(findings).toEqual([]);
  });

  it('トークン仕様が無ければ何も報告しない', () => {
    expect(g3Contrast.verify(designInput({ spec: null }))).toEqual([]);
  });
});

describe('G3 decorative(理由つきで受け入れる。2026-09)', () => {
  it('decorative を持つトークンは網羅の床の warning から除く', () => {
    const decorated = [
      colorToken('color-text', '#211d18'),
      colorToken('color-canvas', '#faf6ef'),
      colorToken('color-border', '#e7dfd0', '区切り線にしか使わない'),
    ];
    const findings = g3Contrast.verify(
      designInput({ spec: tokenSpec({ groups: [group('color', decorated)], contrast: [] }) }),
    );
    const warnings = findings.filter((finding) => finding.severity === 'warning');

    // decorative の無い 2 色だけが warning になり、color-border は含まれない。
    expect(warnings).toHaveLength(2);
    expect(warnings.some((finding) => finding.counterexample?.['token'] === 'color-border')).toBe(false);
  });

  it('decorative を持つのに contrast にも現れると矛盾として error にする', () => {
    const decorated = [colorToken('color-border', '#e7dfd0', '区切り線にしか使わない'), colorToken('color-canvas', '#faf6ef')];
    const findings = g3Contrast.verify(
      designInput({
        spec: tokenSpec({
          groups: [group('color', decorated)],
          contrast: [{ fg: 'color-border', bg: 'color-canvas', min: 3 }],
        }),
      }),
    );
    const errors = findings.filter((finding) => finding.severity === 'error');

    expect(errors.some((finding) => finding.message.includes('矛盾'))).toBe(true);
    expect(errors.some((finding) => finding.counterexample?.['token'] === 'color-border')).toBe(true);
  });

  it('decorative が無く contrast にも現れなければ、これまでどおり warning のまま', () => {
    const findings = g3Contrast.verify(
      designInput({
        spec: tokenSpec({ groups: [group('color', [colorToken('color-border', '#e7dfd0')])], contrast: [] }),
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
  });
});
