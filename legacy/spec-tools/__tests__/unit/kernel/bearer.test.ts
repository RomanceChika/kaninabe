/**
 * `bearer` の共通語(kernel)のテスト。式の綴りと、生成する値の長さが整合していること。
 */

import { describe, expect, it } from 'vitest';
import { BEARER_BYTES, BEARER_DEFAULT_SQL, BEARER_LENGTH, isBearerDefault } from '../../../lib/kernel/bearer.js';

describe('bearer の定数', () => {
  it('32 バイトの base64url(パディングなし)は 43 字', () => {
    expect(BEARER_BYTES).toBe(32);
    expect(BEARER_LENGTH).toBe(Math.ceil((BEARER_BYTES * 8) / 6));
    expect(Buffer.alloc(BEARER_BYTES).toString('base64url')).toHaveLength(BEARER_LENGTH);
  });

  it('列の既定値の式は CSPRNG(gen_random_bytes)を使い、UUID を使わない', () => {
    expect(BEARER_DEFAULT_SQL).toContain(`gen_random_bytes(${String(BEARER_BYTES)})`);
    expect(BEARER_DEFAULT_SQL).not.toMatch(/uuid/iu);
  });
});

describe('isBearerDefault', () => {
  it.each([
    ['正の綴り', BEARER_DEFAULT_SQL, true],
    ['空白の違い', BEARER_DEFAULT_SQL.replaceAll(', ', ',  '), true],
    ['改行の違い', BEARER_DEFAULT_SQL.replaceAll(', ', ',\n'), true],
    ['UUID の式', "replace((gen_random_uuid())::text, '-'::text, ''::text)", false],
    ['バイト数が違う', BEARER_DEFAULT_SQL.replace('(32)', '(16)'), false],
    ['変換が違う', BEARER_DEFAULT_SQL.replace("'base64'", "'hex'"), false],
    ['空', '', false],
  ])('%s', (_name, expression, expected) => {
    expect(isBearerDefault(expression)).toBe(expected);
  });
});
