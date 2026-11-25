/**
 * Q3 隠しフィールドの衝突チェック。
 *
 * query-spec-writing.md の Q3:「`fields_hidden` で `for` のロールから隠されるフィールドを、
 * `projection`(source / includes)・`sort`・`filters` のいずれでも使っていないこと」。
 *
 * `fields_hidden` は「スコープ内でも、このロールには見せない」という宣言である。
 * 返せば当然破れるが、**返さなくても隠したフィールドで絞り込んだり並べ替えたりすれば
 * 件数や順序から中身が漏れる**(「note に "辞退" を含む行だけ 3 件」は note の中身の情報である)。
 * したがって検査対象は「返すもの」だけでなく「使うもの」全体になる。
 *
 * 隠す/使うのどちらが正しいかは人間の判断なので、検証器は衝突の存在だけを指摘する。
 */

import type { SourceLocation, SpecModel } from '../../model/types.js';
import type { Finding, QueryContext, QueryVerifier } from '../verifier.js';
import { queryFinding } from '../verifier.js';
import type { QueryFilter, QuerySpec } from '../../model/query/types.js';
import { findAccessSpec } from '../../semantics/domain-lookup.js';
import { resolveFilterPath, type FilterOrigin } from '../../semantics/query-filter-path.js';

/** クエリが使っているフィールド 1 件(どこで使っているかを添える)。 */
interface FieldUse {
  readonly entity: string;
  readonly field: string;
  /** 使っている場所(メッセージ用。"projection" / "sort" / "filters" など)。 */
  readonly where: string;
  /**
   * その使用箇所の可視性を持っているロール。
   *
   * `via` が無ければ `for` のロール(観客)そのもの、`via` があればそのロールになる。
   * 借用の可否は Q2 / Q5 が見ており、ここでは「実際に行を見せているロール」を基準に
   * `fields_hidden` と突き合わせる。
   */
  readonly roles: readonly string[];
  readonly location: SourceLocation;
}

/** Q3: 隠しフィールドを projection / sort / filters で使っていないかを検証する。 */
export const hiddenProjectionVerifier: QueryVerifier = {
  id: 'Q3',
  title: '隠しフィールドの衝突 — 隠されたフィールドを返さない・絞らない・並べない',

  verify(input, ctx: QueryContext): Finding[] {
    return input.queries.queries.flatMap((query) => checkQuery(query, input.domain, ctx));
  },
};

/** 1 つの query_spec が使う全フィールドを fields_hidden と突き合わせる。 */
function checkQuery(query: QuerySpec, domain: SpecModel, ctx: QueryContext): Finding[] {
  const findings: Finding[] = [];
  for (const use of collectUses(query, domain, ctx)) {
    const access = findAccessSpec(domain, use.entity);
    if (access === null) continue;
    for (const rule of access.fieldsHidden) {
      if (rule.field !== use.field) continue;
      const blocked = rule.from.filter((role) => use.roles.includes(role));
      if (blocked.length === 0) continue;
      findings.push(conflictFinding(query, use, blocked));
    }
  }
  return findings;
}

/** projection(source / includes)・sort・filters が使っているフィールドを列挙する。 */
function collectUses(query: QuerySpec, domain: SpecModel, ctx: QueryContext): FieldUse[] {
  const sourceRoles = basisRoles(query, query.via?.role);
  const uses: FieldUse[] = [
    ...query.projection.map((f) => ({
      entity: query.source,
      field: f.name,
      where: 'projection',
      roles: sourceRoles,
      location: f.location,
    })),
    ...query.sort.map((key) => ({
      entity: query.source,
      field: key.field,
      where: 'sort',
      roles: sourceRoles,
      location: key.location,
    })),
    ...query.includes.flatMap((include) => [
      ...include.projection.map((f) => ({
        entity: include.entity,
        field: f.name,
        where: `includes.${include.entity}.projection`,
        roles: basisRoles(query, include.via?.role),
        location: f.location,
      })),
      ...include.sort.map((key) => ({
        entity: include.entity,
        field: key.field,
        where: `includes.${include.entity}.sort`,
        roles: basisRoles(query, include.via?.role),
        location: key.location,
      })),
    ]),
  ];

  collectFilterUses(query, query.filters, domain, ctx, {
    origin: { entity: query.source, label: 'source' },
    where: 'filters',
    roles: sourceRoles,
    into: uses,
  });
  // 併読の filters も同じ露出の口である(件数から中身が漏れることに source との差は無い)。
  for (const include of query.includes) {
    collectFilterUses(query, include.filters, domain, ctx, {
      origin: { entity: include.entity, label: `includes.${include.entity}` },
      where: `includes.${include.entity}.filters`,
      roles: basisRoles(query, include.via?.role),
      into: uses,
    });
  }
  return uses;
}

/** filters 1 群が使っているフィールドを解決して集める。 */
function collectFilterUses(
  query: QuerySpec,
  filters: readonly QueryFilter[],
  domain: SpecModel,
  ctx: QueryContext,
  target: {
    readonly origin: FilterOrigin;
    readonly where: string;
    readonly roles: readonly string[];
    readonly into: FieldUse[];
  },
): void {
  for (const filter of filters) {
    const parsed = ctx.guards.parse(filter.source);
    if (!parsed.ok) continue; // 文法違反は Q4 が指摘する
    for (const path of ctx.guards.collectPaths(parsed.expr)) {
      const resolved = resolveFilterPath(domain, query, path, target.origin);
      if (resolved.kind !== 'field') continue;
      target.into.push({
        entity: resolved.entity,
        field: resolved.field,
        where: target.where,
        roles: target.roles,
        location: filter.location,
      });
    }
  }
}

/**
 * その使用箇所の可視性を持っているロールを決める。
 *
 * `via` が書かれていれば、その行を見せているのは関係ロールなので判定基準もそちらになる
 * (例: 自分の申込みを `via: performer` で併読するとき、`member` から隠す `note` は
 * 本人には見えてよい)。書かれていなければ従来どおり `for` のロールが基準になる。
 */
function basisRoles(query: QuerySpec, via: string | undefined): readonly string[] {
  return via === undefined ? query.forRoles : [via];
}

/** 隠すべきフィールドを使っている指摘。 */
function conflictFinding(query: QuerySpec, use: FieldUse, roles: readonly string[]): Finding {
  const list = roles.join(', ');
  const how =
    use.where === 'filters'
      ? '絞り込みに使うと、件数から中身が漏れる'
      : use.where === 'sort'
        ? '並べ替えに使うと、順序から中身が漏れる'
        : '返してしまうと隠す宣言が無効になる';
  return queryFinding('Q3', {
    message: `${use.where} の ${use.field} は ${list} から隠すフィールドです(fields_hidden)`,
    location: use.location,
    suggestion:
      `${use.where} から ${use.field} を外すか、for から ${list} を外す。${how}。` +
      `${list} に ${use.field} を見せてよいなら specs/domain/${use.entity}/access.md の fields_hidden を先に直す`,
    counterexample: { query: query.name, field: use.field, where: use.where, roles: list },
  });
}
