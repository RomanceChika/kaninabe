/**
 * ソース 1 本が、指定の名前の RPC を `.rpc('<名前>', …)` で呼んでいるかの走査(X8 の材料。純関数)。
 *
 * 枠を消費する RPC(`meter`)を呼ぶモジュールを、口の `consume` が使っていることを見るための目である。
 * 呼び出し先は PostgREST のクライアントの `rpc` メソッドの第 1 引数が文字列の字句(置換なしのテンプレートも)のものだけを数える。
 * 算出した名前・変数は数えない(宣言と突き合わせられないので、呼んでいないものとして扱う側に倒す)。
 */

import ts from 'typescript';
import { parseSource, walk } from '../config/import-binding.js';

/**
 * RPC の呼び出しがあるか。
 *
 * @param fileName ファイル名(構文木の種類の判定にだけ使う)
 * @param source 本文
 * @param name RPC の名前
 * @returns `.rpc('<name>')` の呼び出しがあれば true
 */
export function sourceCallsRpc(fileName: string, source: string, name: string): boolean {
  if (name === '') return false;
  let found = false;
  walk(parseSource(source, fileName), (node) => {
    if (found || !ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'rpc') return;
    const first = node.arguments[0];
    found = first !== undefined && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) && first.text === name;
  });
  return found;
}
