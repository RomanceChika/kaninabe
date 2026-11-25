/**
 * 仕様ファイル(Markdown)の先頭にある YAML フロントマターを、安全に取り出す口(io 層)。
 *
 * **仕様の束は信頼できない入力である**(公開された仕様の木を取り込んで `verify` / `generate` を回す人がいる)。
 * 以前の読み込みは gray-matter を既定の設定で呼んでいたため、先頭が `---js` のファイルでは
 * フロントマターが JavaScript として評価された(読むだけでコードが動く)。ここはそれをやめて、
 * 区切りを自前で切り、YAML を **コア・スキーマだけ**(タグ・マージキー・日時の暗黙変換なし)で読む。
 *
 * 守るもの:
 *   1. 開きの行は `---` だけ。言語の指定(`---js` / `--- yaml` / `---coffee` …)は評価も解釈もせず拒む
 *   2. フロントマターの大きさに上限を置く(巨大な入力で止まらない)
 *   3. YAML の別名(`*a`)は参照で共有される。展開すると爆発する形(billion laughs)を、
 *      値を辿った回数の予算で止める
 *   4. `__proto__` / `constructor` / `prototype` のキーは、どの深さでも拒む(プロトタイプ汚染の口を作らない)
 *
 * 拒んだときは例外を投げず、`rejected` を返す。**呼び手はそのファイルを「読めない」として扱う**
 * (空のフロントマターとして先へ進めない)。io 層なので何も import しない(js-yaml の外部パッケージを除く)。
 */

import { CORE_SCHEMA, load } from 'js-yaml';

/** フロントマターの大きさの上限(UTF-16 の文字数)。実際の仕様は数 KB なので、桁違いの余裕を持たせてある。 */
export const FRONT_MATTER_MAX_CHARS = 1_048_576;

/**
 * 値を辿ってよい回数の上限。**別名を展開した数**で数える(共有された値は参照のたびに数える)ので、
 * 正常な仕様(別名を使わない)は文字数の半分を超えず、別名の爆発は一瞬でこの上限に当たる。
 */
export const FRONT_MATTER_MAX_VISITS = 1_000_000;

/** 拒む理由の種類。 */
export type FrontMatterRejectionCode =
  | 'language-tag'
  | 'too-large'
  | 'yaml-error'
  | 'not-mapping'
  | 'alias-expansion'
  | 'forbidden-key';

/** フロントマターの読み取り結果。 */
export type FrontMatterResult =
  | {
      /** 先頭に `---` の開きが無い(フロントマター無し)。 */
      readonly kind: 'none';
    }
  | {
      readonly kind: 'ok';
      /** YAML のマッピング。区切りの中が空なら空のオブジェクト。 */
      readonly data: Record<string, unknown>;
      /** 閉じの `---` の行があったか。無ければ末尾までをフロントマターとして読んだ。 */
      readonly closed: boolean;
    }
  | {
      readonly kind: 'rejected';
      readonly code: FrontMatterRejectionCode;
      /** 何が起きたか(Finding の message に続けて出す短い説明。1 行)。 */
      readonly message: string;
      /** どう直すか。 */
      readonly suggestion: string;
    };

/** 開きと閉じの行。`---` のあとに空白だけが続く形。 */
const DELIMITER_LINE = /^---[ \t]*$/;

/** 禁じるキー。 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function reject(
  code: FrontMatterRejectionCode,
  message: string,
  suggestion: string,
): FrontMatterResult {
  return { kind: 'rejected', code, message, suggestion };
}

/** 行の末尾の `\r` を除く。 */
function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** 辿る順の途中で見つけた違反。 */
type WalkProblem = 'budget' | { readonly forbiddenKey: string } | null;

/**
 * 値を深さ優先で辿り、別名の展開の爆発と禁じるキーを探す(再帰しない。深さの上限は YAML の読み側が持つ)。
 *
 * @param root 読み取った値
 * @returns 違反。無ければ null
 */
function inspectValue(root: unknown): WalkProblem {
  const stack: unknown[] = [root];
  let visits = 0;
  while (stack.length > 0) {
    const value = stack.pop();
    visits += 1;
    if (visits > FRONT_MATTER_MAX_VISITS) return 'budget';
    if (value === null || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (const item of value as unknown[]) stack.push(item);
      continue;
    }
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) return { forbiddenKey: key };
      stack.push((value as Record<string, unknown>)[key]);
    }
  }
  return null;
}

/** YAML の読み取りエラーの 1 行目(js-yaml は 2 行目以降に該当箇所の引用を足す)。 */
function firstLine(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text.split('\n')[0] ?? '原因不明';
}

/** YAML の本文を読み、違反が無いかを見る。 */
function parseYamlBody(yamlText: string, closed: boolean): FrontMatterResult {
  if (yamlText.length > FRONT_MATTER_MAX_CHARS) {
    return reject(
      'too-large',
      `YAML フロントマターが大きすぎます(上限 ${FRONT_MATTER_MAX_CHARS} 文字)`,
      'フロントマターには宣言だけを書き、長い文章は本文へ移す。仕様ファイルでないものを読んでいないかも確かめる',
    );
  }
  let parsed: unknown;
  try {
    parsed = load(yamlText, { schema: CORE_SCHEMA });
  } catch (cause) {
    return reject(
      'yaml-error',
      `YAML フロントマターを解析できません: ${firstLine(cause)}`,
      'YAML の字下げ・引用符・コロンの後ろの空白を見直す。タグ(`!!…`)は使えない。テンプレート(template.{doc_type}.md)をコピーして書き直すのが早い',
    );
  }
  if (parsed === null || parsed === undefined) return { kind: 'ok', data: {}, closed };
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return reject(
      'not-mapping',
      'YAML フロントマターがマッピング(キー: 値の並び)ではありません',
      'フロントマターは doc_type から始まる「キー: 値」の並びで書く',
    );
  }
  const problem = inspectValue(parsed);
  if (problem === 'budget') {
    return reject(
      'alias-expansion',
      `YAML の別名(*名前)を展開すると値が ${FRONT_MATTER_MAX_VISITS} 個を超えます`,
      '別名の入れ子で値が爆発的に増える形は読めない。別名を使わず、値を直接書く',
    );
  }
  if (problem !== null) {
    return reject(
      'forbidden-key',
      `YAML フロントマターに使えないキー \`${problem.forbiddenKey}\` があります`,
      '`__proto__` / `constructor` / `prototype` はキーに使えない(プロトタイプ汚染の口になる)。別の名前にする',
    );
  }
  return { kind: 'ok', data: parsed as Record<string, unknown>, closed };
}

/**
 * Markdown の先頭の YAML フロントマターを読む。
 *
 * 開きは先頭の行が `---`(後ろは空白だけ)。閉じは次の `---` の行で、無ければ末尾までを読む
 * (`closed: false`。閉じ忘れの指摘は呼び手の仕事)。`----` のように `-` が続く行・`---` で始まらない
 * ファイルはフロントマター無し(`none`)。
 *
 * @param source ファイルの中身
 * @returns 読み取り結果。**例外は投げない**
 */
export function readFrontMatter(source: string): FrontMatterResult {
  const text = source.startsWith('﻿') ? source.slice(1) : source;
  const firstNewline = text.indexOf('\n');
  const firstLineText = stripCarriageReturn(firstNewline === -1 ? text : text.slice(0, firstNewline));
  if (!firstLineText.startsWith('---')) return { kind: 'none' };
  if (firstLineText.startsWith('----')) return { kind: 'none' };
  if (!DELIMITER_LINE.test(firstLineText)) {
    return reject(
      'language-tag',
      `YAML フロントマターの開きの行に言語の指定があります(\`${firstLineText.trim().slice(0, 40)}\`)`,
      '開きの行は `---` だけにする。`---js` のような言語の指定は評価も解釈もしない',
    );
  }
  if (firstNewline === -1) return { kind: 'ok', data: {}, closed: false };
  const lines = text.slice(firstNewline + 1).split('\n');
  const closeAt = lines.findIndex((line) => DELIMITER_LINE.test(stripCarriageReturn(line)));
  const closed = closeAt !== -1;
  const bodyLines = closed ? lines.slice(0, closeAt) : lines;
  return parseYamlBody(bodyLines.join('\n'), closed);
}
