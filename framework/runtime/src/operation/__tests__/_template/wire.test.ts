/**
 * 入口の正規化（`toWire` / `presenceOf` / `changeOf`）と `RpcArg` の符号化のテスト。
 *
 * 網羅の基準は「運べる値の型ごとの正例」と「拒否する値の種類ごとの負例（`JSON.stringify` が
 * 黙って落とす・書き換える値を含む）」。**`JSON.stringify` の結果は期待値に使わない** ——
 * 契約は規則表（`wire.ts` の冒頭）であって、変換の偶然ではない。
 */

import { describe, expect, it } from 'vitest';
import type { Change, NonNullJson, Presence } from '@kaninabe/runtime/ports';
import {
  MAX_WIRE_DEPTH,
  ProgrammingError,
  changeOf,
  collapsePresence,
  presenceOf,
  rpcArgToJson,
  rpcArgsToJson,
  toWire,
  toWireInput,
} from '../../_template/wire';

/** 穴のある配列（リテラルの `[1, , 3]` を書かずに作る）。 */
function holey(): unknown[] {
  const list: unknown[] = [1];
  list.length = 3;
  return list;
}

describe('toWire（運べる値）', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-RUNPLAN-001
  it('文字列・有限数・真偽・null はそのまま運ぶ', () => {
    expect(toWire('あ')).toBe('あ');
    expect(toWire(0)).toBe(0);
    expect(toWire(-1.5)).toBe(-1.5);
    expect(toWire(true)).toBe(true);
    expect(toWire(null)).toBeNull();
  });

  it('配列と素のオブジェクトは再帰して運ぶ（入れ子の null も運ぶ）', () => {
    expect(toWire({ a: [1, 'x', null], b: { c: false } })).toEqual({ a: [1, 'x', null], b: { c: false } });
  });

  it('Date は ISO 8601 の文字列にする（不正でない日付）', () => {
    expect(toWire(new Date('2027-06-01T09:30:00.000+09:00'))).toBe('2027-06-01T00:30:00.000Z');
    expect(toWire({ at: [new Date(0)] })).toEqual({ at: ['1970-01-01T00:00:00.000Z'] });
  });

  it('原型を持たないオブジェクトも素のオブジェクトとして運ぶ', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { k: 1 });
    expect(toWire(bare)).toEqual({ k: 1 });
  });

  it('`__proto__` という鍵も自前の鍵として運ぶ（原型を書き換えない）', () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"x":1}}');
    const wire = toWire(parsed) as Record<string, unknown>;
    expect(Object.keys(wire)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(wire)).toBe(Object.prototype);
  });

  it('同じ配列を 2 回参照するのは循環ではない', () => {
    const shared = [1];
    expect(toWire({ a: shared, b: shared })).toEqual({ a: [1], b: [1] });
  });
});

/** 入れ子の配列（`depth` 段）。 */
function nested(depth: number): unknown {
  let value: unknown = [];
  for (let level = 1; level < depth; level += 1) value = [value];
  return value;
}

describe('toWire（拒否する値）', () => {
  it.each([
    ['欄の外の undefined', undefined],
    ['配列の中の undefined', [1, undefined]],
    ['配列の穴', holey()],
    ['入れ子の undefined の鍵', { a: { b: undefined } }],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['配列の中の NaN', [Number.NaN]],
    ['BigInt', 10n],
    ['関数', () => 1],
    ['Symbol', Symbol('s')],
    ['不正な日付', new Date(Number.NaN)],
    ['Map', new Map([['a', 1]])],
    ['Set', new Set([1])],
    ['クラスの実体', new (class Box { public readonly v = 1; })()],
    ['関数を持つ鍵', { f: () => 1 }],
  ])('%s は ProgrammingError で止める', (_label, value) => {
    expect(() => toWire(value)).toThrow(ProgrammingError);
  });

  it('循環した値は ProgrammingError で止める', () => {
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;
    expect(() => toWire(loop)).toThrow(ProgrammingError);
    const list: unknown[] = [];
    list.push(list);
    expect(() => toWire(list)).toThrow(ProgrammingError);
  });

  it('Symbol の鍵を持つオブジェクトは、黙って落とさず拒否する', () => {
    expect(() => toWire({ b: 2, [Symbol('hidden')]: 1 })).toThrow(ProgrammingError);
    expect(() => toWire({ outer: { [Symbol('hidden')]: 1 } })).toThrow('$.outer');
  });

  it('追加のプロパティ（または Symbol の鍵）を持つ配列は、黙って落とさず拒否する', () => {
    expect(() => toWire(Object.assign([1], { extra: 2 }))).toThrow(ProgrammingError);
    expect(() => toWire(Object.assign([1], { [Symbol('hidden')]: 2 }))).toThrow(ProgrammingError);
    expect(toWire([1, 2])).toEqual([1, 2]);
  });

  it('ISO 8601 の 4 桁の年に収まらない日付は、拡張年表記の文字列にせず拒否する', () => {
    expect(() => toWire(new Date(Date.UTC(10000, 0, 1)))).toThrow(ProgrammingError);
    expect(() => toWire(new Date(-62167219200001))).toThrow(ProgrammingError);
    // 範囲の両端は運べる。
    expect(toWire(new Date(-62167219200000))).toBe('0000-01-01T00:00:00.000Z');
    expect(toWire(new Date(253402300799999))).toBe('9999-12-31T23:59:59.999Z');
  });

  it('深すぎる入れ子は RangeError ではなく ProgrammingError で止める（上限ちょうどまでは運ぶ）', () => {
    expect(() => toWire(nested(MAX_WIRE_DEPTH + 1))).toThrow(ProgrammingError);
    expect(() => toWire(nested(20000))).toThrow(ProgrammingError);
    expect(() => toWire(nested(MAX_WIRE_DEPTH))).not.toThrow();
  });

  it('拒否の文面に場所が載る', () => {
    expect(() => toWire({ a: [1, Number.NaN] }, 'input.x')).toThrow('input.x.a[1]');
    expect(() => toWire({ a: undefined })).toThrow('$.a');
  });

  it('ProgrammingError は名前を持つ Error である', () => {
    const error = new ProgrammingError('x');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ProgrammingError');
  });
});

describe('toWireInput（複合 RPC の入力）', () => {
  it('正当な値では、旧い口の JSON.stringify と同じ JSON を運ぶ（欄の undefined は鍵ごと運ばない）', () => {
    const input = {
      'widget.create': { title: 'あ', note: undefined, count: 0, flag: false, text: '', none: null, tags: ['a', null], at: new Date(0) },
      'widget.tag': { label: 'x', nested: { deep: [1, { k: 'v' }] } },
      'widget.skip': undefined,
    };
    const wire = toWireInput(input);

    expect(JSON.stringify(wire)).toBe(JSON.stringify(input));
    expect(wire).toEqual({
      'widget.create': { title: 'あ', count: 0, flag: false, text: '', none: null, tags: ['a', null], at: '1970-01-01T00:00:00.000Z' },
      'widget.tag': { label: 'x', nested: { deep: [1, { k: 'v' }] } },
    });
    expect(Object.keys(wire)).toEqual(['widget.create', 'widget.tag']);
  });

  it('空の入力・空の手順の欄はそのまま運ぶ', () => {
    expect(toWireInput({})).toEqual({});
    expect(toWireInput({ 'widget.create': {} })).toEqual({ 'widget.create': {} });
  });

  it('運べない値は ProgrammingError で止める（黙って null に変えない・落とさない）', () => {
    expect(() => toWireInput({ 'widget.create': { n: Number.NaN } })).toThrow('input.widget.create.n');
    expect(() => toWireInput({ 'widget.create': { list: [1, undefined] } })).toThrow(ProgrammingError);
    expect(() => toWireInput({ 'widget.create': { nested: { k: undefined } } })).toThrow(ProgrammingError);
    expect(() => toWireInput({ 'widget.create': 10n })).toThrow(ProgrammingError);
    expect(() => toWireInput({ 'widget.create': { [Symbol('s')]: 1 } })).toThrow(ProgrammingError);
    expect(() => toWireInput({ 'widget.create': [1, undefined] })).toThrow(ProgrammingError);
    expect(() => toWireInput({ 'widget.create': null })).not.toThrow();
  });
});

describe('presenceOf / changeOf（欄の 3 値）', () => {
  it('undefined は absent / unchanged・null は null / clear・それ以外は value / set', () => {
    expect(presenceOf(undefined)).toEqual({ kind: 'absent' });
    expect(presenceOf(null)).toEqual({ kind: 'null' });
    expect(presenceOf('x')).toEqual({ kind: 'value', value: 'x' });
    expect(presenceOf(0)).toEqual({ kind: 'value', value: 0 });
    expect(presenceOf('')).toEqual({ kind: 'value', value: '' });
    expect(presenceOf(false)).toEqual({ kind: 'value', value: false });
    expect(changeOf(undefined)).toEqual({ kind: 'unchanged' });
    expect(changeOf(null)).toEqual({ kind: 'clear' });
    expect(changeOf('x')).toEqual({ kind: 'set', value: 'x' });
    expect(changeOf([])).toEqual({ kind: 'set', value: [] });
  });

  it('value / set に null は入らない（null は専用の合図だけ）', () => {
    const raws = [undefined, null, 'x', 1, false, [], {}];
    const presences = raws.map((raw) => presenceOf(raw));
    const changes = raws.map((raw) => changeOf(raw));

    expect(presences.map((presence) => presence.kind)).toEqual(['absent', 'null', 'value', 'value', 'value', 'value', 'value']);
    expect(changes.map((change) => change.kind)).toEqual(['unchanged', 'clear', 'set', 'set', 'set', 'set', 'set']);
    for (const presence of presences) expect('value' in presence && presence.value === null).toBe(false);
    for (const change of changes) expect('value' in change && change.value === null).toBe(false);
  });

  it('型の上でも null を持てない（Presence<null> / value: null は型エラー。typecheck が落とし役）', () => {
    // @ts-expect-error `T extends NonNullJson` が null を拒む
    const presenceOfNull: Presence<null> | undefined = undefined;
    // @ts-expect-error `T extends NonNullJson` が null を拒む
    const changeOfNull: Change<null> | undefined = undefined;
    // @ts-expect-error value は null を持てない（null は { kind: 'null' } だけで表す）
    const nullValue: Presence<NonNullJson> = { kind: 'value', value: null };
    // @ts-expect-error set は null を持てない（空にするのは clear だけ）
    const nullSet: Change<NonNullJson> = { kind: 'set', value: null };

    expect([presenceOfNull, changeOfNull, nullValue.kind, nullSet.kind]).toEqual([undefined, undefined, 'value', 'set']);
  });

  it('運べない値は欄でも拒否する（欄の undefined だけが 3 値の合図）', () => {
    expect(() => presenceOf(Number.NaN, 'input.x')).toThrow(ProgrammingError);
    expect(() => changeOf({ a: undefined }, 'input.x')).toThrow(ProgrammingError);
    expect(() => presenceOf(10n)).toThrow(ProgrammingError);
  });

  it('Date の欄は ISO 8601 の value / set になる', () => {
    expect(presenceOf(new Date(0))).toEqual({ kind: 'value', value: '1970-01-01T00:00:00.000Z' });
    expect(changeOf(new Date(0))).toEqual({ kind: 'set', value: '1970-01-01T00:00:00.000Z' });
  });
});

describe('RpcArg の符号化', () => {
  it('value と document は値をそのまま運ぶ', () => {
    expect(rpcArgToJson({ kind: 'value', value: null })).toBeNull();
    expect(rpcArgToJson({ kind: 'value', value: ['a'] })).toEqual(['a']);
    expect(rpcArgToJson({ kind: 'document', value: { k: [1] } })).toEqual({ k: [1] });
  });

  it('record は全欄を出し、absent も null で出す', () => {
    const json = rpcArgToJson({
      kind: 'record',
      fields: { a: { kind: 'absent' }, b: { kind: 'null' }, c: { kind: 'value', value: 'x' } },
    });
    expect(json).toEqual({ a: null, b: null, c: 'x' });
    expect(Object.keys(json as object)).toEqual(['a', 'b', 'c']);
  });

  it('patch は unchanged の鍵を出さず、clear は null・set は値で出す', () => {
    const json = rpcArgToJson({
      kind: 'patch',
      changes: { a: { kind: 'unchanged' }, b: { kind: 'clear' }, c: { kind: 'set', value: 1 } },
    });
    expect(json).toEqual({ b: null, c: 1 });
    expect(Object.keys(json as object)).toEqual(['b', 'c']);
  });

  it('名前付き引数の全部を符号化する', () => {
    expect(
      rpcArgsToJson({ p_a: { kind: 'value', value: 1 }, p_b: { kind: 'patch', changes: { x: { kind: 'unchanged' } } } }),
    ).toEqual({ p_a: 1, p_b: {} });
  });

  it('collapsePresence は absent と null を null に畳む', () => {
    expect(collapsePresence({ kind: 'absent' })).toBeNull();
    expect(collapsePresence({ kind: 'null' })).toBeNull();
    expect(collapsePresence({ kind: 'value', value: 0 })).toBe(0);
  });
});
