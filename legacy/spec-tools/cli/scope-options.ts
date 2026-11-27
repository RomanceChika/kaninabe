/**
 * 実装の範囲に関する CLI の引数(`--implemented-base <file>`・`--list-out-of-scope`)の取り出し。
 *
 * `--implemented-base` の値は**位置引数に混ざらない**ように、引数の並びから値ごと取り除く(`verify` は最初の `--` で始まらない引数を
 * ドメイン仕様の木のパスとして読むので、値を残すと base の file がパスに化ける)。`--implemented-base=<file>` の綴りも受ける。
 */

import path from 'node:path';
import { valueOption, withoutValueOption } from './value-option.js';

/** オプション名。 */
const BASE_OPTION = '--implemented-base';
const LIST_OPTION = '--list-out-of-scope';

/** `--implemented-base` の取り出し結果(2 回書かれたら `duplicate`。どちらを採るか黙って決めない)。 */
export type ImplementedBaseOption =
  | { readonly kind: 'absent' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'value'; readonly value: string };

/**
 * 引数から `--implemented-base` の値を取り出す(値が無い・次が別のオプションなら `missing`)。
 *
 * @param args CLI の引数
 */
export function implementedBaseOption(args: readonly string[]): ImplementedBaseOption {
  const option = valueOption(args, BASE_OPTION);
  if (option.kind !== 'value') return option;
  return option.count > 1 ? { kind: 'duplicate' } : { kind: 'value', value: option.value };
}

/** 引数から `--implemented-base` とその値を取り除いた残り(位置引数の解釈を邪魔しないため)。 */
export function withoutImplementedBase(args: readonly string[]): string[] {
  return withoutValueOption(args, BASE_OPTION, { skipOptionLikeValue: false });
}

/** `--list-out-of-scope` が付いているか(範囲の外の仕様の名前を手元で出す)。 */
export function listOutOfScopeRequested(args: readonly string[]): boolean {
  return args.includes(LIST_OPTION);
}

/**
 * base の file の絶対パス(相対は呼ばれた場所から解く)。
 *
 * @param value `--implemented-base` の値
 * @param invocationDir 呼ばれた場所
 */
export function resolveBaseFile(value: string, invocationDir: string): string {
  return path.resolve(invocationDir, value);
}
