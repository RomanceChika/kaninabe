/**
 * 欄の `format`(書式の宣言)の読み取り。
 *
 * 形だけを見る: 値が語彙(`FIELD_FORMATS`)にあること・書式ごとの型であること(`url` = `string`・`markdown` = `text`)・
 * `pattern` と併記しないこと・`max_length` が書式ごとの天井以下であること(`url` = 2048・`markdown` = 8,000)。
 * `max_length` を書き忘れた欄は R10 が止める(ここでは重ねない)。
 * 純関数であり、違反は `reporter` に記録して `undefined` を返す。
 */

import { FIELD_FORMATS, MARKDOWN_MAX_LENGTH, URL_MAX_LENGTH, type FieldFormat } from '../kernel/url-format.js';
import type { FieldType } from './types-entity.js';
import type { SpecReporter } from './parse-common.js';
import type { YamlReader } from './yaml-reader.js';

/** `format` の書き方の案内。 */
const FORMAT_SUGGESTION = `format は欄の書式を書く(使える値: ${FIELD_FORMATS.join(' / ')})。例: format: url(string。絶対 URL の http / https だけ)・format: markdown(text。書式つきの本文)`;

/** 書式ごとの規則(書式が付く型・`max_length` の天井・型の案内)。 */
const FORMAT_RULES: Readonly<
  Record<FieldFormat, { readonly kind: FieldType['kind']; readonly ceiling: number; readonly typeHint: string; readonly patternHint: string }>
> = {
  url: {
    kind: 'string',
    ceiling: URL_MAX_LENGTH,
    typeHint: 'URL を持つ欄は type: string にする(複数行の text に URL の書式は課せない)',
    patternHint: 'pattern を消す。URL の文法は format: url が持ち、入力スキーマ・CHECK・world の値が同じ宣言から出る',
  },
  markdown: {
    kind: 'text',
    ceiling: MARKDOWN_MAX_LENGTH,
    typeHint: '書式つきの本文は type: text にする(1 行の string に本文の書式は課さない)',
    patternHint: 'pattern を消す(Markdown は任意の文字列が妥当で、書式は描画の側の許可リストが守る)',
  },
};

/**
 * 欄の `format` を読む。
 *
 * @param reader 欄の読み取り口
 * @param reporter 違反の記録先
 * @param type 欄の型
 * @param pattern 同じ欄の `pattern`(併記の検査)
 * @param maxLength 同じ欄の `max_length`(書式ごとの天井の検査)
 * @returns 宣言があり正しければ書式。無い・正しくないなら undefined
 */
export function readFormat(
  reader: YamlReader,
  reporter: SpecReporter,
  type: FieldType,
  pattern: string | undefined,
  maxLength: number | undefined,
): FieldFormat | undefined {
  const raw = reader.optionalString('format', FORMAT_SUGGESTION);
  if (raw === undefined) return undefined;
  const found = FIELD_FORMATS.find((value) => value === raw);
  const pointer = reader.pointer('format');
  if (found === undefined) {
    reporter.error(pointer, `format "${raw}" は使えません`, FORMAT_SUGGESTION, { format: raw });
    return undefined;
  }
  const rule = FORMAT_RULES[found];
  if (type.kind !== rule.kind) {
    reporter.error(
      pointer,
      `format: ${found} は ${rule.kind} の欄にだけ書けます(この欄は ${type.kind} です)`,
      rule.typeHint,
      { format: found, type: type.kind },
    );
    return undefined;
  }
  if (pattern !== undefined) {
    reporter.error(pointer, `format: ${found} と pattern は併記できません(どちらが正か読めません)`, rule.patternHint, { format: found });
    return undefined;
  }
  if (maxLength !== undefined && maxLength > rule.ceiling) {
    reporter.error(
      reader.pointer('max_length'),
      `format: ${found} の欄の max_length は ${rule.ceiling} 以下にします(${maxLength} と書かれています)`,
      found === 'url'
        ? `max_length を ${rule.ceiling} 以下にする(ブラウザと中継が扱える URL の長さの天井)`
        : `max_length を ${rule.ceiling} 以下にする(描画が解釈する本文の長さの天井。これを超える本文は解釈せず素の文で出す)`,
      { format: found, max_length: String(maxLength) },
    );
    return undefined;
  }
  return found;
}
