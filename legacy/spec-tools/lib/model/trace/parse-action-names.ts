/**
 * `{a}.{b}` 形式(`{machine}.{event}` / `{entity}.{field}`)の名前を分解する葉。
 *
 * action_spec のパーサー(`parse-action.ts`)と、その実行計画の宣言を読む側
 * (`parse-action-plan.ts`)が**同じ 1 つの形式**を読むので、互いを読まずにここを読む。
 * どちらかの側に置くと、もう一方が借り、借りた側がまた相手を借りる値の循環になる。
 *
 * 純関数であり throw しない。
 */

/** `{machine}.{event}` / `{entity}.{field}` に共通の 2 セグメント形式。 */
const QUALIFIED = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/**
 * `{a}.{b}` 形式の文字列を分解する。形式違反なら null。
 *
 * @param raw 検査対象の文字列
 * @returns 前半・後半に分けた組。形式違反なら null
 */
export function splitQualified(raw: string): { readonly head: string; readonly tail: string } | null {
  if (!QUALIFIED.test(raw)) return null;
  const dot = raw.indexOf('.');
  return { head: raw.slice(0, dot), tail: raw.slice(dot + 1) };
}
