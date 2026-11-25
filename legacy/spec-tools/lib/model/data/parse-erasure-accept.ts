/**
 * data_table の `erasure_accept`(参照を辿って本人に届く個人列を、消去の連鎖に入れないことの理由つきの受け入れ)の読み取り。
 *
 * 形は閉じている: 参照の列(`via`)・受け入れる個人列(`columns`)・理由(`reason`)の 3 つを名指す。列を足した日に受け入れが広がらないよう、表の単位では書けない。
 * 同じ置き場に、持ち主が宛先の個人列の表(`erasure_addressee`)・内部テーブルの個人列(`personal_columns`)・関数の `scrub_via` の読み取りがある。
 * 実在と腐りは T24 が見る(ここは 1 ファイルの中で閉じる形だけ)。
 */

import type { SpecReporter } from '../parse-common.js';
import { identifierField } from '../sql-fields.js';
import { eachRecord, type YamlReader } from '../yaml-reader.js';
import type { DataErasureAccept, DataErasureAddressee } from './types.js';

/** 書き方。 */
const SUGGESTION = 'erasure_accept は "- via: {本人へ届く、この表の参照の列} / columns: [{個人列}] / reason: {連鎖に入れない理由}" のリストで書く';

/**
 * `erasure_accept` を読む。
 *
 * @param root フロントマターの読み手
 * @param reporter 違反の記録先
 * @returns 受け入れの並び(無ければ空)
 */
export function parseErasureAccepts(root: YamlReader, reporter: SpecReporter): readonly DataErasureAccept[] {
  const items = root.optionalList('erasure_accept', SUGGESTION);
  const accepts: DataErasureAccept[] = [];
  eachRecord(items, 'erasure_accept', reporter, 'via / columns / reason を持つ要素として書く', (reader) => {
    reader.rejectUnknownKeys(['via', 'columns', 'reason'], 'erasure_accept の要素', '書けるのは via / columns / reason だけ。綴り違いなら直す');
    const via = identifierField(reader, reporter, 'via', reader.requiredString('via', 'via に本人への参照の列を書く'));
    const columns = reader.requiredStringList('columns', 'columns に受け入れる個人列を全部名指す(表の単位では受け入れない)');
    const reason = reader.requiredString('reason', 'reason に消去の連鎖に入れない理由を書く(空は通らない)');
    if (via === null || columns === null || reason === null) return;
    if (columns.length === 0 || reason.trim() === '') {
      reporter.error(reader.pointer('columns'), `erasure_accept(via: ${via})の columns か reason が空です`, SUGGESTION, { via });
      return;
    }
    accepts.push({ via, columns, reason });
  });
  reporter.settleRows(items.length, accepts.length);
  return accepts;
}

/**
 * 消去の受け入れの 3 つの宣言(`erasure_accept` / `erasure_addressee` / `personal_columns`)を、DataTableSpec の欄の形で読む
 * (書いていない欄は省く。読む順は宣言の順で、違反の並びもこの順になる)。
 *
 * @param root フロントマターの読み手
 * @param reporter 違反の記録先
 * @param internal 内部テーブルか
 * @returns 欄の部分
 */
export function erasureFields(
  root: YamlReader,
  reporter: SpecReporter,
  internal: boolean,
): { readonly erasureAccepts?: readonly DataErasureAccept[]; readonly erasureAddressees?: readonly DataErasureAddressee[]; readonly personalColumns?: readonly string[] } {
  const erasureAccepts = parseErasureAccepts(root, reporter);
  const erasureAddressees = parseErasureAddressees(root, reporter);
  const personalColumns = parsePersonalColumns(root, reporter, internal);
  return {
    ...(erasureAccepts.length === 0 ? {} : { erasureAccepts }),
    ...(erasureAddressees.length === 0 ? {} : { erasureAddressees }),
    ...(personalColumns === undefined ? {} : { personalColumns }),
  };
}

/**
 * `erasure_addressee` を読む。
 *
 * @param root フロントマターの読み手
 * @param reporter 違反の記録先
 * @returns 表の並び(無ければ空)
 */
export function parseErasureAddressees(root: YamlReader, reporter: SpecReporter): readonly DataErasureAddressee[] {
  const hint = 'erasure_addressee は "- column: {個人列} / via: {本人の表}.{参照の列} / reason: {持ち主が宛先である理由}" のリストで書く';
  const items = root.optionalList('erasure_addressee', hint);
  const rows: DataErasureAddressee[] = [];
  eachRecord(items, 'erasure_addressee', reporter, 'column / via / reason を持つ要素として書く', (reader) => {
    reader.rejectUnknownKeys(['column', 'via', 'reason'], 'erasure_addressee の要素', '書けるのは column / via / reason だけ。綴り違いなら直す');
    const column = identifierField(reader, reporter, 'column', reader.requiredString('column', 'column に個人列を書く'));
    const via = reader.requiredString('via', 'via に本人の行の参照を {表}.{列} で書く');
    const reason = reader.requiredString('reason', 'reason に持ち主が宛先である理由を書く(空は通らない)');
    if (column === null || via === null || reason === null) return;
    if (reason.trim() === '' || !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(via)) {
      reporter.error(reader.pointer('via'), `erasure_addressee(column: ${column})の via か reason が不正です`, hint, { column, via });
      return;
    }
    rows.push({ column, via, reason });
  });
  reporter.settleRows(items.length, rows.length);
  return rows;
}

/**
 * `personal_columns` を読む(`internal: true` の表だけが書ける。書いていなければ undefined)。
 *
 * @param root フロントマターの読み手
 * @param reporter 違反の記録先
 * @param internal 内部テーブルか
 * @returns 個人列の並び
 */
export function parsePersonalColumns(root: YamlReader, reporter: SpecReporter, internal: boolean): readonly string[] | undefined {
  if (!root.has('personal_columns')) return undefined;
  if (!internal) {
    reporter.error(root.pointer('personal_columns'), 'personal_columns は internal: true の表だけが宣言できます', 'entity_spec を持つ表の個人列は entity_spec の personal: true に書く', {});
    return undefined;
  }
  return root.requiredStringList('personal_columns', 'personal_columns に個人列を並べる(無ければ [])') ?? undefined;
}

/**
 * 関数の `scrub_via` を読む。
 *
 * @param reader 関数の読み手
 * @param name 関数名
 * @param reporter 違反の記録先
 * @returns 表 → 参照の列(書いていなければ undefined)
 */
export function parseEraseVia(reader: YamlReader, name: string, reporter: SpecReporter): Readonly<Record<string, readonly string[]>> | undefined {
  if (!reader.has('scrub_via')) return undefined;
  const raw = reader.raw('scrub_via');
  const hint = 'scrub_via は "{表}: [{本人へ届く参照の列}…]" の写像で書く';
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    reporter.error(reader.pointer('scrub_via'), `${name} の scrub_via の形が不正です`, hint, { function: name });
    return undefined;
  }
  const result: Record<string, readonly string[]> = {};
  for (const [table, columns] of Object.entries(raw)) {
    if (!Array.isArray(columns) || columns.length === 0 || !columns.every((column) => typeof column === 'string')) {
      reporter.error(reader.pointer('scrub_via'), `${name} の scrub_via の ${table} に参照の列がありません`, hint, { function: name, table });
      continue;
    }
    result[table] = columns as readonly string[];
  }
  return result;
}
