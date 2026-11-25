/**
 * 手書きのアダプタが、無害化の部品を**呼んでいるか**の走査(X7 の材料。純関数)。
 *
 * 部品は `@kaninabe/runtime/neutralize` の export(`neutralizeDiscordMentions` / `allowedDiscordMentionsOf` / `stripControlChars` / `clampLength`)。
 * **名前でなく束縛で見る**: 呼び出し先の識別子が、そのモジュールからの値の import(別名も可)に解決できるものだけを数える。同名のローカル関数・引数に隠した名前・
 * 別モジュールの import・型だけの import は数えない。`clampLength` は第 2 引数が数値のリテラルである呼び出しだけ、その数を持ち帰る(宣言の `length:N` と突き合わせる)。
 * 「呼んでいる」までが下限で、結果を実際に送る値に使っているかまでは見ない。
 */

import ts from 'typescript';
import { allowedImports, parseSource, resolveImport, walk } from '../config/import-binding.js';
import type { ImportSpec } from '../config/import-binding.js';
import { NEUTRALIZE_MODULE } from '../kernel/neutralize.js';

/** 部品の呼び出し 1 件。 */
export interface NeutralizeCall {
  /** 呼んだ部品(`@kaninabe/runtime/neutralize` の export の名前)。 */
  readonly name: string;
  /** `clampLength` の第 2 引数が数値のリテラルだったときの値(それ以外は null)。 */
  readonly limit: number | null;
}

/** 部品の export の名前(宣言の語彙が要求するもの。`lib/kernel/neutralize.ts` の `neutralizerExports` の和集合)。 */
const EXPORTS = ['neutralizeDiscordMentions', 'allowedDiscordMentionsOf', 'stripControlChars', 'clampLength'] as const;

/** 許す import。 */
const SPECS: readonly ImportSpec[] = EXPORTS.map((imported) => ({ module: NEUTRALIZE_MODULE, imported }));

/** 第 2 引数の数値のリテラル(`2000` / `2_000`。それ以外は null)。 */
function limitOf(call: ts.CallExpression): number | null {
  const second = call.arguments[1];
  if (second === undefined || !ts.isNumericLiteral(second)) return null;
  const value = Number(second.text.replaceAll('_', ''));
  return Number.isFinite(value) ? value : null;
}

/**
 * ソース 1 本の、無害化の部品の呼び出しを集める。
 *
 * @param source アダプタの内容
 * @param file ファイル名(構文木の種類の判定にだけ使う)
 * @returns 呼び出し(出現順)
 */
export function neutralizeCallsIn(source: string, file: string): readonly NeutralizeCall[] {
  const sourceFile = parseSource(source, file);
  const bound = allowedImports(sourceFile, SPECS);
  const calls: NeutralizeCall[] = [];
  if (bound.size === 0) return calls;
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
    const spec = resolveImport(node.expression, bound);
    if (spec === null) return;
    calls.push({ name: spec.imported, limit: spec.imported === 'clampLength' ? limitOf(node) : null });
  });
  return calls;
}
