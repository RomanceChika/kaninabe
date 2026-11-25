/**
 * data_table の既定値の式の閉じた読み手(`risk/verifiers/default-literal.ts`。点検 11 回目 A11-1)の表。
 *
 * 読める形は綴りのまま値を返す(大文字小文字を変えない)。読めない形は「役を与えない」に倒さず `unreadable` を返す。
 */

import { describe, expect, it } from 'vitest';
import { defaultGrant, readDefaultLiteral } from '../../../lib/risk/verifiers/default-literal.js';

describe('readDefaultLiteral', () => {
  it.each([
    { raw: "'pro'", value: 'pro' },
    { raw: "'pro'::text", value: 'pro' },
    { raw: "'Pro'::text", value: 'Pro' },
    { raw: "'PRO'::text", value: 'PRO' },
    { raw: "'pro'::account_tier", value: 'pro' },
    { raw: "'pro'::public.account_tier", value: 'pro' },
    { raw: `'pro'::"Account_Tier"`, value: 'pro' },
    { raw: "'pro'::character varying", value: 'pro' },
    { raw: "'pro'::character varying(10)", value: 'pro' },
    { raw: "'1.5'::numeric(4, 2)", value: '1.5' },
    { raw: "('pro'::text)", value: 'pro' },
    { raw: "(('pro'::character varying)::text)", value: 'pro' },
    { raw: "  'pro'  ", value: 'pro' },
    { raw: "'it''s'::text", value: "it's" },
    { raw: "''::text", value: '' },
    { raw: 'true', value: 'true' },
    { raw: 'FALSE', value: 'FALSE' },
    { raw: '0', value: '0' },
    { raw: '-1.5', value: '-1.5' },
    { raw: 'null', value: null },
    { raw: 'NULL::text', value: null },
  ])('読める: $raw → $value', ({ raw, value }) => {
    expect(readDefaultLiteral(raw)).toEqual({ readable: true, value });
  });

  it.each([
    { raw: 'now()' },
    { raw: 'gen_random_uuid()' },
    { raw: "lower('PRO'::text)" },
    { raw: "'a'::text || 'b'::text" },
    { raw: "('a') || ('b')" },
    { raw: "'pro'::text || current_user" },
    { raw: "E'pro'" },
    { raw: 'Pro' },
    { raw: 'current_user' },
    { raw: "CASE WHEN true THEN 'pro' ELSE 'free' END" },
    { raw: "'pro'::text and false" },
    { raw: "'pro" },
    { raw: '' },
  ])('読めない: $raw', ({ raw }) => {
    expect(readDefaultLiteral(raw)).toEqual({ readable: false });
  });
});

describe('defaultGrant', () => {
  it.each([
    { name: '値の集合に綴りのまま入る', raw: "'pro'::text", values: ['pro'], expected: 'grants' },
    { name: '大文字の値(以前は小文字に潰して一致しなかった)', raw: "'Pro'::text", values: ['Pro'], expected: 'grants' },
    { name: '全部大文字の値', raw: "'PRO'::text", values: ['PRO'], expected: 'grants' },
    { name: '綴りが違えば与えない(値の集合の比較は大文字小文字を区別する)', raw: "'PRO'::text", values: ['Pro'], expected: 'none' },
    { name: '別の値は与えない', raw: "'free'::text", values: ['pro'], expected: 'none' },
    { name: 'NULL は与えない', raw: 'null', values: ['pro'], expected: 'none' },
    { name: '値の集合でも読めない式は読めない', raw: "lower('PRO'::text)", values: ['pro'], expected: 'unreadable' },
    { name: 'boolean の真', raw: 'true', values: null, expected: 'grants' },
    { name: 'boolean の真(大文字。boolean だけ大文字小文字を無視する)', raw: 'TRUE', values: undefined, expected: 'grants' },
    { name: 'boolean の真(型つき)', raw: "'true'::boolean", values: null, expected: 'grants' },
    { name: 'boolean の偽', raw: 'False', values: null, expected: 'none' },
    { name: 'boolean の NULL は与えない', raw: 'NULL', values: null, expected: 'none' },
    { name: 'boolean で true / false 以外の字面は読めない', raw: "'t'::boolean", values: null, expected: 'unreadable' },
    { name: 'boolean で読めない式は読めない', raw: 'is_default()', values: null, expected: 'unreadable' },
  ])('$name', ({ raw, values, expected }) => {
    expect(defaultGrant(raw, values)).toBe(expected);
  });
});
