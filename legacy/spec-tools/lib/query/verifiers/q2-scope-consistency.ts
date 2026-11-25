/**
 * Q2 スコープ整合チェック。
 *
 * query-spec-writing.md の Q2:「`for` に並ぶのはグローバルロールだけであり、その各ロールに
 * ついて access_spec の `reads`(`via` があればそのロールの `reads`)に宣言があり、
 * `scope_used` と一致する。`scope: none` のロールが `for` に居たらエラー」。
 *
 * 可視性の正は access_spec であり、query_spec が書くのは「どの経路でその可視性を使うか」
 * だけである(PRIN-0007)。ここが食い違うと、仕様上は見えないはずのデータを返すクエリや、
 * RLS に弾かれて常に空になるクエリが仕様として通ってしまう。
 */

import type { SpecModel } from '../../model/types.js';
import type { Finding, QueryVerifier } from '../verifier.js';
import { queryFinding } from '../verifier.js';
import type { QuerySpec } from '../../model/query/types.js';
import { checkRoleScope } from '../scope-check.js';
import { findAccessSpec, hasRole, isContextRole } from '../../semantics/domain-lookup.js';

/** Q2: for の各ロールの読み取り宣言と scope_used が一致するかを検証する。 */
export const scopeConsistencyVerifier: QueryVerifier = {
  id: 'Q2',
  title: 'スコープ整合 — for はグローバルロールで、その reads(または via)と scope_used が一致する',

  verify(input): Finding[] {
    return input.queries.queries.flatMap((query) => [
      ...checkAudience(query, input.domain),
      ...checkQuery(query, input.domain),
    ]);
  },
};

/**
 * `for` に文脈依存ロールが混ざっていないかを見る。
 *
 * `for` は「誰がこのクエリを実行するか(観客)」であり、`performer` のような**関係**を
 * 書くと「メンバーとして催しを読みながら、発表者として自分の申込みを併読する」経路が
 * 1 つの欄では表せなくなる。関係は `via` に分けて書く(query-spec-writing.md §via)。
 */
function checkAudience(query: QuerySpec, domain: SpecModel): Finding[] {
  return query.forRoles
    .filter((role) => hasRole(domain, role) && isContextRole(domain, role))
    .map((role) =>
      queryFinding('Q2', {
        message: `for のロール ${role} は文脈依存ロールです(roles.md に binding がある)`,
        // 指摘の位置は for の当該要素にする(1 クエリに複数ロールが並ぶため、
        // ファイル全体ではなく「どの要素を直すか」まで示す)。
        location: { file: query.location.file, pointer: `for.${role}` },
        suggestion:
          `for には観客(グローバルロール)を書き、"via: ${role}" として関係を分ける。` +
          `for は ${role} が implies で含意するロール(例: member)にする`,
        counterexample: { query: query.name, role },
      }),
    );
}

/** 1 つの query_spec の source について、for の全ロールを検査する。 */
function checkQuery(query: QuerySpec, domain: SpecModel): Finding[] {
  const access = findAccessSpec(domain, query.source);
  if (access === null) {
    return [
      queryFinding('Q2', {
        message: `source の ${query.source} に access_spec がありません`,
        location: query.location,
        suggestion:
          `specs/domain/${query.source}/access.md を作り、全ロールの reads を宣言する` +
          '(誰が読めるかの正はドメイン仕様側にある)',
        counterexample: { query: query.name, source: query.source },
      }),
    ];
  }

  return query.forRoles.flatMap((role) =>
    checkRoleScope({
      verifier: 'Q2',
      domain,
      access,
      role,
      ...(query.via === undefined ? {} : { via: query.via }),
      scopeUsed: query.scopeUsed,
      entity: query.source,
      label: 'scope_used',
      location: query.location,
      query: query.name,
    }),
  );
}
