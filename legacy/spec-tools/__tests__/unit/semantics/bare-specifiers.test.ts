/**
 * 素の指定子の許可表(`lib/semantics/bare-specifiers.ts`。点検 7 回目 B7-2)のユニットテスト。
 */

import { describe, expect, it } from 'vitest';
import { dependencyNamesOf, isListedBareSpecifier } from '../../../lib/semantics/bare-specifiers.js';

describe('dependencyNamesOf', () => {
  it('依存の 4 欄の名前を集める(scripts・imports・exports などほかの欄は数えない)', () => {
    const text = JSON.stringify({
      name: 'app',
      dependencies: { next: '1' },
      devDependencies: { vitest: '1' },
      optionalDependencies: { fsevents: '1' },
      peerDependencies: { react: '1' },
      imports: { '#comp/*': './src/composition/*.ts' },
      scripts: { build: 'next build' },
    });
    expect([...dependencyNamesOf(text)].sort()).toEqual(['fsevents', 'next', 'react', 'vitest']);
  });

  it.each([
    ['読めない', null],
    ['JSON でない', '{'],
    ['オブジェクトでない', '[]'],
    ['欄が配列', JSON.stringify({ dependencies: ['next'] })],
    ['欄が文字列', JSON.stringify({ dependencies: 'next' })],
  ])('%s → 空(どの素の指定子も受けない)', (_title, text) => {
    expect(dependencyNamesOf(text).size).toBe(0);
  });
});

describe('isListedBareSpecifier', () => {
  const deps = new Set(['next', '@kaninabe/runtime', 'zod']);
  const CASES: readonly (readonly [string, boolean])[] = [
    ['next', true],
    ['next/server', true],
    ['@kaninabe/runtime', true],
    ['@kaninabe/runtime/http/paid-entry', true],
    ['zod', true],
    ['node:crypto', true],
    ['node:fs/promises', true],
    ['nextra', false],
    ['@kaninabe/runtime-x', false],
    ['@kaninabe/lint-config', false],
    ['#comp/ai', false],
    ['~/composition/ai', false],
    ['composition/ai', false],
    ['path', false],
    ['node:', false],
    ['', false],
  ];
  it.each(CASES)('%s → %s', (specifier, expected) => {
    expect(isListedBareSpecifier(specifier, deps)).toBe(expected);
  });
});
