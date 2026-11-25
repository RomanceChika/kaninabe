/**
 * 有料の口の共通の入口 `runPaidEntry` の第 2 引数のうち、**個別に形を固定していない欄の許可表**(X8 の材料。点検 7 回目 B7-1)。
 *
 * 上限・認可・束・役・多要素認証・出力口・枠の消費・`handler` は `paid-entry-scan.ts` が欄ごとに形を固定する。残りの欄と鍵の集合をここで閉じる:
 * 鍵は `PAID_ENTRY_OPTION_KEYS`(実行時パッケージの `PaidEntryOptions` の欄)だけ、`operation` / `invariant` は文字列の字句、`parse` は import した
 * 束縛の識別子(呼ばない)。オブジェクトの値は `runPaidEntry` を呼ぶ**前**(認可より前)に評価されるので、`operation: await previewOperation(request)`
 * のような呼び出し・`await` を置くと、未ログインの要求でも任意の処理が走る(関門の閉じ方は 401 のままで、見た目では分からない)。
 * 純粋関数であり throw しない。
 */

import ts from 'typescript';
import { isShadowed } from '../config/import-binding.js';
import { unwrap } from '../semantics/guard-ast.js';
import { literalText, valueOf } from './paid-entry-ast.js';

/** `runPaidEntry` の第 2 引数に書いてよい鍵(実行時パッケージの `PaidEntryOptions` の欄。許可表)。 */
export const PAID_ENTRY_OPTION_KEYS: readonly string[] = ['operation', 'maxBodyBytes', 'authorize', 'bindings', 'role', 'resolveMfa', 'parse', 'consume', 'handler', 'invariant', 'logger'];

/** 値が文字列の字句か(`'…'` と置換なしのテンプレート)。 */
function isStringLiteralValue(value: ts.Expression | null): boolean {
  return value !== null && literalText(unwrap(value)) !== null;
}

/** 値が、import した束縛をそのまま渡す識別子か(隠していない。呼ばない)。 */
function isImportBinding(value: ts.Expression | null, specifiers: ReadonlyMap<string, string>): boolean {
  const name = value === null ? null : unwrap(value);
  return name !== null && ts.isIdentifier(name) && specifiers.has(name.text) && !isShadowed(name, name.text);
}

/**
 * 個別に形を固定していないオプション(鍵の集合・`operation`・`invariant`・`parse`)が許可表の内か。
 *
 * @param options 第 2 引数の欄(実行時の鍵 → 欄)
 * @param specifiers このファイルの import の束縛(ローカル名 → 指定子)
 * @returns 許可表の内なら true
 */
export function restOptionsAllowed(options: ReadonlyMap<string, ts.ObjectLiteralElementLike>, specifiers: ReadonlyMap<string, string>): boolean {
  if ([...options.keys()].some((key) => !PAID_ENTRY_OPTION_KEYS.includes(key))) return false;
  if (!isStringLiteralValue(valueOf(options.get('operation')))) return false;
  if (options.has('invariant') && !isStringLiteralValue(valueOf(options.get('invariant')))) return false;
  return isImportBinding(valueOf(options.get('parse')), specifiers);
}
