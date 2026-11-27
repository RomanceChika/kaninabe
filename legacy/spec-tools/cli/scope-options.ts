/**
 * 実装の範囲に関する CLI の引数(`--implemented-base <file>`・`--list-out-of-scope`)の取り出し。
 *
 * `--implemented-base` の値は**位置引数に混ざらない**ように、引数の並びから値ごと取り除く(`verify` は最初の `--` で始まらない引数を
 * ドメイン仕様の木のパスとして読むので、値を残すと base の file がパスに化ける)。`--implemented-base=<file>` の綴りも受ける。
 */

import path from 'node:path';

/** オプション名。 */
const BASE_OPTION = '--implemented-base';
const LIST_OPTION = '--list-out-of-scope';

/** `--implemented-base` の取り出し結果。 */
export type ImplementedBaseOption =
  | { readonly kind: 'absent' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'value'; readonly value: string };

/**
 * 引数から `--implemented-base` の値を取り出す(値が無い・次が別のオプションなら `missing`)。
 *
 * @param args CLI の引数
 */
export function implementedBaseOption(args: readonly string[]): ImplementedBaseOption {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg.startsWith(`${BASE_OPTION}=`)) {
      const value = arg.slice(BASE_OPTION.length + 1);
      return value === '' ? { kind: 'missing' } : { kind: 'value', value };
    }
    if (arg === BASE_OPTION) {
      const value = args[index + 1];
      return value === undefined || value.startsWith('--') ? { kind: 'missing' } : { kind: 'value', value };
    }
  }
  return { kind: 'absent' };
}

/** 引数から `--implemented-base` とその値を取り除いた残り(位置引数の解釈を邪魔しないため)。 */
export function withoutImplementedBase(args: readonly string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg.startsWith(`${BASE_OPTION}=`)) continue;
    if (arg === BASE_OPTION) {
      const next = args[index + 1];
      if (next !== undefined && !next.startsWith('--')) index += 1;
      continue;
    }
    kept.push(arg);
  }
  return kept;
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
