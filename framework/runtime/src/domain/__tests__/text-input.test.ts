/**
 * `textInput` / `hasForbiddenCharacter`(利用者が入力する文字列の共通の検証。点検 17 回目 O17-3・18 回目 O18-2)のテスト。
 *
 * 基準: 境界の 1 文字ずつの表(許す・拒む)と、孤立した surrogate、スキーマの鎖(`.trim().min().max().regex()`)が続けられること。
 */

import { describe, expect, it } from 'vitest';
import { CONTROL_CHARACTER_MESSAGE, hasForbiddenCharacter, textInput } from '../text-input';

/** 拒む文字(入力 → 名前)。C0・DEL・C1 の端と、孤立した surrogate。 */
const FORBIDDEN: ReadonlyArray<readonly [string, string]> = [
  ['\u0000', 'NUL'],
  ['\u0001', 'SOH'],
  ['\u0008', 'BS(タブの手前)'],
  ['\u000b', 'VT(改行の次)'],
  ['\u000c', 'FF'],
  ['\u000e', 'SO(復帰の次の次)'],
  ['\u001b', 'ESC'],
  ['\u001f', 'US(空白の手前)'],
  ['\u007f', 'DEL'],
  ['\u0080', 'C1 の先頭'],
  ['\u0085', 'NEL'],
  ['\u009f', 'C1 の末尾'],
  ['\ud800', '孤立した high'],
  ['\udbff', '孤立した high の末尾'],
  ['\udc00', '孤立した low'],
  ['\udfff', '孤立した low の末尾'],
];

/** 許す文字。 */
const ALLOWED: ReadonlyArray<readonly [string, string]> = [
  ['\t', 'タブ'],
  ['\n', '改行'],
  ['\r', '復帰'],
  [' ', '空白'],
  ['~', 'チルダ(DEL の手前)'],
  [' ', 'NBSP(C1 の次)'],
  [' ', '行区切り'],
  ['あ', '日本語'],
  ['😀', '対になった surrogate(補助面)'],
  ['', '空文字'],
];

describe('hasForbiddenCharacter', () => {
  it.each(FORBIDDEN)('%j(%s)は拒む(文字列のどこにあっても)', (char) => {
    expect(hasForbiddenCharacter(char)).toBe(true);
    expect(hasForbiddenCharacter('a' + char + 'b')).toBe(true);
    expect(hasForbiddenCharacter(char + 'あ')).toBe(true);
  });

  it.each(ALLOWED)('%j(%s)は許す', (char) => {
    expect(hasForbiddenCharacter(char)).toBe(false);
    expect(hasForbiddenCharacter('a' + char + 'b')).toBe(false);
  });

  it('逆順の対(low の次に high)と、末尾の high は孤立として拒む。正しい対は許す', () => {
    expect(hasForbiddenCharacter('\udc00\ud800')).toBe(true);
    expect(hasForbiddenCharacter('x\ud83d')).toBe(true);
    expect(hasForbiddenCharacter('😀')).toBe(false);
  });
});

describe('textInput', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-TEXTINPUT-001
  it('利用者が入力する文字列は、制御文字と孤立した surrogate を custom で拒み、改行・復帰・タブと対の surrogate は通す', () => {
    for (const [char] of FORBIDDEN) expect(textInput().safeParse('a' + char + 'b').error?.issues[0]?.code, JSON.stringify(char)).toBe('custom');
    for (const [char] of ALLOWED) expect(textInput().safeParse('a' + char + 'b').success, JSON.stringify(char)).toBe(true);
  });

  it.each(FORBIDDEN)('%j(%s)を含む値は custom(control_character)で拒む', (char) => {
    const parsed = textInput().safeParse('a' + char + 'b');
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toMatchObject([{ code: 'custom', message: CONTROL_CHARACTER_MESSAGE }]);
  });

  it.each(ALLOWED)('%j(%s)を含む値は通り、値は変わらない', (char) => {
    const parsed = textInput().safeParse('a' + char + 'b');
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe('a' + char + 'b');
  });

  it('文字列でない値は従来どおり invalid_type', () => {
    expect(textInput().safeParse(1).error?.issues[0]?.code).toBe('invalid_type');
    expect(textInput().safeParse(null).error?.issues[0]?.code).toBe('invalid_type');
  });

  it('制約の鎖(trim・min・max・regex・optional)を続けられ、それぞれ従来どおり効く', () => {
    const schema = textInput().trim().min(1).max(5).regex(/^[a-z ]+$/);
    expect(schema.safeParse('  ab ').data).toBe('ab');
    expect(schema.safeParse('   ').success).toBe(false);
    expect(schema.safeParse('abcdef').success).toBe(false);
    expect(schema.safeParse('A').success).toBe(false);
    expect(textInput().optional().safeParse(undefined).success).toBe(true);
    // 制御文字は、trim が落とす位置(VT は空白として trim される)でも拒む(trim の前の生の値を見る)。
    expect(textInput().trim().safeParse('\u000b a').success).toBe(false);
  });
});
