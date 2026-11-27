/**
 * 値を取るオプション(`--name <value>` / `--name=<value>`)の共通の取り出し。`--root` と `--implemented-base` が同じ口を通る。
 *
 * 取り出しは値と、**書かれた回数**を返す(回数をどう扱うかは呼び手が決める: `--root` は最初の 1 つを採り、
 * `--implemented-base` は 2 回を error にする)。値を落とす側は、次の引数がオプションのときにそれを値として落とすかを引数で選ぶ。
 */

/** 取り出し結果。 */
export type ValueOption =
  | { readonly kind: 'absent' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'value'; readonly value: string; readonly count: number };

/**
 * 引数から値オプションを取り出す。最初に書かれたものの値を返し、`count` は書かれた回数。
 *
 * @param args CLI の引数
 * @param name オプション名(`--` つき)
 */
export function valueOption(args: readonly string[], name: string): ValueOption {
  let first: ValueOption = { kind: 'absent' };
  let count = 0;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    let found: ValueOption | null = null;
    if (arg.startsWith(`${name}=`)) {
      const value = arg.slice(name.length + 1);
      found = value === '' ? { kind: 'missing' } : { kind: 'value', value, count: 1 };
    } else if (arg === name) {
      const value = args[index + 1];
      found = value === undefined || value.startsWith('--') ? { kind: 'missing' } : { kind: 'value', value, count: 1 };
    }
    if (found === null) continue;
    count += 1;
    if (first.kind === 'absent') first = found;
  }
  return first.kind === 'value' ? { ...first, count } : first;
}

/** 値オプションの落とし方の選択。 */
export interface WithoutValueOptionOptions {
  /** 次の引数が別のオプション(`--` で始まる)でも、値として落とすか(`--root` の従来の形は true)。 */
  readonly skipOptionLikeValue: boolean;
}

/**
 * 引数から値オプションとその値を取り除いた残り(他の引数の解釈を邪魔しないため)。
 *
 * @param args CLI の引数
 * @param name オプション名
 * @param options 落とし方
 */
export function withoutValueOption(args: readonly string[], name: string, options: WithoutValueOptionOptions): string[] {
  const kept: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg.startsWith(`${name}=`)) continue;
    if (arg === name) {
      const next = args[index + 1];
      if (next !== undefined && (options.skipOptionLikeValue || !next.startsWith('--'))) index += 1;
      continue;
    }
    kept.push(arg);
  }
  return kept;
}
