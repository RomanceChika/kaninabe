/**
 * 読み取った素のデータから、欲しい形だけを**黙らずに**取り出す小道具。
 *
 * 生成物の形が想定と違えば `undefined` / 空配列が返る —— 呼び出し側はそれを「差分なし」ではなく
 * 「判定できない」として扱えるよう、鍵の有無を自分で見る。型の主張(キャスト)はしない。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { PlainObject, PlainValue } from './ts-literal.js';

/** 配列なら返す。 */
export function asArray(value: PlainValue | undefined): readonly PlainValue[] {
  return isArray(value) ? value : [];
}

/** 読み取った値が配列か(`Array.isArray` は readonly の並びを絞り込まない)。 */
function isArray(value: PlainValue | undefined): value is readonly PlainValue[] {
  return Array.isArray(value);
}

/** オブジェクトなら返す(配列・null は違う)。 */
export function asObject(value: PlainValue | undefined): PlainObject | undefined {
  if (value === null || value === undefined || typeof value !== 'object' || isArray(value)) return undefined;
  return value;
}

/** 文字列なら返す。 */
export function asString(value: PlainValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** 文字列の並びだけを取り出す(それ以外の要素は落とす)。 */
export function asStrings(value: PlainValue | undefined): readonly string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

/** 数なら返す。 */
export function asNumber(value: PlainValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** オブジェクトの欄を引く(オブジェクトでなければ undefined)。 */
export function field(value: PlainValue | undefined, key: string): PlainValue | undefined {
  return asObject(value)?.[key];
}

/**
 * 表示に使う 1 行の文字列にする(並び・オブジェクトはそのまま畳む)。
 *
 * 比較の値にも使うので、**同じ中身なら必ず同じ文字列**になることが要る。
 *
 * @param value 素のデータ
 * @returns 畳んだ文字列
 */
export function flatten(value: PlainValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flatten).join(' / ');
  const object = asObject(value);
  if (object === undefined) return '';
  return Object.keys(object)
    .sort()
    .map((key) => `${key}=${flatten(object[key])}`)
    .join(' ');
}
