/**
 * T25(`personal_placeholder` は列の制約に収まる。点検 14 回目 A14-4)のテスト。
 *
 * 表: 列の種類 × 置換値。Q1〜Q5 は点検の反例である。
 */

import { describe, expect, it } from 'vitest';
import { verifyPersonalPlaceholders } from '../../../../lib/data/verifiers/t25-personal-placeholder.js';
import type { FieldDef, FieldType } from '../../../../lib/model/types.js';
import { aggregate, entitySpec, field, specModel } from '../../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';

const STRING = { kind: 'string' } as const;

/** 列 1 本の題材(`unique` なら一意の索引の鍵に入れる)。 */
function run(type: FieldType, placeholder: string | null, extra: Partial<FieldDef> = {}, unique = false) {
  const domain = specModel({ aggregates: [aggregate({ name: 'guest', entity: entitySpec('guest', [field('value', type, { personal: true, personalPlaceholder: placeholder, ...extra })]) })] });
  const indexes = unique ? [{ name: 'guests_value_unique', on: ['value', 'tenant_id'], unique: true }] : [];
  return verifyPersonalPlaceholders(domain, dataTableModel([dataTable('guests', { entity: 'guest', indexes })]));
}

describe('T25 置換値と列の制約', () => {
  it.each<[string, FieldType, string | null, Partial<FieldDef>, boolean, string]>([
    ['Q1 一意の列に固定の値', STRING, 'erased', {}, true, '2 人目'],
    ['Q2 長さの超過', STRING, 'あ'.repeat(80), { maxLength: 50 }, false, 'max_length'],
    ['Q3 必須の列に null', STRING, null, { required: true }, false, '空にできない'],
    ['Q4 {id} が長さに収まらない', STRING, '{id}', { maxLength: 16 }, true, 'max_length'],
    ['Q5 boolean に文字列', { kind: 'boolean' }, 'erased', {}, false, 'true / false'],
    ['接頭辞つきの {id} が長さを超える', STRING, 'deleted-{id}', { maxLength: 32 }, true, 'max_length'],
    ['pattern に合わない', STRING, '(消去済み)', { pattern: '^[a-z]+$' }, false, 'pattern'],
    ['format の列の文字列', STRING, 'erased', { format: 'url' }, false, 'format'],
    ['integer に文字列', { kind: 'integer' }, 'x', {}, false, 'integer'],
    ['integer に小数', { kind: 'integer' }, '1.5', {}, false, 'integer'],
    ['範囲の外', { kind: 'integer' }, '-1', { min: 0 }, false, '範囲'],
    ['enum の外', { kind: 'enum', values: ['a', 'b'] }, 'c', {}, false, 'enum'],
    ['date に文字列', { kind: 'date' }, 'erased', {}, false, 'null だけ'],
    ['ref に文字列', { kind: 'ref', entity: 'member' }, 'x', {}, false, 'null だけ'],
  ])('赤: %s', (_name, type, placeholder, extra, unique, word) => {
    const findings = run(type, placeholder, extra, unique);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('T25');
    expect(findings[0]?.message).toContain(word);
  });

  it.each<[string, FieldType, string | null, Partial<FieldDef>, boolean]>([
    ['一意の列に {id}', STRING, '{id}', { maxLength: 32 }, true],
    ['一意の列に null', STRING, null, {}, true],
    ['固定の値(一意でない)', STRING, '(消去済み)', { maxLength: 50 }, false],
    ['任意の列に null', STRING, null, {}, false],
    ['boolean', { kind: 'boolean' }, 'false', {}, false],
    ['integer の範囲の中', { kind: 'integer' }, '0', { min: 0, max: 10 }, false],
    ['enum の値', { kind: 'enum', values: ['a', 'b'] }, 'a', {}, false],
    ['date に null', { kind: 'date' }, null, {}, false],
    ['pattern に {id} が合う', STRING, '{id}', { pattern: '^[0-9a-f]{32}$' }, true],
  ])('緑: %s', (_name, type, placeholder, extra, unique) => {
    expect(run(type, placeholder, extra, unique)).toEqual([]);
  });

  it('一意でない索引の列は固定の値でよい', () => {
    const domain = specModel({ aggregates: [aggregate({ name: 'guest', entity: entitySpec('guest', [field('value', STRING, { personal: true, personalPlaceholder: 'x' })]) })] });
    expect(verifyPersonalPlaceholders(domain, dataTableModel([dataTable('guests', { entity: 'guest', indexes: [{ name: 'i', on: ['value'], unique: false }] })]))).toEqual([]);
  });

  it('個人列でない列は見ない', () => {
    const domain = specModel({ aggregates: [aggregate({ name: 'guest', entity: entitySpec('guest', [field('value', STRING)]) })] });
    expect(verifyPersonalPlaceholders(domain, dataTableModel([dataTable('guests', { entity: 'guest' })]))).toEqual([]);
  });
});
