/**
 * Route Handler(`route.ts`)が **export している HTTP メソッド**を AST で求める。
 *
 * Next.js の Route Handler は、`GET` / `POST` … の名前で export した関数がそのメソッドの口になる。
 * 規約は「1 ファイル 1 メソッド」だが、規約は執行されていないと破れる —— 認可を持たない `POST` を 1 本足しても、
 * `GET` だけを見る検査は緑のままである(網の穴探しの独立レビュー m01d)。そこで**手書きの一覧を持たず**、
 * 起動口の構文木から export の一覧を取る(生成テストが全メソッドを呼ぶ)。
 *
 * 数える形は、`export function GET` / `export async function GET` / `export const GET = …` /
 * `export { GET }` / `export { handler as GET }` / `export { GET } from '…'`(型だけの再輸出は除く。数え方の正は
 * `module-exports.ts`)。純粋関数であり throw しない。
 *
 * **名前を数えられない形**(分割代入の `export const { GET } = …`・`export * from './impl'`)は、Next.js の実行時には
 * GET の口になりうるのに数えられない(4 回目 C4-6)。`unreadableRouteExports` がその形を返し、J2 の閉世界が全部の
 * Route Handler に当てて error にする(fail-closed。数えられない口を「GET が無い」と見なさない)。
 */

import { exportedValueNames, unreadableExportForms } from './module-exports.js';
import type { UnreadableExportForm } from './module-exports.js';

/** Next.js の Route Handler が受けるメソッド(HTTP の標準の語。並びはこの表のとおりに返す)。 */
export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

/** HTTP メソッド。 */
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * 1 本の Route Handler の本文から、export している HTTP メソッドを返す。
 *
 * @param fileName ファイル名(AST の診断用)
 * @param source 本文
 * @returns export している HTTP メソッド(`HTTP_METHODS` の並び・重複なし)。1 つも無ければ空
 */
export function exportedHttpMethods(fileName: string, source: string): readonly HttpMethod[] {
  const names = exportedValueNames(fileName, source);
  return HTTP_METHODS.filter((method) => names.has(method));
}

/**
 * 1 本の Route Handler の本文から、**メソッドを数えられない export の形**を返す(分割代入・`export * from`)。
 * 1 つでもあれば、`exportedHttpMethods` の結果は口の全部である保証が無い。
 *
 * @param fileName ファイル名(AST の診断用)
 * @param source 本文
 * @returns 形の一覧(出現順。無ければ空)
 */
export function unreadableRouteExports(fileName: string, source: string): readonly UnreadableExportForm[] {
  return unreadableExportForms(fileName, source);
}
