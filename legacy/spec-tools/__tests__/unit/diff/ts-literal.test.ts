import { describe, expect, it } from 'vitest';
import {
  exportedNames,
  readExportedValue,
  readPlainValue,
  topLevelKeys,
} from '../../../lib/diff/ts-literal.js';

describe('readExportedValue — 生成 TS の素のデータ', () => {
  it('コメント・改行・末尾カンマ・入れ子を読む', () => {
    const source = [
      '/** 見出し。 */',
      'export const table = {',
      '  // 行コメント',
      "  alpha: ['one', 'two'],",
      '  beta: { nested: true, count: 3, none: null },',
      '} as const satisfies Something;',
    ].join('\n');
    const read = readExportedValue(source, 'table');
    expect(read).toEqual({
      ok: true,
      value: { alpha: ['one', 'two'], beta: { nested: true, count: 3, none: null } },
    });
  });

  it('型注釈つきの宣言も読む', () => {
    const source = "export const table: Readonly<Record<string, string>> = { alpha: 'one' };";
    const read = readExportedValue(source, 'table');
    expect(read).toEqual({ ok: true, value: { alpha: 'one' } });
  });

  it('宣言が無いことは「読めない」ではなく「宣言が無い」と答える', () => {
    const read = readExportedValue('export const other = {};', 'table');
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.missing).toBe(true);
  });

  it('識別子の参照は素のデータではないと答える(黙って空にしない)', () => {
    const read = readExportedValue('export const table = { alpha: sharedRules };', 'table');
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.missing).toBeUndefined();
  });

  it('閉じていない値は理由を返す', () => {
    const read = readExportedValue("export const table = { alpha: 'one'", 'table');
    expect(read.ok).toBe(false);
  });
});

describe('readPlainValue — JSON も同じ読取器で足りる', () => {
  it('配列とオブジェクトの入れ子を読む', () => {
    expect(readPlainValue('{"a":[1,2],"b":{"c":"d"}}')).toEqual({ ok: true, value: { a: [1, 2], b: { c: 'd' } } });
  });

  it('壊れた JSON は理由を返す', () => {
    expect(readPlainValue('{"a":').ok).toBe(false);
  });
});

describe('topLevelKeys — 素のデータではない生成物からも鍵は取れる', () => {
  it('識別子の参照を値に持っていても第 1 階層の鍵を返す', () => {
    const source = [
      'export const plans = {',
      "  'unit.open': { steps: [{ op: 'unit.open', rules: sharedRules }] },",
      "  'unit.close': { steps: [{ op: 'unit.close', rules: otherRules }] },",
      '} as const satisfies Readonly<Record<string, RunPlan>>;',
    ].join('\n');
    expect(topLevelKeys(source, 'plans')).toEqual({ ok: true, value: ['unit.open', 'unit.close'] });
  });

  it('引用符の無い鍵も読む', () => {
    expect(topLevelKeys('export const plans = { alpha: run(1), beta: run(2) };', 'plans')).toEqual({
      ok: true,
      value: ['alpha', 'beta'],
    });
  });
});

describe('exportedNames — 集約の綴りを仕組み側が持たない', () => {
  it('綴りの形で export を拾い、捕獲を返す', () => {
    const source = 'export const unitStateLabels = {};\nexport const unitEventLabels = {};\n';
    expect(exportedNames(source, /(\w+)StateLabels/)).toEqual([{ name: 'unitStateLabels', captured: 'unit' }]);
  });
});
