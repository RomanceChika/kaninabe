/**
 * 1 画面フォームの生成物の中で使う**名前の規約**(識別子・testid の断片)。
 *
 * 本体(usecase-form-body.ts)と欄の字面(usecase-form-fields.ts)が同じ名前を組み立てるため、
 * 規約をここ 1 か所に置く。綴りの正が 2 つになると、生成した部品と呼び出しがすれ違う。
 */

import { toCamelCase, toPascalCase } from '../../gen-kit/code-emit.js';
import type { FormStep } from './usecase-form-body.js';

/**
 * 手順の鍵(別名。書かれていなければ操作 ID)を、識別子・testid の断片に使える形にする。
 *
 * 別名は snake_case なので変換は素通りであり、`.` を含む操作 ID のときだけ `_` に置き換わる。
 */
export function slug(alias: string): string {
  return alias.split('.').join('_');
}

/** その手順の値を持つ状態変数の名前。 */
export function stateName(step: FormStep): string {
  return toCamelCase(slug(step.alias));
}

/** その手順の状態更新関数の名前。 */
export function setterName(step: FormStep): string {
  return `set${toPascalCase(slug(step.alias))}`;
}

/** その手順のフォームの口(制約の読み出し)の名前。 */
export function schemaName(step: FormStep): string {
  return `${slug(step.alias).toUpperCase()}_FORM`;
}

/** 手順ごとの入力欄の部品の名前。 */
export function fieldsComponentName(step: FormStep): string {
  return `${toPascalCase(slug(step.alias))}Fields`;
}
