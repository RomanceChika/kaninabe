/**
 * 仕様の frontmatter から、人が書く文(`summary:`)を集める。
 *
 * `summary` は仕様に書く人の言葉の欄で、場所は 3 つ(`entity_spec` のトップ・`state_spec` の機械ごと・
 * 状態ごと。書き方は domain-spec-writing.md §summary)。ここは場所を決め打たず、**frontmatter の木の中の
 * `summary` という鍵の文字列を全部**拾う —— 場所が増えても集め直す必要が無く、鍵の綴りだけが約束である。
 * 文字列でない値・空の値は拾わない(型の問題は仕様のパーサーが言う)。壊れた frontmatter は読み飛ばす
 * (壊れていることは仕様の検査が言うので、ここで二重に言わない)。
 */

import { readFrontMatter } from '../io/front-matter.js';
import type { HumanSentence } from '../model/terms/types.js';

/** 人が書く文の鍵。 */
const SUMMARY_KEY = 'summary';

/** 値の木を歩いて、`summary` の文字列を位置つきで集める。 */
function walk(value: unknown, pointer: string, found: Array<{ pointer: string; text: string }>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${pointer}[${index}]`, found));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = pointer === '' ? key : `${pointer}.${key}`;
    if (key === SUMMARY_KEY && typeof child === 'string' && child.trim().length > 0) {
      found.push({ pointer: next, text: child.trim() });
    } else {
      walk(child, next, found);
    }
  }
}

/** 値の木を歩いて、`summary` 以外の文字列の値を集める。 */
function walkText(value: unknown, found: string[]): void {
  if (typeof value === 'string') {
    found.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkText(item, found);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key !== SUMMARY_KEY) walkText(child, found);
  }
}

/**
 * 仕様ファイル 1 枚の frontmatter の文字列の値(`summary` を除く)を集める。
 *
 * M10 が「仕様に書かれた語」を引く語彙になる。壊れた frontmatter は読み飛ばす(summary と同じ)。
 *
 * @param source 生テキスト
 * @returns 文字列の値(出現順)
 */
export function collectSpecText(source: string): string[] {
  const result = readFrontMatter(source);
  if (result.kind !== 'ok') return [];
  const found: string[] = [];
  walkText(result.data, found);
  return found;
}

/**
 * 仕様ファイル 1 枚の人が書く文を集める。
 *
 * @param file ファイル(リポジトリルート相対。Finding の場所になる)
 * @param source 生テキスト
 * @returns 人が書く文(出現順)。frontmatter が無い・壊れているときは空
 */
export function collectSummaries(file: string, source: string): HumanSentence[] {
  const result = readFrontMatter(source);
  if (result.kind !== 'ok') return [];
  const found: Array<{ pointer: string; text: string }> = [];
  walk(result.data, '', found);
  return found.map((item) => ({ file, ...item }));
}
