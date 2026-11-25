/**
 * GuardServices の具象実装の組み立て。
 *
 * 検証器はこのモジュールを import せず、VerifyContext 経由で GuardServices を受け取る(DI)。
 * 生成するのは CLI(合成ルート)だけ。
 */

import type { GuardExpr, GuardServices, PathRef, ReachResult } from './ast.js';
import { pathKey } from './atoms.js';
import { parseGuard } from './parser.js';
import { canCoexist, satisfiability } from './satisfiability.js';

/**
 * 式に現れるパスを重複なく列挙する(V2 参照整合チェック用)。
 *
 * 比較の左辺・右辺、`in` の左辺、`contains` の両辺、`is null` の左辺をすべて含む。
 * 予約語 `now` や `actor.*` もパスとして返るため、参照解決する側で扱いを決めること。
 *
 * @param expr 対象の式
 * @returns 出現順のパス一覧(同じドット表記のパスは 1 つに畳む)
 */
export function collectPaths(expr: GuardExpr): PathRef[] {
  const found = new Map<string, PathRef>();
  const add = (path: PathRef): void => {
    const key = pathKey(path);
    if (!found.has(key)) found.set(key, path);
  };

  const walk = (node: GuardExpr): void => {
    switch (node.kind) {
      case 'and':
      case 'or':
        walk(node.left);
        walk(node.right);
        return;
      case 'not':
        walk(node.operand);
        return;
      case 'compare':
        add(node.path);
        if (node.rhs.kind === 'path') add(node.rhs.path);
        return;
      case 'in':
      case 'null':
        add(node.path);
        return;
      case 'contains':
        add(node.path);
        add(node.ref);
        return;
    }
  };

  walk(expr);
  return [...found.values()];
}

/**
 * 判定器を通していないときの有界到達性の答え。
 *
 * **「到達できる」に畳まない。** 畳むと、答えの表を配線し忘れた瞬間に V21 が黙って
 * 全部緑になる —— 検査の範囲が縮んだことが誰にも見えなくなる(V9 の `failure` と同じ事情)。
 */
const NO_SOLVER: ReachResult = { verdict: 'unknown', reason: 'no-solver' };

/**
 * ガード式のパース・パス収集・充足性判定をまとめた GuardServices を作る。
 *
 * @returns 状態を持たない GuardServices 実装(使い回してよい)
 */
export function createGuardServices(): GuardServices {
  return {
    parse: parseGuard,
    collectPaths,
    satisfiability,
    canCoexist,
    boundedReachability: () => NO_SOLVER,
  };
}
