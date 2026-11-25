/**
 * テストが仕様ファイルのフロントマターを読み書きする小道具。
 *
 * 一時のツリーに仕様の写しを置いて壊す形のテストが、読み取りは本体と同じ `readFrontMatter`、
 * 書き出しは YAML を `---` で挟む形で使う(外部のフロントマター処理を足さない)。
 */

import { dump } from 'js-yaml';
import { readFrontMatter } from '../../lib/io/front-matter.js';

/** 閉じの `---` の行までを取り除いた本文。フロントマターが無ければ全体。 */
function bodyAfterFrontMatter(source: string): string {
  const withoutBom = source.replace(/^﻿/, '');
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(withoutBom);
  return match === null ? withoutBom : withoutBom.slice(match[0].length);
}

/**
 * 仕様ファイルのフロントマターと本文を取り出す。読めなければテストの前提が壊れているので例外にする。
 *
 * @param source ファイルの中身
 * @returns フロントマター(マッピング)と本文
 */
export function readMatter(source: string): { data: Record<string, unknown>; content: string } {
  const result = readFrontMatter(source);
  if (result.kind !== 'ok') {
    throw new Error(`フロントマターを読めません: ${result.kind === 'rejected' ? result.message : 'フロントマターがありません'}`);
  }
  return { data: result.data, content: bodyAfterFrontMatter(source) };
}

/**
 * フロントマターと本文からファイルの中身を組み立てる。
 *
 * @param content 本文
 * @param data フロントマター
 * @returns `---` で挟んだ YAML + 本文
 */
export function stringifyMatter(content: string, data: Record<string, unknown>): string {
  return `---\n${dump(data)}---\n${content.startsWith('\n') ? content : `\n${content}`}`;
}
