/**
 * 導出の幅(`triggers[].derives` の `offset`)の字面の読み取り。
 *
 * `{±n} {minute|hour|day}` の**閉じた語**だけを読む(符号の省略は加算・単位は複数形でもよい)。
 * 生成する側(`ddl-derive-triggers.ts`)と、通るかを見る側(`derive-problems.ts`)が同じ 1 本を呼ぶ。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DeriveUnit } from '../model/data/types.js';
import { DERIVE_UNITS } from '../model/data/types.js';

/** `{±n} {unit}`(符号は省略できる = 加算。単位は複数形でもよい)。 */
const OFFSET_PATTERN = new RegExp(`^([+-]?)(\\d{1,6})\\s+(${DERIVE_UNITS.join('|')})s?$`);

/** 読めた幅。 */
export interface DeriveOffset {
  /** 元の列から引くか足すか。 */
  readonly sign: '+' | '-';
  /** 幅の数(0 以上の整数)。 */
  readonly amount: number;
  /** 幅の単位。 */
  readonly unit: DeriveUnit;
}

/**
 * 幅の字面を読む。
 *
 * @param raw `offset` の字面(例: `-14 days`)
 * @returns 読めた幅。閉じた語(`{±n} {minute|hour|day}`)に合わなければ null
 */
export function parseDeriveOffset(raw: string): DeriveOffset | null {
  const matched = OFFSET_PATTERN.exec(raw.trim());
  if (matched === null) return null;
  const unit = DERIVE_UNITS.find((candidate) => candidate === matched[3]);
  if (unit === undefined) return null;
  return { sign: matched[1] === '-' ? '-' : '+', amount: Number(matched[2]), unit };
}

/**
 * 幅を SQL の interval の字面にする。
 *
 * @param offset 読めた幅
 * @returns `14 days` / `1 day`(1 だけ単数形。符号は含まない)
 */
export function deriveIntervalText(offset: DeriveOffset): string {
  return `${offset.amount} ${offset.unit}${offset.amount === 1 ? '' : 's'}`;
}
