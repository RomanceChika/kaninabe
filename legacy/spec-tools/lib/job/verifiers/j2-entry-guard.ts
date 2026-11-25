/**
 * J2(続き)**出口の関所の配線** — 実装の木の全ての入口(Route Handler)の HTTP メソッドが、出口の関所 `guardRoute`
 * (`@kaninabe/runtime/http/route-guard`)で包まれている(点検 10 回目 B10-1)。
 *
 * 転送の主の守りは実行時の関所である(口が返した応答の `Location` / `Refresh` と転送の合図を、外へ出す直前に同じオリジンの相対パスか
 * 宣言した外の行き先だけに絞る)。lint の規則は綴りを追うので兄弟の書き方を取りこぼすが、関所は口の中の書き方に関係なく効く ——
 * ただし包まれた口だけである。そこで包みの形を `semantics/route-guard-shape.ts` の 1 つに閉じ、ここで全部の入口に当てる。
 * 外の行き先の表(`externalOrigins`)は**認証の `start` の口だけ**が持てる(IdP の認可の URL への 303。値は認証基盤のオリジン 1 つ)。
 * 本文が読めない入口は何も言わない(読めないファイルは Next.js も読めない)。
 */

import path from 'node:path';
import type { Finding } from '../../kernel/finding.js';
import { tryReadText } from '../../io/read-text.js';
import { routeGuardProblems } from '../../semantics/route-guard-shape.js';
import type { RouteGuardProblemKind } from '../../semantics/route-guard-shape.js';

/** 問題の種類ごとの文面(何が足りないか)。 */
const PROBLEM_TEXT: Readonly<Record<RouteGuardProblemKind, string>> = {
  unguarded: '出口の関所 guardRoute で包んでいません',
  'handler-unreadable': 'guardRoute の第 1 引数が、このファイルの矢印関数・関数式ではありません(口の本体を読めない)',
  'options-not-allowed': '外の行き先の表(externalOrigins)を持っています。持てるのは認証の start の口(IdP への 303)だけです',
  'options-shape': 'guardRoute の第 2 引数が { externalOrigins: <import した名前> } か { attachmentTypes: [{ type, reason } を文字列の字面で書いた行] } の形ではありません',
};

/**
 * 1 本の入口の包みの問題を指摘にする。
 *
 * @param repoRoot リポジトリルートの絶対パス
 * @param file 入口のファイル(リポジトリルート相対)
 * @param allowExternal 外の行き先の表を持ってよい口か(認証の `start`)
 * @returns 指摘(問題が無ければ空)
 */
export function entryGuardFindings(repoRoot: string, file: string, allowExternal: boolean): Finding[] {
  const source = tryReadText(path.join(repoRoot, file));
  if (source === null) return [];
  return routeGuardProblems(file, source, allowExternal).map((problem): Finding => ({
    verifier: 'J2',
    severity: 'error',
    message:
      `HTTP の入口 ${file} の ${problem.method} が、${PROBLEM_TEXT[problem.kind]}。` +
      '応答の行き先の見出し(Location / Refresh)と転送の合図を外へ出す直前に見る実行時の関所は、包んだ口にしか効きません(ASVS V3.7.2)',
    location: { file },
    suggestion:
      "`import { guardRoute } from '@kaninabe/runtime/http/route-guard';` を足し、`export const " +
      `${problem.method} = guardRoute(async (request: Request) => { … });\` の形で書く(外の行き先は認証の start の口だけが ` +
      '`{ externalOrigins: authRedirectOrigins の結果を返す関数 }` で持てる)',
    counterexample: { file, method: problem.method, problem: problem.kind },
    grounding: 'implementation',
  }));
}
