/**
 * 外へ送る自由文の無害化の部品(`neutralize.ts`)のテスト。
 *
 * 仕様: 外部連携カタログ(external.md)の `sends.neutralize`。網羅の基準は「効く型 1 つずつ」と「触らない型 1 つずつ」を表で持つこと。
 */

import { describe, expect, it } from 'vitest';
import { allowedDiscordMentionsOf, clampLength, neutralizeDiscordMentions, stripControlChars } from '../neutralize';

describe('neutralizeDiscordMentions', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ['@everyone', '@everyone', '@​everyone'],
    ['@here', '@here', '@​here'],
    ['ユーザー', '<@1>', '<​@1>'],
    ['ロール', '<@&2>', '<​@&2>'],
    ['旧形式のユーザー', '<@!3>', '<​@!3>'],
    ['混在', '@everyone @here <@1> <@&2> <@!3>', '@​everyone @​here <​@1> <​@&2> <​@!3>'],
    ['メールアドレス(触らない)', 'a@b.example', 'a@b.example'],
    ['メンションの無い本文(触らない)', '開演前の知らせ', '開演前の知らせ'],
    ['空', '', ''],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    expect(neutralizeDiscordMentions(input)).toBe(expected);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-NEUTRALIZE-001
  it('壊した本文は、メンションの綴りを 1 つも含まない', () => {
    expect(neutralizeDiscordMentions('@everyone @here <@1> <@&2> <@!3>')).not.toMatch(/@everyone|@here|<@/);
  });
});

describe('allowedDiscordMentionsOf', () => {
  const cases: readonly (readonly [string, string, unknown])[] = [
    ['置かなければ誰も呼べない', '', { parse: [] }],
    ['ユーザー', '<@123>\n', { parse: [], users: ['123'] }],
    ['旧形式のユーザー', '<@!124>\n', { parse: [], users: ['124'] }],
    ['ロール', '<@&456>\n', { parse: [], roles: ['456'] }],
    ['@everyone とロール', '@everyone <@&456>\n', { parse: ['everyone'], roles: ['456'] }],
    ['@here', '@here\n', { parse: ['everyone'] }],
  ];

  it.each(cases)('%s', (_name, prefix, expected) => {
    expect(allowedDiscordMentionsOf(prefix)).toEqual(expected);
  });
});

describe('stripControlChars', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ['ヌル文字', 'a\u0000b', 'ab'],
    ['端末の制御列の先頭(ESC)', 'a\u001b[31mb', 'a[31mb'],
    ['DEL', 'a\u007fb', 'ab'],
    ['C1(0x80)', 'a\u0080b', 'ab'],
    ['C1(0x9f)', 'a\u009fb', 'ab'],
    ['垂直タブと改頁', 'a\u000b\u000cb', 'ab'],
    ['改行・タブ・復帰は残す', 'a\n\tb\r', 'a\n\tb\r'],
    ['0xa0(C1 の外。残す)', 'a b', 'a b'],
    ['ゼロ幅スペース(書式文字。残す)', 'a​b', 'a​b'],
    ['絵文字(サロゲートペア。残す)', 'a😀b', 'a😀b'],
    ['空', '', ''],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    expect(stripControlChars(input)).toBe(expected);
  });
});

describe('clampLength', () => {
  const cases: readonly (readonly [string, string, number, string])[] = [
    ['上限ちょうどは触らない', 'abc', 3, 'abc'],
    ['上限未満は触らない', 'ab', 3, 'ab'],
    ['超えた分を捨てる', 'abcd', 3, 'abc'],
    ['サロゲートペアを割らない', 'a😀b', 2, 'a'],
    ['ペアが収まるなら残す', 'a😀b', 3, 'a😀'],
    ['全角(上位サロゲートの範囲より上の BMP)は割らずにそのまま数える', 'ＡＢ', 1, 'Ａ'],
    ['0 は全部捨てる', 'abc', 0, ''],
    ['負は全部捨てる', 'abc', -1, ''],
    ['整数でない上限は全部捨てる', 'abc', 1.5, ''],
    ['空', '', 5, ''],
  ];

  it.each(cases)('%s', (_name, input, max, expected) => {
    expect(clampLength(input, max)).toBe(expected);
  });
});
