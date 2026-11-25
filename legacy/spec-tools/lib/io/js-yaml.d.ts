/**
 * `js-yaml` の型の宣言(使う口だけ)。js-yaml 4 は型を同梱せず、型のパッケージ(@types/js-yaml)を足さない方針なので、
 * `lib/io/front-matter.ts` が呼ぶ `load` と、スキーマの `CORE_SCHEMA` だけを宣言する。
 */
declare module 'js-yaml' {
  /** スキーマ(読める型の集合)。中身は使わず、`load` へ渡すだけの不透明な値。 */
  export interface Schema {
    readonly __schema: never;
  }

  /** YAML 1.2 のコア・スキーマ(タグ・マージキー・日時の暗黙変換なし)。 */
  export const CORE_SCHEMA: Schema;

  /** `load` の設定。 */
  export interface LoadOptions {
    readonly schema?: Schema;
  }

  /** YAML の 1 文書を読む。壊れていれば例外を投げる。 */
  export function load(input: string, options?: LoadOptions): unknown;
}
