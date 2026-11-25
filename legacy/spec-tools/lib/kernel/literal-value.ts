/**
 * TS のリテラル式として出力できる値の型(kernel 層 — 全層が読む共通語)。
 *
 * 生成器の出力側(`lib/gen-kit/code-emit.ts`)が文字列にする入口を持つが、
 * **型そのものは仕様から導く側(screen の前提データなど)も受け渡しに使う**ので、下の層へ出した。
 * `code-emit.ts` は型だけを再輸出する(値は持たない)。
 */

/**
 * TS のリテラル式として出力できる値。キーはすべて識別子として妥当な名前であることを前提とする
 * (仕様由来のキーは生成器が決め打ちするため、この前提はここで閉じる)。
 */
export type LiteralValue =
  | string
  | number
  | boolean
  | null
  | readonly LiteralValue[]
  | { readonly [key: string]: LiteralValue };
