/**
 * R10(上限の無い欄)の単体テスト。型ごとに「止める形」「受け入れ」「受け入れの誤用」を 1 つずつ固定する。
 */

import { describe, expect, it } from 'vitest';
import { verifyFieldBounds } from '../../../lib/risk/verifiers/r10-field-bounds.js';
import type { FieldDef } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, specModel } from '../../helpers/model-builder.js';

/** 欄 1 本だけを持つモデルの R10 の指摘。 */
function findingsFor(def: FieldDef): readonly string[] {
  const model = specModel([aggregate('thing', { entity: entitySpec('thing', { fields: [def] }) })]);
  return verifyFieldBounds(model).map((finding) => `${finding.verifier}|${finding.message}`);
}

/** 制約を足した欄。 */
function withBounds(def: FieldDef, extra: Partial<Pick<FieldDef, 'maxLength' | 'min' | 'max' | 'unbounded'>>): FieldDef {
  return { ...def, ...extra };
}

describe('R10 文字列の欄', () => {
  const text = field('note', { kind: 'string' });

  it('max_length が無い文字列の欄は止まる', () => {
    expect(findingsFor(text)).toEqual([expect.stringContaining('R10|thing.note は長さの上限が無い文字列の欄です')]);
  });

  it('text 型も同じく止まる', () => {
    expect(findingsFor(field('body', { kind: 'text' }))).toHaveLength(1);
  });

  it('max_length があれば通る', () => {
    expect(findingsFor(withBounds(text, { maxLength: 200 }))).toEqual([]);
  });

  it('unbounded に理由があれば通る(受け入れ)', () => {
    expect(findingsFor(withBounds(text, { unbounded: '外部の文書をそのまま写すので上限を決められない' }))).toEqual([]);
  });

  it('unbounded の理由が空白だけなら止まる', () => {
    expect(findingsFor(withBounds(text, { unbounded: '  ' }))).toEqual([expect.stringContaining('unbounded の理由が空です')]);
  });

  it('max_length と unbounded の併記は止まる', () => {
    expect(findingsFor(withBounds(text, { maxLength: 10, unbounded: '理由' }))).toEqual([expect.stringContaining('併記しています')]);
  });
});

describe('R10 数の欄', () => {
  const count = field('count', { kind: 'integer' });

  it('下限と上限の両方が無い integer は止まる', () => {
    expect(findingsFor(count)).toEqual([expect.stringContaining('範囲の下限と上限が無い数の欄です')]);
  });

  it('上限だけが無い decimal は止まる', () => {
    expect(findingsFor(withBounds(field('price', { kind: 'decimal' }), { min: 0 }))).toEqual([expect.stringContaining('範囲の上限が無い数の欄です')]);
  });

  it('下限だけが無い integer は止まる', () => {
    expect(findingsFor(withBounds(count, { max: 10 }))).toEqual([expect.stringContaining('範囲の下限が無い数の欄です')]);
  });

  it('min と max があれば通る', () => {
    expect(findingsFor(withBounds(count, { min: 0, max: 10 }))).toEqual([]);
  });

  it('数の欄の unbounded は受け入れにならず、それ自体も止まる', () => {
    expect(findingsFor(withBounds(count, { min: 0, max: 10, unbounded: '理由' }))).toEqual([expect.stringContaining('数の欄に unbounded を書いています')]);
  });
});

describe('R10 ほかの型', () => {
  it('上限を要らない型(boolean)は何も言わない', () => {
    expect(findingsFor(field('flag', { kind: 'boolean' }))).toEqual([]);
  });

  it('効く欄の無い unbounded は止まる', () => {
    expect(findingsFor(withBounds(field('flag', { kind: 'boolean' }), { unbounded: '理由' }))).toEqual([expect.stringContaining('boolean の欄に unbounded を書いています')]);
  });

  it('entity_spec の無い集約は見ない', () => {
    expect(verifyFieldBounds(specModel([aggregate('empty')]))).toEqual([]);
  });
});
