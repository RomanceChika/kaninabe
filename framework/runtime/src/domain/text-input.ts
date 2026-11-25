/**
 * 利用者が入力する文字列の共通の検証(点検 17 回目 O17-3・18 回目 O18-2)。
 *
 * 生成する入力スキーマの文字列の欄は、すべてここの `textInput()` から始まる(生成器が 1 か所で書く。欄ごとに書き足さない)。
 * **許すのは改行・復帰・タブだけ**で、ほかの制御文字(C0・DEL・C1)と、対にならない surrogate は入力の不正にする。
 * NUL は Postgres の `text` が拒むので、通すと 500 になる。
 */

import { z } from 'zod';

/** 拒否の理由の語(zod の issue は `custom`、message はこの語)。 */
export const CONTROL_CHARACTER_MESSAGE = 'control_character';

/**
 * 文字列に、入れられない文字があるか(code point で見る。対になった surrogate は 1 字の補助面として通る)。
 *
 * @param text 調べる文字列
 * @returns C0(\n \r \t を除く)・DEL・C1・孤立した surrogate があれば true
 */
export function hasForbiddenCharacter(text: string): boolean {
  for (const char of text) {
    // 対になった surrogate は 1 字の補助面として来る(長さ 2)。孤立したものは長さ 1 で、下の範囲に入る。
    if (char.length > 1) continue;
    const code = char.charCodeAt(0);
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0xd800 && code <= 0xdfff)) return true;
  }
  return false;
}

/**
 * 利用者が入力する文字列のスキーマの起点(制御文字を拒む `z.string()`)。
 * 返すのは文字列のスキーマそのもので、`.trim()` `.min()` `.max()` `.regex()` はそのまま続けられる。
 *
 * @returns 制御文字と孤立した surrogate を拒む文字列のスキーマ
 */
export function textInput(): z.ZodString {
  return z.string().refine((text) => !hasForbiddenCharacter(text), { message: CONTROL_CHARACTER_MESSAGE });
}
