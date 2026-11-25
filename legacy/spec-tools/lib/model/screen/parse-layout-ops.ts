/**
 * レイアウト部品の**操作の宣言**(`edit:` / `actions:`)の読み取り(ADR-0015 の改訂 2)。
 *
 * `- venue_table: { kind: table, reads: query-venue-list, edit: venue.update, actions: [venue.delete] }` /
 * `- transition_bar: { kind: actions, reads: query-workshop-detail, actions: [workshop.open, workshop.close] }` のように、
 * 部品のマッピングの中に書く。`kind` / `action` / `reads` / `shows`(parse-layout-form.ts)と同じく部品の属性であって
 * スロットではないため、parse-layout の collectSlots に渡す前に抜く。
 *
 * ここが担うのは**形として読めるか**(`edit` は文字列 1 つ・`actions` は空でない文字列の一覧)だけである。操作が画面の
 * `actions` に居るか・接地先の形・確認の器(S19)は検査器が見る。
 */

import { asArray, type SpecReporter } from '../parse-common.js';
import type { ScreenRef } from './types.js';

/** 行をその場で編集する操作のキー。 */
export const EDIT_KEY = 'edit';

/** ボタンにする操作の一覧のキー。 */
export const BUTTONS_KEY = 'actions';

/** `edit` の書き方の案内。 */
export const EDIT_SUGGESTION =
  'edit は行をその場で編集する操作の ID を 1 つ書く(例: edit: venue.update)。' +
  'screen の actions に居る編集(update)の操作で、reads の source のエンティティの編集である';

/** `actions`(部品の属性)の書き方の案内。 */
export const BUTTONS_SUGGESTION =
  'actions は行ごとのボタンにする操作の ID の一覧で書く(例: actions: [venue.delete])。' +
  'screen の actions(overlays[].actions を含む)の要素で、reads の source の状態機械のイベントか削除(delete)である';

/**
 * `edit` の値を読む(文字列 1 つ。一覧は書けない — 1 部品 1 編集操作)。
 *
 * @param raw 値
 * @param record 部品のマッピング(キーの有無を見る)
 * @param pointer 違反位置に使う YAML パス
 * @param reporter 違反の記録先
 * @returns 読めた参照(キーが無い・読めなければ undefined)
 */
export function readEdit(
  raw: unknown,
  record: Readonly<Record<string, unknown>>,
  pointer: string,
  reporter: SpecReporter,
): ScreenRef | undefined {
  if (!(EDIT_KEY in record)) return undefined;
  const at = `${pointer}.${EDIT_KEY}`;
  if (typeof raw !== 'string' || raw.trim() === '') {
    reporter.error(at, `${at} が操作 ID として読めません`, EDIT_SUGGESTION, { value: String(raw) });
    return undefined;
  }
  return { id: raw, location: reporter.location(at) };
}

/**
 * `actions`(部品の属性)の値を読む(文字列 1 つか文字列の一覧。空の一覧・文字列でない要素は S0)。
 *
 * @param raw 値
 * @param record 部品のマッピング(キーの有無を見る)
 * @param pointer 違反位置に使う YAML パス
 * @param reporter 違反の記録先
 * @returns 読めた参照(キーが無い・読めなければ undefined)
 */
export function readButtons(
  raw: unknown,
  record: Readonly<Record<string, unknown>>,
  pointer: string,
  reporter: SpecReporter,
): readonly ScreenRef[] | undefined {
  if (!(BUTTONS_KEY in record)) return undefined;
  const at = `${pointer}.${BUTTONS_KEY}`;
  const list = typeof raw === 'string' ? [raw] : asArray(raw);
  const ids = list === null ? null : list.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  if (list === null || ids === null || ids.length !== list.length || ids.length === 0) {
    reporter.error(at, `${at} が操作 ID の一覧として読めません`, BUTTONS_SUGGESTION, { value: String(raw) });
    return undefined;
  }
  return ids.map((id, index) => ({
    id,
    location: reporter.location(typeof raw === 'string' ? at : `${at}[${index}]`),
  }));
}
