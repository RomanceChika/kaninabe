/**
 * Q5 併読エンティティのチェック。
 *
 * query-spec-writing.md の Q5:「`includes` のエンティティが entity_spec の context / 参照関係で
 * `source` から解決でき、`scope_used` が当該エンティティの reads 宣言(`via` があれば
 * そのロールの宣言)と一致する」。併読側の `via` は source 側とは独立に書ける
 * (「催しはメンバーとして読み、自分の申込みは発表者として併読する」がその形)。
 *
 * 併読は「1 回の読み取りで一緒に返すもの」の宣言であり、可視性が増える操作ではない。
 * 辿れない相手を併読するクエリは実装できず、reads と食い違うスコープでの併読は
 * source 側だけ守って include 側で漏らす経路になる。
 */

import type { SpecModel } from '../../model/types.js';
import type { Finding, QueryVerifier } from '../verifier.js';
import { queryFinding } from '../verifier.js';
import type { QueryInclude, QuerySpec } from '../../model/query/types.js';
import { findAccessSpec, findEntitySpec, isRelated } from '../../semantics/domain-lookup.js';
import { checkRoleScope } from '../scope-check.js';

/** Q5: includes が source から辿れ、スコープが reads と一致するかを検証する。 */
export const includeResolutionVerifier: QueryVerifier = {
  id: 'Q5',
  title: '併読の解決 — includes が source から辿れ、reads と一致する',

  verify(input): Finding[] {
    const findings: Finding[] = [];
    for (const query of input.queries.queries) {
      for (const include of query.includes) {
        findings.push(...checkInclude(query, include, input.domain));
      }
    }
    return findings;
  },
};

/** 1 件の includes を検査する。 */
function checkInclude(query: QuerySpec, include: QueryInclude, domain: SpecModel): Finding[] {
  if (findEntitySpec(domain, include.entity) === null) {
    return [
      queryFinding('Q5', {
        message: `includes の ${include.entity} は specs/domain にありません`,
        location: include.location,
        suggestion: `specs/domain/${include.entity}/entity.md を作るか、実在するエンティティ名に直す`,
        counterexample: { query: query.name, include: include.entity },
      }),
    ];
  }

  if (!isRelated(domain, query.source, include.entity)) {
    return [
      queryFinding('Q5', {
        message: `includes の ${include.entity} は ${query.source} から辿れません`,
        location: include.location,
        suggestion:
          `どちらかの entity.md に相手への ref フィールドか context 宣言を足す。` +
          '関係が無いものを 1 つのクエリで返そうとしていないか(クエリを分けるべきでないか)を先に確認する',
        counterexample: { query: query.name, source: query.source, include: include.entity },
      }),
    ];
  }

  const access = findAccessSpec(domain, include.entity);
  if (access === null) {
    return [
      queryFinding('Q5', {
        message: `includes の ${include.entity} に access_spec がありません`,
        location: include.location,
        suggestion:
          `specs/domain/${include.entity}/access.md を作り、全ロールの reads を宣言する` +
          '(併読でも可視性の正は access_spec)',
        counterexample: { query: query.name, include: include.entity },
      }),
    ];
  }

  return query.forRoles.flatMap((role) =>
    checkRoleScope({
      verifier: 'Q5',
      domain,
      access,
      role,
      ...(include.via === undefined ? {} : { via: include.via }),
      scopeUsed: include.scopeUsed,
      entity: include.entity,
      label: `includes.${include.entity}.scope_used`,
      location: include.location,
      query: query.name,
    }),
  );
}
