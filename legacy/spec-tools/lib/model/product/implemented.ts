/**
 * 製品が宣言する**実装の範囲**(`product.md` の `implemented`)の読み取り。
 *
 * 書けるのは仕様の id の文字列のリストだけ(種類も wildcard も無い。wildcard は新しい仕様を自動で範囲に入れてしまい、
 * 宣言した範囲の意味を失わせる)。**キーが無い = 全部が範囲**・`[]` = 何も範囲に入れない、の 2 つは別の宣言である。
 * 値が壊れていれば P0 を積み、範囲は「全部」として扱う(`declared: false`)—— 壊れた宣言が「何も入れない」や
 * 「一部だけ」に化けて、検査を黙って外さないため。
 */

import type { SpecReporter } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';

/** 製品が宣言した実装の範囲。`declared: false` は宣言なし(全部が範囲)。 */
export type ProductImplemented = { readonly declared: false } | { readonly declared: true; readonly ids: readonly string[] };

/** 宣言なし(全部が範囲)。 */
export const IMPLEMENTED_UNDECLARED: ProductImplemented = { declared: false };

/** `implemented` の書き方の定型文。 */
const IMPLEMENTED_HOW =
  '実装の範囲に入れる仕様の id を列挙する(種類も wildcard も無い。何も入れないなら `implemented: []`。キーを書かなければ全部が範囲)';

/** id に書けない文字(空白・制御文字。全角の空白と改行なしの空白を含む)。 */
const FORBIDDEN_CHARACTER = /[\s\p{Cc}]/u;

/**
 * 宣言のフロントマターから実装の範囲を組み立てる。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先
 * @returns 範囲。キーが無い・値が壊れていれば `declared: false`
 */
export function parseProductImplemented(data: Readonly<Record<string, unknown>>, reporter: SpecReporter): ProductImplemented {
  if (!Object.hasOwn(data, 'implemented')) return IMPLEMENTED_UNDECLARED;
  const reader = new YamlReader(data, '', reporter);
  const listed = reader.requiredList('implemented', IMPLEMENTED_HOW);
  if (listed === null) return IMPLEMENTED_UNDECLARED;

  const ids: string[] = [];
  let valid = true;
  listed.forEach((value, index) => {
    const pointer = `implemented[${index}]`;
    if (typeof value !== 'string') {
      reporter.error(pointer, `${pointer} は文字列で書きます`, IMPLEMENTED_HOW, { value: String(value) });
      valid = false;
    } else if (value === '' || FORBIDDEN_CHARACTER.test(value)) {
      reporter.error(pointer, `${pointer} は空・空白・制御文字を含まない id で書きます`, IMPLEMENTED_HOW, { value });
      valid = false;
    } else if (ids.includes(value)) {
      reporter.error(pointer, `${pointer} の ${value} が重複しています`, '同じ id は 1 回だけ書く', { value });
      valid = false;
    } else {
      ids.push(value);
    }
  });
  return valid ? { declared: true, ids } : IMPLEMENTED_UNDECLARED;
}
