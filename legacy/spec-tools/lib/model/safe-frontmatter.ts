/**
 * 仕様のフロントマターを読む**唯一の入口**(読み込みの関所)。
 *
 * `parseFrontmatter`(YAML の読み取り)に、**文字の検査**を足したもの: キーと文字列の値に、制御文字(タブ以外)・行の区切り
 * (U+0085 / U+2028 / U+2029)・向きを変える文字(U+202A〜U+202E / U+2066〜U+2069)を持ち込ませない。
 *
 * 仕様の文字列は生成物のコメント(`//` / `--` / `/* … *\/`)・ハンドブックの見出しや表・Mermaid の図に置かれる。**改行 1 つで
 * 「コメントの外」へ出られる**ので、値は 1 行で書く(複数行の YAML 文字列は仕様の形ではない)。向きを変える文字は見た目と中身を
 * 食い違わせる("Trojan Source")。出口の無害化(`lib/kernel/safe-text.ts`)と二重に守る。
 *
 * ローダーはどれもここを通る(`parseFrontmatter` を直接呼ばない。構造テスト `safe-frontmatter.test.ts` が見張る)。
 */

import { parseFrontmatter, type SpecReporter } from './parse-common.js';

/** 値を辿る回数の上限(YAML の別名の展開は読み取り側が先に止める。ここは念のための歯止め)。 */
const MAX_VISITS = 1_000_000;

/**
 * キーと文字列の値に置けない文字。
 * 制御文字(タブ以外)・DEL・C1 制御・行の区切り・向きを変える文字(U+200E / U+200F を含む)・U+2060(単語結合)・U+FEFF(零幅の空白)。
 */
const FORBIDDEN = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u2028\u2029\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;

/** キーの長さの上限(字数)。 */
export const MAX_KEY_LENGTH = 256;

/**
 * 文字列の値の長さの上限(字数)。値は 1 行で書く(複数行の値は仕様の形ではない)。実際の仕様の最長は約 4,000 字(保証台帳の要約)なので、その 4 倍の余裕を見る。
 * 極端に長い 1 行は、生成物の処理(無害化・図・表)の手間を、読み込みの時点で止める。
 */
export const MAX_VALUE_LENGTH = 16_384;

/** 見つけた違反(どこの何番目の文字か)。 */
interface Found {
  readonly pointer: string;
  readonly code: string;
}

/** 違反の文字を `U+000A` の形で名指す(文字そのものを出すと報告の行が壊れる)。 */
function codeOf(text: string): string {
  const match = FORBIDDEN.exec(text);
  const code = match === null ? 0 : (match[0].codePointAt(0) ?? 0);
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * 値を深さ優先で辿り、置けない文字を持つキーと文字列を探す(再帰しない)。
 *
 * @param root 読み取った値
 * @returns 最初の違反。無ければ null
 */
export function forbiddenCharacterIn(root: unknown): Found | null {
  const stack: { readonly value: unknown; readonly pointer: string }[] = [{ value: root, pointer: '' }];
  let visits = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    visits += 1;
    if (visits > MAX_VISITS) return null;
    const { value, pointer } = entry;
    if (typeof value === 'string') {
      if (FORBIDDEN.test(value)) return { pointer, code: codeOf(value) };
      continue;
    }
    if (value === null || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      (value as unknown[]).forEach((item, index) => stack.push({ value: item, pointer: `${pointer}[${index}]` }));
      continue;
    }
    for (const [key, item] of Object.entries(value)) {
      const child = pointer === '' ? key : `${pointer}.${key}`;
      if (FORBIDDEN.test(key)) return { pointer: child.replace(FORBIDDEN, '?'), code: codeOf(key) };
      stack.push({ value: item, pointer: child });
    }
  }
  return null;
}

/**
 * キーと文字列の値の長さの上限を超えるものを探す(再帰しない)。
 *
 * @param root 読み取った値
 * @returns 最初の違反(場所と字数)。無ければ null
 */
export function overlongStringIn(root: unknown): { readonly pointer: string; readonly length: number } | null {
  const stack: { readonly value: unknown; readonly pointer: string }[] = [{ value: root, pointer: '' }];
  let visits = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    visits += 1;
    if (visits > MAX_VISITS) return null;
    const { value, pointer } = entry;
    if (typeof value === 'string') {
      if (value.length > MAX_VALUE_LENGTH) return { pointer, length: value.length };
      continue;
    }
    if (value === null || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      (value as unknown[]).forEach((item, index) => stack.push({ value: item, pointer: `${pointer}[${index}]` }));
      continue;
    }
    for (const [key, item] of Object.entries(value)) {
      const child = pointer === '' ? key.slice(0, 80) : `${pointer}.${key.slice(0, 80)}`;
      if (key.length > MAX_KEY_LENGTH) return { pointer: child, length: key.length };
      stack.push({ value: item, pointer: child });
    }
  }
  return null;
}

/**
 * Markdown の先頭の YAML フロントマターを読み、文字の検査を通ったものだけを返す。
 *
 * @param source ファイルの中身
 * @param reporter 違反の記録先
 * @returns フロントマターのマッピング。取り出せない・置けない文字がある場合は null(**そのファイルは読めないものとして扱う**)
 */
export function parseSafeFrontmatter(source: string, reporter: SpecReporter): Readonly<Record<string, unknown>> | null {
  const data = parseFrontmatter(source, reporter);
  if (data === null) return null;
  const overlong = overlongStringIn(data);
  if (overlong !== null) {
    reporter.error(
      overlong.pointer === '' ? undefined : overlong.pointer,
      `YAML フロントマターの文字列が長すぎます(${overlong.length} 字。キーは ${MAX_KEY_LENGTH} 字・値は ${MAX_VALUE_LENGTH} 字まで)`,
      '値は 1 行の短い文で書く。長い説明は本文に書き、フロントマターには要約を置く。極端に長い 1 行は生成物の処理(無害化・図・表)の手間を増やすので、読み込みの時点で止める',
    );
    return null;
  }
  const found = forbiddenCharacterIn(data);
  if (found === null) return data;
  reporter.error(
    found.pointer === '' ? undefined : found.pointer,
    `YAML フロントマターに置けない文字 ${found.code}(制御文字・行の区切り・向きを変える文字)があります`,
    '値は 1 行で書く。改行・タブ以外の制御文字と U+2028 / U+2029・向きを変える文字は、生成物のコメントを破る / 読み手を欺く口になるので仕様の文字列に置けない',
  );
  return null;
}
