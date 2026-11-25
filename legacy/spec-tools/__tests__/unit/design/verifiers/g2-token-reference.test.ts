/**
 * G2(参照したトークンが実在する)のテスト。
 *
 * styling.md の G2 が要求する 3 点(実在するトークンは通す / 未定義はエラーにする /
 * externals に宣言したものは通す)と、綴り違いの案内に 1 つ以上のケースを置く。
 */

import { describe, expect, it } from 'vitest';
import { g2TokenReference } from '../../../../lib/design/verifiers/g2-token-reference.js';
import {
  colorToken,
  cssFile,
  designInput,
  group,
  tokenSpec,
} from '../../../helpers/design-builder.js';

/** 定義済みのトークンを 2 つ持つ仕様。 */
const SPEC = tokenSpec({
  groups: [group('color', [colorToken('color-accent', '#31417a'), colorToken('color-canvas', '#faf6ef')])],
  externals: [{ name: 'font-serif-jp', from: 'app/src/app/layout.tsx', reason: 'next/font が作る' }],
});

/** 1 枚の CSS に対して G2 を実行する。 */
function run(source: string) {
  return g2TokenReference.verify(
    designInput({ spec: SPEC, files: [cssFile('app/src/a.module.css', source)] }),
  );
}

describe('G2 トークンの実在', () => {
  it('定義済みのトークンは通る', () => {
    const findings = run('.a { color: var(--color-accent); }');

    expect(findings).toEqual([]);
  });

  it('externals に宣言された変数は通る', () => {
    const findings = run('.a { font-family: var(--font-serif-jp), serif; }');

    expect(findings).toEqual([]);
  });

  it('実在しないトークンを検出する', () => {
    const findings = run('.a { color: var(--color-nowhere); }');

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('実在しないトークンを参照しています');
    expect(findings[0]?.counterexample?.['token']).toBe('color-nowhere');
  });

  it('綴り違いには近い名前を案内する', () => {
    const findings = run('.a { color: var(--color-acccent); }');

    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestion).toContain('color-accent');
  });

  it('まったく違う名前には足し方を案内する', () => {
    const findings = run('.a { color: var(--zzzz); }');

    expect(findings[0]?.suggestion).toContain('externals');
  });

  it('生成物の中の参照も検査する(externals の宣言漏れはここでしか見えない)', () => {
    const findings = g2TokenReference.verify(
      designInput({
        spec: SPEC,
        files: [cssFile('app/src/domain/generated/tokens.css', ':root { --font-serif: var(--font-unknown); }', true)],
      }),
    );

    expect(findings).toHaveLength(1);
  });

  it('トークン仕様が無ければ何も報告しない', () => {
    const findings = g2TokenReference.verify(
      designInput({ spec: null, files: [cssFile('app/src/a.module.css', '.a { color: var(--x); }')] }),
    );

    expect(findings).toEqual([]);
  });
});
