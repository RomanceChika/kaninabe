/**
 * 外へ送る自由文の無害化の語彙(kernel)のテスト。
 *
 * 語 → 宣言 → 部品の export 名の対応を固定し、その名前が実行時パッケージ `@kaninabe/runtime/neutralize` の export と一致することを見る
 * (片方だけ名前を変えた日に赤になる)。
 */

import { describe, expect, it } from 'vitest';
import * as runtime from '@kaninabe/runtime/neutralize';
import { NEUTRALIZE_LENGTH_CEILING, PLAIN_NEUTRALIZERS, neutralizerExports, neutralizerWord, parseNeutralizer } from '../../../lib/kernel/neutralize.js';

describe('parseNeutralizer', () => {
  it.each([
    ['discord_mentions', { kind: 'discord_mentions' }],
    ['control_chars', { kind: 'control_chars' }],
    ['length:1', { kind: 'length', max: 1 }],
    ['length:2000', { kind: 'length', max: 2000 }],
    [`length:${String(NEUTRALIZE_LENGTH_CEILING)}`, { kind: 'length', max: NEUTRALIZE_LENGTH_CEILING }],
  ])('受理: %s', (word, expected) => {
    expect(parseNeutralizer(word)).toEqual(expected);
  });

  it.each(['', 'length', 'length:', 'length:0', 'length:-1', 'length:01', 'length:1.5', 'length:1000001', 'length:12345678', 'Length:5', 'html', 'discord_mentions ', ' control_chars'])(
    '拒否: %j',
    (word) => {
      expect(parseNeutralizer(word)).toBeNull();
    },
  );

  it('語に戻すと同じ綴りになる', () => {
    for (const word of [...PLAIN_NEUTRALIZERS, 'length:2000']) {
      const decl = parseNeutralizer(word);
      expect(decl === null ? null : neutralizerWord(decl)).toBe(word);
    }
  });
});

describe('neutralizerExports(実行時パッケージの export と一致する)', () => {
  const decls = [...PLAIN_NEUTRALIZERS, 'length:10'].map((word) => parseNeutralizer(word));

  it('どの宣言が要求する名前も、実行時パッケージが関数として export している', () => {
    for (const decl of decls) {
      expect(decl).not.toBeNull();
      if (decl === null) continue;
      for (const name of neutralizerExports(decl)) {
        expect(typeof (runtime as Record<string, unknown>)[name], name).toBe('function');
      }
    }
  });

  it('discord_mentions は本文の無害化と許可の絞りの両方を要求する', () => {
    expect(neutralizerExports({ kind: 'discord_mentions' })).toEqual(['neutralizeDiscordMentions', 'allowedDiscordMentionsOf']);
  });
});
