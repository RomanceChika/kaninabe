/**
 * レイアウト部品の**プラットフォーム操作の宣言**(`op:` / `ops:` / `row_actions:`)の読み取り(ADR-0019)。
 *
 * `- session_table: { kind: platform_read, op: session.list_mine, shows: [created_at], row_actions: [session.end_mine] }` /
 * `- end_others_bar: { kind: platform_actions, ops: [session.end_others] }` のように、部品のマッピングの中に書く。
 * `kind` / `action` / `reads` / `shows` / `edit` / `actions`(parse-layout-form.ts / parse-layout-ops.ts)と同じく部品の属性であって
 * スロットではないため、parse-layout の collectSlots に渡す前に抜く。
 *
 * ここが担うのは**形として読めるか**(`op` は文字列 1 つ・`ops` / `row_actions` は空でない文字列の一覧)だけである。
 * 操作が auth_spec にあるか・`read` / `do` の別・画面の `platform_ops` に居るか・確認の器は S20 が見る。
 */

import { asArray, type SpecReporter } from '../parse-common.js';
import type { ScreenRef } from './types.js';

/** 表にする読みの操作のキー。 */
export const OP_KEY = 'op';

/** ボタンにする操作の一覧のキー(`kind: platform_actions`)。 */
export const OPS_KEY = 'ops';

/** 行ごとのボタンにする操作の一覧のキー。 */
export const ROW_ACTIONS_KEY = 'row_actions';

/** `op` の書き方の案内。 */
export const OP_SUGGESTION =
  'op は表にするプラットフォーム操作(auth_spec の platform_ops の kind: read)の id を 1 つ書く(例: op: session.list_mine)。' +
  '画面の platform_ops に居る操作である';

/** `ops` の書き方の案内。 */
export const OPS_SUGGESTION =
  'ops はボタンにするプラットフォーム操作(auth_spec の platform_ops の kind: do)の id の一覧で書く(例: ops: [session.end_others])。' +
  '画面の platform_ops(overlays[].platform_ops を含む)に居る操作である';

/** `row_actions` の書き方の案内。 */
export const ROW_ACTIONS_SUGGESTION =
  'row_actions は行ごとのボタンにするプラットフォーム操作(kind: do)の id の一覧で書く(例: row_actions: [session.end_mine])。' +
  '引数の from: row の出どころは、この部品が表にする読みの行である';

/**
 * `op` の値を読む(文字列 1 つ。一覧は書けない — 1 部品 1 読み)。
 *
 * @param record 部品のマッピング(キーの有無を見る)
 * @param pointer 違反位置に使う YAML パス
 * @param reporter 違反の記録先
 * @returns 読めた参照(キーが無い・読めなければ undefined)
 */
export function readPlatformOp(record: Readonly<Record<string, unknown>>, pointer: string, reporter: SpecReporter): ScreenRef | undefined {
  if (!(OP_KEY in record)) return undefined;
  const at = `${pointer}.${OP_KEY}`;
  const raw = record[OP_KEY];
  if (typeof raw !== 'string' || raw.trim() === '') {
    reporter.error(at, `${at} がプラットフォーム操作の id として読めません`, OP_SUGGESTION, { value: String(raw) });
    return undefined;
  }
  return { id: raw, location: reporter.location(at) };
}

/**
 * 操作の id の一覧(`ops` / `row_actions`)を読む(文字列 1 つか文字列の一覧。空の一覧・文字列でない要素は S0)。
 *
 * @param key `ops` か `row_actions`
 * @param record 部品のマッピング(キーの有無を見る)
 * @param pointer 違反位置に使う YAML パス
 * @param reporter 違反の記録先
 * @returns 読めた参照(キーが無い・読めなければ undefined)
 */
export function readPlatformOpList(
  key: typeof OPS_KEY | typeof ROW_ACTIONS_KEY,
  record: Readonly<Record<string, unknown>>,
  pointer: string,
  reporter: SpecReporter,
): readonly ScreenRef[] | undefined {
  if (!(key in record)) return undefined;
  const at = `${pointer}.${key}`;
  const raw = record[key];
  const list = typeof raw === 'string' ? [raw] : asArray(raw);
  const ids = list === null ? null : list.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  if (list === null || ids === null || ids.length !== list.length || ids.length === 0) {
    reporter.error(at, `${at} がプラットフォーム操作の id の一覧として読めません`, key === OPS_KEY ? OPS_SUGGESTION : ROW_ACTIONS_SUGGESTION, { value: String(raw) });
    return undefined;
  }
  return ids.map((id, index) => ({ id, location: reporter.location(typeof raw === 'string' ? at : `${at}[${index}]`) }));
}
