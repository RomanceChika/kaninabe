/**
 * Q4 絞り込み式のチェック。
 *
 * query-spec-writing.md の Q4:「`filters`(`source` / `includes` の両方)がガード式の文法として
 * 妥当で、参照パスがその起点のフィールド・`context` で解決できるパス・`actor` / `now` / `param.*`
 * で解決でき、比較の値(`==` / `!=` の右辺と `in` / `not in` の並び)が、値域の閉じた
 * フィールド(state / enum / boolean)の宣言済みの値として実在する」。
 *
 * filters はガード式と同じ文法・同じパーサー・同じ解決規則を使う(表現力を 1 つに保つため。
 * ADR-0003)。参照できる範囲を context で辿れる先までに限るのは、**絞り込みは UX・
 * 可視性は RLS** という役割分担を仕様の側から守るためである。context の外を参照したくなったら、
 * それは可視性(access_spec)か併読(includes)の話になっている。
 *
 * 値の突合を持つのは、`state in [draft, submited]` や `listing_kind == fulll` のような綴り違いが
 * **式としては妥当**であり、そのまま通ると「1 件も返らない絞り込み」が黙って出来上がるためである。
 * 値の正は state_spec の `states` と entity_spec の `enum([...])` であり、ここはその突合にすぎない。
 *
 * パスの解決そのものは path-resolve.ts に置き、Q3(隠しフィールドでの絞り込み)と共有する。
 */

import type { FieldDef, FieldType, SpecModel } from '../../model/types.js';
import { collectMachineStates, finiteValuesOfField } from '../../model/field-values.js';
import type { GuardExpr, Literal, PathRef } from '../../guard/ast.js';
import { placementHint } from '../../guard/placement.js';
import type { Finding, QueryContext, QueryVerifier } from '../verifier.js';
import { queryFinding } from '../verifier.js';
import type { QueryFilter, QuerySpec } from '../../model/query/types.js';
import { findEntitySpec } from '../../semantics/domain-lookup.js';
import { resolveFilterPath, type FilterOrigin } from '../../semantics/query-filter-path.js';

/** Q4: filters がガード式として妥当で、参照パスと状態名が解決できるかを検証する。 */
export const filterSyntaxVerifier: QueryVerifier = {
  id: 'Q4',
  title: '絞り込み式 — filters の文法・参照パス・状態名が解決できる',

  verify(input, ctx: QueryContext): Finding[] {
    const findings: Finding[] = [];
    for (const query of input.queries.queries) {
      for (const filter of query.filters) {
        findings.push(
          ...checkFilter(query, filter, input.domain, ctx, {
            entity: query.source,
            label: 'source',
          }),
        );
      }
      // 併読の filters も同じ規則で見る。違うのは起点(併読先のエンティティ)だけである。
      for (const include of query.includes) {
        const origin: FilterOrigin = {
          entity: include.entity,
          label: `includes.${include.entity}`,
        };
        for (const filter of include.filters) {
          findings.push(...checkFilter(query, filter, input.domain, ctx, origin));
        }
      }
    }
    return findings;
  },
};

/** 1 本の filters を検査する(パース → 参照パスの解決 → 状態名の突合)。 */
function checkFilter(
  query: QuerySpec,
  filter: QueryFilter,
  domain: SpecModel,
  ctx: QueryContext,
  origin: FilterOrigin,
): Finding[] {
  const parsed = ctx.guards.parse(filter.source);
  if (!parsed.ok) {
    return [
      queryFinding('Q4', {
        message: `${origin.label} の filters の式を解析できません: ${parsed.error.message}`,
        location: filter.location,
        suggestion:
          'ガード式の文法(比較 / in / contains を and・or・not でつなぐ形)に直す。' +
          '括弧・算術・関数呼び出しは書けない(domain-spec-writing.md §ガード式の文法)' +
          placementHint(parsed.error),
        counterexample: {
          query: query.name,
          filter: filter.source,
          offset: String(parsed.error.offset),
        },
      }),
    ];
  }

  const findings: Finding[] = [];
  for (const path of ctx.guards.collectPaths(parsed.expr)) {
    const resolved = resolveFilterPath(domain, query, path, origin);
    if (resolved.kind !== 'error') continue;
    findings.push(unresolvedFinding(query, filter, path.segments.join('.'), resolved.reason, origin));
  }
  findings.push(...checkStateValues(query, filter, parsed.expr, domain, origin));
  return findings;
}

/**
 * 比較の値を、左辺の**値域が閉じている**とき(state / enum / boolean)だけ宣言と突き合わせる。
 *
 * 値域が開いているフィールド(文字列・数値・日時・参照)は照合しようがないので何も見ない。
 * 右辺がパスの比較(`workshop.organizer_id == actor.id`)も対象外である。
 */
function checkStateValues(
  query: QuerySpec,
  filter: QueryFilter,
  expr: GuardExpr,
  domain: SpecModel,
  origin: FilterOrigin,
): Finding[] {
  const machineStates = collectMachineStates(domain);
  const findings: Finding[] = [];
  for (const node of collectValueNodes(expr)) {
    const resolved = resolveFilterPath(domain, query, node.path, origin);
    if (resolved.kind !== 'field') continue;
    const field = fieldOf(domain, resolved.entity, resolved.field);
    if (field === null) continue;
    const allowed = finiteValuesOfField(field.type, machineStates);
    if (allowed === null) continue; // 値域が開いている(または機械が引けない = V2 が指摘する)
    const unknown = node.values.map(literalText).filter((value) => !allowed.includes(value));
    if (unknown.length === 0) continue;
    findings.push(
      valueFinding(query, filter, origin, `${resolved.entity}.${resolved.field}`, field.type, {
        allowed,
        unknown,
      }),
    );
  }
  return findings;
}

/** 値域に無い値で絞り込んでいることの指摘。 */
function valueFinding(
  query: QuerySpec,
  filter: QueryFilter,
  origin: FilterOrigin,
  path: string,
  type: FieldType,
  values: { readonly allowed: readonly string[]; readonly unknown: readonly string[] },
): Finding {
  const source = valueSourceLabel(type);
  return queryFinding('Q4', {
    message:
      `${origin.label} の filters の ${path} に、` +
      `${source} に無い値があります: ${values.unknown.join(', ')}`,
    location: filter.location,
    suggestion:
      `${source} の値(${values.allowed.join(', ')})にある名前へ直す。` +
      '無い値との比較は式としては妥当なので、綴り違いは「1 件も返らない」形で表面化する',
    counterexample: {
      query: query.name,
      filter: filter.source,
      declared_by: source,
      unknown: values.unknown.join(', '),
    },
  });
}

/** 値域の出どころを人間に示す呼び名。 */
function valueSourceLabel(type: FieldType): string {
  if (type.kind === 'state') return `状態機械 ${type.machine}`;
  return type.kind === 'enum' ? 'enum 宣言' : 'boolean 型';
}

/** 値と突き合わせられる節(左辺のパスと、そこに並んだリテラル)。 */
interface ValueNode {
  readonly path: PathRef;
  readonly values: readonly Literal[];
}

/**
 * 式の中の「パスとリテラルの比較」を集める。
 * `in` / `not in`(not の下の in)と、右辺がリテラルの `==` / `!=` の両方が対象になる。
 */
function collectValueNodes(expr: GuardExpr): ValueNode[] {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return [...collectValueNodes(expr.left), ...collectValueNodes(expr.right)];
    case 'not':
      return collectValueNodes(expr.operand);
    case 'in':
      return [{ path: expr.path, values: expr.values }];
    case 'compare':
      return expr.rhs.kind === 'path' ? [] : [{ path: expr.path, values: [expr.rhs] }];
    default:
      return [];
  }
}

/** リテラルを比較用の文字列にする(数値は state 名になり得ないが、指摘に載せるため文字列化する)。 */
function literalText(value: Literal): string {
  return value.kind === 'number' ? String(value.value) : value.value;
}

/** エンティティのフィールド定義を引く。 */
function fieldOf(domain: SpecModel, entity: string, field: string): FieldDef | null {
  const spec = findEntitySpec(domain, entity);
  if (spec === null) return null;
  return spec.fields.find((candidate) => candidate.name === field) ?? null;
}

/** 解決できないパスを含む式の指摘。 */
function unresolvedFinding(
  query: QuerySpec,
  filter: QueryFilter,
  path: string,
  reason: string,
  origin: FilterOrigin,
): Finding {
  return queryFinding('Q4', {
    message: `${origin.label} の filters の ${path} を解決できません: ${reason}`,
    location: filter.location,
    suggestion:
      `${origin.label}(${origin.entity})のフィールド・entity_spec の context で辿れるパス・actor・now・` +
      'param.{name} の範囲で書く。実行のたびに変わる値は params に宣言してから param.{name} で参照する',
    counterexample: { query: query.name, filter: filter.source, path },
  });
}
