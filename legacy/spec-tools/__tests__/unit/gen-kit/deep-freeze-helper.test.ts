/**
 * 生成した定数を深く凍結する補助の関数(`DEEP_FREEZE_HELPER`。点検 7 回目 B7-5)が、生成物の中で実際に値を凍らせることのテスト。
 * 生成物に置く行そのものを JavaScript に直して評価し、入れ子のオブジェクト・配列まで書き換えられないこと(正例)と、原始値を素通しすること(境界)を見る。
 */

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { DEEP_FREEZE, DEEP_FREEZE_HELPER } from '../../../lib/gen-kit/code-emit.js';

/** 生成物に置く補助の関数を評価して取り出す。 */
function helper(): <T>(value: T) => T {
  const js = ts.transpileModule(`${DEEP_FREEZE_HELPER.join('\n')}\nexport {};`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace('export {};', '');
  return new Function(`'use strict';\n${js}\nreturn ${DEEP_FREEZE};`)() as <T>(value: T) => T;
}

describe('DEEP_FREEZE_HELPER', () => {
  const deepFreeze = helper();

  it('探り台本 B7-5 の書き換え(Object.assign で入れ子の値を変える)は、凍結した値では TypeError になり値が変わらない', () => {
    const table = deepFreeze({ '/api/ai/x': { maxBodyBytes: 1024, quota: { per: '1 day' } }, noStore: { name: 'Cache-Control', value: 'no-store' } });
    expect(() => Object.assign(table['/api/ai/x'], { maxBodyBytes: 1_073_741_824 })).toThrow(TypeError);
    expect(() => Object.assign(table.noStore, { value: 'public, max-age=31536000' })).toThrow(TypeError);
    expect(table['/api/ai/x'].maxBodyBytes).toBe(1024);
    expect(table.noStore.value).toBe('no-store');
  });

  it.each([
    ['最上位', (value: { a: { b: { c: number[] } } }) => value],
    ['入れ子のオブジェクト', (value: { a: { b: { c: number[] } } }) => value.a],
    ['さらに入れ子', (value: { a: { b: { c: number[] } } }) => value.a.b],
    ['入れ子の配列', (value: { a: { b: { c: number[] } } }) => value.a.b.c],
  ])('%s まで凍結する', (_title, pick) => {
    const frozen = deepFreeze({ a: { b: { c: [1, 2] } } });
    expect(Object.isFrozen(pick(frozen))).toBe(true);
  });

  it.each([
    ['数', 1],
    ['文字列', 'x'],
    ['null', null],
    ['undefined', undefined],
  ])('境界: %s はそのまま返す', (_title, value) => {
    expect(deepFreeze(value)).toBe(value);
  });

  it('同じ値(参照)を返す(as const の字句の型を保つため、写しを作らない)', () => {
    const value = { a: 1 };
    expect(deepFreeze(value)).toBe(value);
  });
});
