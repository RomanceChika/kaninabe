/**
 * 文字列の欄の値(RLS / 等価性の world が機械的に置く値)。
 *
 * 書式なしの欄は `{欄名}-{連番}` を `max_length` の中に詰める。**書式 url の欄は文法に合う URL を置く** ——
 * `{欄名}-{連番}` は CHECK(`format: url`)に落ちて world が作れなくなる(`pattern` の代用で生成テストが消えた理由と同じ)。
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef } from '../model/types.js';
import { worldUrl } from '../kernel/url-format.js';

/**
 * 文字列の欄の値。
 *
 * @param field 欄の宣言(`name` / `maxLength` / `format` を見る)
 * @param seq world 全体で一意な連番
 * @returns 欄に置く値
 */
export function textValue(field: FieldDef, seq: number): string {
  if (field.format === 'url') return worldUrl(field.name, seq, field.maxLength);
  const value = `${field.name}-${seq}`;
  const limit = field.maxLength;
  return limit === undefined || value.length <= limit ? value : value.slice(value.length - limit);
}
