/**
 * V 群の文脈(`VerifyContext`)が持つ「他の種類の入力」の状態の、テスト用の組み立て。
 *
 * `actions` / `dataTables` は必須の入力の状態である(省略して黙って通る口を残さない)。他の種類を読まない検査のテストは
 * `NO_DOMAIN_INPUTS`(どちらも採っていない)を足し、読む検査のテストは `loadedInput` で読込済みを渡す。
 */

import type { CatalogInput } from '../../lib/kernel/input-state.js';

/** 採っていない入力の状態。 */
export const UNSELECTED = { state: 'unselected', findings: [] } as const;

/** 他の種類を読まない検査の文脈に足す入力(どちらも採っていない)。 */
export const NO_DOMAIN_INPUTS = { actions: UNSELECTED, dataTables: UNSELECTED } as const;

/**
 * 読込済みの入力の状態。
 *
 * @param value 読み込んだモデル(0 件の空もここ)
 */
export function loadedInput<T>(value: T): CatalogInput<T> {
  return { state: 'loaded', value, findings: [] };
}

/**
 * 採っているのに検査へ渡せない入力の状態。
 *
 * @param reason 渡せなかった理由
 */
export function blockedInput<T>(reason: 'not-loaded' | 'missing' | 'load-failed' | 'invalid' = 'load-failed'): CatalogInput<T> {
  return { state: 'blocked', reason, findings: [] };
}
