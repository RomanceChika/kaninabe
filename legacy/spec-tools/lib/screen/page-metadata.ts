/**
 * 画面の器(`page.tsx`)の `generateMetadata` の形を読む(点検 14 回目 B14-1。S7 の入力)。
 *
 * Next.js は `generateMetadata` を page の描画と同時に実行し、結果を 307 / 404 の本文へ流す。関門のある画面では、`generateMetadata` も**自分の最初の文で**関門を通らなければならない。
 * 判定は**形の許可表**である: 読める形は `export async function generateMetadata(…) { [const x =] await <関門>(…` の 1 つだけで、綴りが 1 回でもあって形が違えば `unreadable`(赤)。
 * `export *` はファイルの中に名前が見えないので同じ扱いにする。
 */

import type { PageMetadataForm } from '../model/screen/app-types.js';

/** 名前の綴り。 */
const NAME = /\bgenerateMetadata\b/g;

/** 名前が見えない再 export。 */
const STAR_EXPORT = /\bexport\s*\*/;

/** 許可の形。引数に `)` を含まず、戻り値の型に `{` を含まない(含めば読まない)。 */
const GATED_FORM = /\bexport\s+async\s+function\s+generateMetadata\s*\([^)]*\)\s*(?::[^{]*)?\{\s*(?:const\s+[A-Za-z_$][\w$]*\s*=\s*)?await\s+([A-Za-z_$][\w$]*)\(/;

/**
 * コメントを落とす(散文の綴りで赤にしない。文字列の中の `//` までは見分けないが、読み違えても許可の形から外れて赤になる)。
 *
 * @param source ファイルの中身
 * @returns コメントを除いた中身
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * `page.tsx` の `generateMetadata` の形を読む。
 *
 * @param source ファイルの中身
 * @returns 形
 */
export function pageMetadataForm(source: string): PageMetadataForm {
  const code = stripComments(source);
  if (STAR_EXPORT.test(code)) return { kind: 'unreadable' };
  const count = [...code.matchAll(NAME)].length;
  if (count === 0) return { kind: 'none' };
  const symbol = GATED_FORM.exec(code)?.[1];
  return count === 1 && symbol !== undefined ? { kind: 'gated', symbol } : { kind: 'unreadable' };
}
