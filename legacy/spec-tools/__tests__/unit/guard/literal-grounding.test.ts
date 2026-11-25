/**
 * 比較リテラルの接地(lib/guard/literal-grounding.ts)のテスト。
 * 対象の要求: 左辺の値域が閉じている(state / enum / boolean)比較について、
 * 右辺のリテラルが宣言済みの値であること。V2 / V10 が共有する判定なのでここで一度に見る。
 */

import { describe, expect, it } from 'vitest';
import type { DomainEnv } from '../../../lib/guard/ast.js';
import { ungroundedLiterals } from '../../../lib/guard/literal-grounding.js';
import { parseGuard } from '../../../lib/guard/parser.js';

const ENV: DomainEnv = new Map([
  ['state', { kind: 'finite', values: ['draft', 'submitted'] }],
  ['workshop.state', { kind: 'finite', values: ['accepting', 'closed'] }],
  ['kind', { kind: 'finite', values: ['performance', 'audience'] }],
  ['published', { kind: 'finite', values: ['true', 'false'] }],
  ['title', { kind: 'opaque' }],
  ['duration_min', { kind: 'ordered', discrete: true }],
]);

/** 式を 1 本パースして接地しないリテラルを集める。 */
function check(source: string) {
  const parsed = parseGuard(source);
  if (!parsed.ok) throw new Error(`テストの式がパースできません: ${source}`);
  return ungroundedLiterals(parsed.expr, ENV);
}

describe('ungroundedLiterals', () => {
  it('宣言済みの値との比較は何も返さない', () => {
    expect(check('state == draft and workshop.state != closed')).toEqual([]);
  });

  it('値域に無いリテラルを、取り得る値ごと返す', () => {
    expect(check('workshop.state == acceptng')).toEqual([
      { path: 'workshop.state', value: 'acceptng', allowed: ['accepting', 'closed'] },
    ]);
  });

  it('他の節が生きている式でも綴り違いを拾う(恒偽判定では黙る形)', () => {
    expect(check('state == draft or state == publik').map((entry) => entry.value)).toEqual([
      'publik',
    ]);
  });

  it('in / not in の並びも等号比較として数える', () => {
    expect(check('state not in [draft, submited]').map((entry) => entry.value)).toEqual([
      'submited',
    ]);
  });

  it('boolean は true / false だけを許す', () => {
    expect(check('published == true')).toEqual([]);
    expect(check('published == yes').map((entry) => entry.value)).toEqual(['yes']);
  });

  it('数値リテラルとの比較も値域に無ければ拾う', () => {
    expect(check('kind == 3').map((entry) => entry.value)).toEqual(['3']);
  });

  it('値域が開いている左辺(opaque / ordered)は照合しない', () => {
    expect(check('title == anything and duration_min > 30')).toEqual([]);
  });

  it('右辺がパスの比較は照合しない', () => {
    expect(check('state == workshop.state')).toEqual([]);
  });

  it('env に宣言の無いパスは照合しない(実在は V2 のパス解決が見る)', () => {
    expect(check('stage == draft')).toEqual([]);
  });

  it('同じ左辺・同じ値は 1 件にまとめる', () => {
    expect(check('state == publik or state == publik')).toHaveLength(1);
  });
});
