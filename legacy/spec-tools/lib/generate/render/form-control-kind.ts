/**
 * 生成フォームの**入力欄の種類の決め方**(保存点の 1 画面フォームと画面の部品のフォームが共有する)。
 *
 * 「どの欄をどの部品で入れるか」は仕様が持たず、entity_spec の型から決まる実装の判断である。
 * 判断の置き場を 1 か所にすることで、2 つの生成器の間で欄の見た目が揺れない
 * (保存点のフォームでは text だった欄が、単発の操作のフォームでは select になる、を起こさない)。
 * アプリの語彙は 1 語も持たない(W1)。
 */

import type { FormControlKind } from './usecase-form-body.js';

/**
 * entity_spec の型 → 入力欄の種類(参照・識別子は画面が決めるので `null`)。
 *
 * @param kind entity_spec のフィールドの型(`type.kind`)
 * @returns 入力欄の種類。入力欄を出さない型(参照・識別子)は null
 */
export function controlKindOf(kind: string): FormControlKind | null {
  if (kind === 'ref' || kind === 'uuid') return null;
  if (kind === 'boolean') return 'checkbox';
  if (kind === 'enum') return 'select';
  if (kind === 'text') return 'multiline';
  return 'text';
}
