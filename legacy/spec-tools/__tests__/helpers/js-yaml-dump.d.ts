/**
 * テストが一時の仕様ファイルを書き出すときに使う `js-yaml` の `dump` の型(`lib/io/js-yaml.d.ts` の宣言に足す)。
 */
declare module 'js-yaml' {
  /** 値を YAML の文字列に書き出す。 */
  export function dump(input: unknown): string;
}
