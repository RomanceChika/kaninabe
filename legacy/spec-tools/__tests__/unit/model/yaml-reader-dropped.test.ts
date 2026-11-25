/**
 * `YamlReader` が、型違いで読み飛ばした値・既定値に戻した値を**落とした行として数える**ことのテスト(部品化 入力の状態-e)。
 *
 * 以前は `collectStrings`(文字列でない要素の読み飛ばし)・`optionalBoolean`(型違いを既定値へ戻す)・`optionalNumber` /
 * `optionalStringMap` / `optionalString` が違反を記録するだけで、`dropped` は 0 のままだった。error は出るのに入力の状態は読込済みで、
 * 弱くなったモデルで検査・生成が走った。ここでは読み取り器の側で数えるので、各パーサーが個別に数え直さなくてよい。
 *
 * 数えないもの(0 のまま)は、値が無い(欠落・null)場合と、読めた値(型が合う)の場合である。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../lib/model/parse-common.js';
import { YamlReader } from '../../../lib/model/yaml-reader.js';

/** 1 つのマッピングを読む読み取り器と、その記録器。 */
function readerOf(record: Readonly<Record<string, unknown>>): { readonly reader: YamlReader; readonly reporter: SpecReporter } {
  const reporter = new SpecReporter('x.md');
  return { reader: new YamlReader(record, '', reporter), reporter };
}

const HINT = '直す';

/** 型違いの値を読ませる呼び方(読み取り器の口ごとに 1 つ)。 */
const MISMATCHES: readonly (readonly [string, Readonly<Record<string, unknown>>, (reader: YamlReader) => unknown])[] = [
  ['requiredString(数値)', { a: 1 }, (r) => r.requiredString('a', HINT)],
  ['optionalString(数値)', { a: 1 }, (r) => r.optionalString('a', HINT)],
  ['optionalStringOrNull(数値)', { a: 1 }, (r) => r.optionalStringOrNull('a', HINT)],
  ['optionalBoolean("true")', { a: 'true' }, (r) => r.optionalBoolean('a', HINT)],
  ['requiredBoolean("yes")', { a: 'yes' }, (r) => r.requiredBoolean('a', HINT)],
  ['optionalNumber("5")', { a: '5' }, (r) => r.optionalNumber('a', HINT)],
  ['optionalNumber(NaN)', { a: Number.NaN }, (r) => r.optionalNumber('a', HINT)],
  ['optionalStringMap(リスト)', { a: ['x'] }, (r) => r.optionalStringMap('a', HINT)],
  ['optionalStringMap(文字列でない値)', { a: { k: 1 } }, (r) => r.optionalStringMap('a', HINT)],
  ['requiredStringList(数値の要素)', { a: ['x', 5] }, (r) => r.requiredStringList('a', HINT)],
  ['optionalStringList(数値の要素)', { a: ['x', 5] }, (r) => r.optionalStringList('a', HINT)],
  ['optionalList(リストでない)', { a: 'x' }, (r) => r.optionalList('a', HINT)],
  ['requiredList(リストでない)', { a: 'x' }, (r) => r.requiredList('a', HINT)],
];

/** 欠落・null・型の合う値を読ませる呼び方(落とした行は無い)。 */
const BENIGN: readonly (readonly [string, Readonly<Record<string, unknown>>, (reader: YamlReader) => unknown])[] = [
  ['optionalString(欠落)', {}, (r) => r.optionalString('a', HINT)],
  ['optionalString(null)', { a: null }, (r) => r.optionalString('a', HINT)],
  ['optionalString(文字列)', { a: 'x' }, (r) => r.optionalString('a', HINT)],
  ['optionalStringOrNull(null)', { a: null }, (r) => r.optionalStringOrNull('a', HINT)],
  ['optionalBoolean(欠落)', {}, (r) => r.optionalBoolean('a', HINT)],
  ['optionalBoolean(true)', { a: true }, (r) => r.optionalBoolean('a', HINT)],
  ['optionalNumber(欠落)', {}, (r) => r.optionalNumber('a', HINT)],
  ['optionalNumber(null)', { a: null }, (r) => r.optionalNumber('a', HINT)],
  ['optionalNumber(数値)', { a: 5 }, (r) => r.optionalNumber('a', HINT)],
  ['optionalStringMap(欠落)', {}, (r) => r.optionalStringMap('a', HINT)],
  ['optionalStringMap(文字列の写像)', { a: { k: 'v' } }, (r) => r.optionalStringMap('a', HINT)],
  ['optionalStringList(欠落)', {}, (r) => r.optionalStringList('a', HINT)],
  ['optionalStringList(文字列だけ)', { a: ['x', 'y'] }, (r) => r.optionalStringList('a', HINT)],
];

describe('型違いで読み飛ばした値・既定値に戻した値は、落とした行として数える', () => {
  it.each(MISMATCHES)('%s: error を記録し、dropped が 1 以上になる', (_label, record, read) => {
    const { reader, reporter } = readerOf(record);

    read(reader);

    expect(reporter.findings().filter((finding) => finding.severity === 'error').length).toBeGreaterThan(0);
    expect(reporter.droppedCount()).toBeGreaterThan(0);
  });

  it.each(BENIGN)('%s: 値が無い・型が合うので、error も落とした行も無い', (_label, record, read) => {
    const { reader, reporter } = readerOf(record);

    read(reader);

    expect(reporter.findings()).toEqual([]);
    expect(reporter.droppedCount()).toBe(0);
  });

  it('文字列でない要素は 1 要素ごとに数える(読み飛ばした分だけ)', () => {
    const { reader, reporter } = readerOf({ a: ['x', 1, 2, 'y', true] });

    expect(reader.optionalStringList('a', HINT)).toEqual(['x', 'y']);
    expect(reporter.droppedCount()).toBe(3);
  });

  it('型違いの真偽値は既定値に戻る。戻った宣言は落とした行として数える(読込済みのまま弱いモデルで検査を回さない)', () => {
    const { reader, reporter } = readerOf({ in_transaction: 'true' });

    expect(reader.optionalBoolean('in_transaction', HINT, false)).toBe(false);
    expect(reporter.droppedCount()).toBe(1);
  });

  it('文字列でない値を持つキーだけが落ち、読めたキーは残る', () => {
    const { reader, reporter } = readerOf({ params: { ok: 'v', bad: 5 } });

    expect(reader.optionalStringMap('params', HINT)).toEqual({ ok: 'v' });
    expect(reporter.droppedCount()).toBe(1);
  });
});

describe('optionalNote: 注記だけの欄の型違いは error を出すが数えない', () => {
  it('型違いの注記は error を記録して undefined を返す。落とした行としては数えない(注記を読み飛ばしても検査・生成の判定は変わらない)', () => {
    const { reader, reporter } = readerOf({ note: 5 });

    expect(reader.optionalNote('note', HINT)).toBeUndefined();
    expect(reporter.findings().map((finding) => finding.severity)).toEqual(['error']);
    expect(reporter.droppedCount()).toBe(0);
  });

  it.each([
    ['欠落', {}, undefined],
    ['null', { note: null }, undefined],
    ['文字列', { note: '主ボタン' }, '主ボタン'],
  ])('%s: error も落とした行も無い', (_label, record, expected) => {
    const { reader, reporter } = readerOf(record);

    expect(reader.optionalNote('note', HINT)).toBe(expected);
    expect(reporter.findings()).toEqual([]);
    expect(reporter.droppedCount()).toBe(0);
  });
});

