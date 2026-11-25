/**
 * 生成 zod スキーマから、**1 フィールドの扱い**（HTML 属性と未入力の写し方）を導く読み取り。
 *
 * `form.ts`（フォームとスキーマの口）とは別に、**スキーマの読み取りだけ**をここに置く。
 *
 * **ここは口の内側の部品であり、外から呼ぶものではない**（`form-datetime.ts` と同じ扱い。
 * `form.ts` は再輸出しない）。画面が属性を見る口は `formOf(...).fields` の側であって、
 * ここの `planOf` を直に呼ぶ経路ではない。いまの歯止めはこの注意書きだけで、機械執行は無い
 * （NOTES のバックログ）。
 *
 * ここに置いてよいのは zod の宣言を**読む**手続きだけであり、業務ルール（何が妥当か）も
 * 既定値の発明も 1 つも書かない。制約の正は `entity_spec` の生成スキーマである。
 */

import type { z } from 'zod';
import type { FormFieldAttributes } from './form';

/** zod v4 の内部表現（`def`）を読むための最小の形。 */
interface ZodInternals {
  /** `format` は文字列の下位種別（`z.iso.datetime()` なら `'datetime'`）。 */
  readonly def: {
    readonly type: string;
    readonly format?: string;
    readonly innerType?: z.ZodType;
    /** `z.enum([...])` の取り得る値（値 → 値 の写像として持たれている）。 */
    readonly entries?: Readonly<Record<string, string>>;
  };
  readonly maxLength?: number | null;
  readonly minValue?: number | null;
  readonly maxValue?: number | null;
  readonly isInt?: boolean;
}

/** 型の位置で `def` を読むための写し（実行時の値は変えない）。 */
function internalsOf(schema: z.ZodType): ZodInternals {
  return schema;
}

/**
 * 未入力（空文字）をスキーマに渡すときの形。
 *
 * `optional` と `nullable` は**別物**である。前者は「キーが無い」を許し、後者は
 * 「値が `null`」を許す。同じ「未入力」に写すと、`nullable` のフィールドで
 * 「未入力だったのにキーが無い」＝必須違反になる（あるいは逆に `null` を許さない
 * フィールドに `null` が入る）。区別はスキーマ側にあるので、ここでは写すだけ。
 */
type EmptyValue = 'omit' | 'null';

/**
 * 制約を持つ本体（`optional` / `nullable` の内側）まで剥がす。
 *
 * どちらの包みだったかを保つ（未入力の写し方が変わるため）。
 */
function unwrap(schema: z.ZodType): {
  readonly inner: z.ZodType;
  readonly required: boolean;
  readonly emptyValue: EmptyValue;
} {
  let current = schema;
  let optional = false;
  let nullable = false;
  let internals = internalsOf(current);
  while (
    (internals.def.type === 'optional' || internals.def.type === 'nullable') &&
    internals.def.innerType !== undefined
  ) {
    if (internals.def.type === 'optional') optional = true;
    else nullable = true;
    current = internals.def.innerType;
    internals = internalsOf(current);
  }
  // `optional` と `nullable` の両方が付いていればキーを落とす側を採る（`null` を保存しない）。
  return { inner: current, required: !optional && !nullable, emptyValue: nullable && !optional ? 'null' : 'omit' };
}

/**
 * 制約が「宣言されている」ものだけを残す。
 *
 * zod は上下限の無い数値に `±Infinity` を返す。そのまま HTML 属性にすると
 * 「宣言されていない制約」を画面が持ってしまうので、`null`（無し）に倒す。
 */
function declared(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 1 フィールドについて、画面に渡す属性と、未入力の写し方をまとめたもの。 */
export interface FieldPlan {
  /** 入力欄に写せる制約。 */
  readonly attributes: FormFieldAttributes;
  /** 空文字をスキーマに渡すときの形。 */
  readonly emptyValue: EmptyValue;
}

/**
 * 1 フィールドのスキーマから HTML 属性と未入力の写し方を導く。
 *
 * @param schema - フィールドのスキーマ
 * @returns 入力欄に写せる制約と、空文字の扱い
 */
export function planOf(schema: z.ZodType): FieldPlan {
  const { inner, required, emptyValue } = unwrap(schema);
  const internals = internalsOf(inner);
  const numeric = internals.def.type === 'number';
  const entries = internals.def.entries;
  return {
    attributes: {
      required,
      maxLength: declared(internals.maxLength),
      min: numeric ? declared(internals.minValue) : null,
      max: numeric ? declared(internals.maxValue) : null,
      // 整数のスキーマ（`z.number().int()`）は刻み 1、それ以外の数値は 'any'（小数可）。
      step: numeric ? (internals.isInt === true ? 1 : 'any') : null,
      numeric,
      // 値域（`z.enum([...])`）の取り得る値。宣言の順序をそのまま保つ。
      // `entries` を持つのは enum だけなので、型で分岐せずその有無だけを見る
      //（`type === 'enum'` を重ねて確かめると、到達しない枝が 1 つ増える）。
      options: entries === undefined ? null : Object.values(entries),
      // 日時（`z.iso.datetime()`）は文字列の下位種別として宣言されている。
      datetime: internals.def.format === 'datetime',
    },
    emptyValue,
  };
}
