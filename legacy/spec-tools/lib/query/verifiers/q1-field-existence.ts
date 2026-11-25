/**
 * Q1 フィールドの実在チェック。
 *
 * query-spec-writing.md の Q1:「`source` が entity_spec にあり、`projection` / `sort` /
 * `params[].ref` / `includes[].projection` / `includes[].sort` のフィールドが
 * 対象のエンティティに実在する」。
 *
 * クエリが返すもの・並べるもの・受け取るものは entity_spec が正であり(PRIN-0007)、
 * 接地していない名前を書くと生成 zod スキーマとも RLS とも噛み合わない読み取り経路ができる。
 * `filters` の中に現れるパスの解決は式の検査と不可分なので Q4 が担う。
 */

import type { SpecModel } from '../../model/types.js';
import type { Finding, QueryVerifier } from '../verifier.js';
import { queryFinding } from '../verifier.js';
import type { QuerySpec } from '../../model/query/types.js';
import { findEntitySpec } from '../../semantics/domain-lookup.js';

/** Q1: 宣言されたフィールドが entity_spec に実在するかを検証する。 */
export const fieldExistenceVerifier: QueryVerifier = {
  id: 'Q1',
  title: 'フィールドの実在 — source / projection / sort / params / includes が entity_spec にある',

  verify(input): Finding[] {
    return input.queries.queries.flatMap((query) => checkQuery(query, input.domain));
  },
};

/** 1 つの query_spec を検査する。source が引けなければそこで打ち切る。 */
function checkQuery(query: QuerySpec, domain: SpecModel): Finding[] {
  if (findEntitySpec(domain, query.source) === null) {
    return [
      queryFinding('Q1', {
        message: `source の ${query.source} は specs/domain にありません`,
        location: query.location,
        suggestion: `specs/domain/${query.source}/entity.md を作るか、source を実在するエンティティ名に直す`,
        counterexample: { query: query.name, source: query.source },
      }),
    ];
  }

  return [
    ...query.projection.map((f) =>
      checkField(query, domain, query.source, f.name, 'projection', f.location),
    ),
    ...query.sort.map((key) =>
      checkField(query, domain, query.source, key.field, 'sort', key.location),
    ),
    ...query.params.map((param) => checkParam(query, domain, param)),
    ...query.includes.flatMap((include) =>
      // include 先が存在しない場合は Q5 が指摘するので、ここでは重ねて言わない
      findEntitySpec(domain, include.entity) === null
        ? []
        : [
            ...include.projection.map((f) =>
              checkField(
                query,
                domain,
                include.entity,
                f.name,
                `includes.${include.entity}.projection`,
                f.location,
              ),
            ),
            ...include.sort.map((key) =>
              checkField(
                query,
                domain,
                include.entity,
                key.field,
                `includes.${include.entity}.sort`,
                key.location,
              ),
            ),
          ],
    ),
  ].filter((finding): finding is Finding => finding !== null);
}

/** `params[].ref` の指すエンティティ・フィールドを引き当てる。 */
function checkParam(
  query: QuerySpec,
  domain: SpecModel,
  param: QuerySpec['params'][number],
): Finding | null {
  if (findEntitySpec(domain, param.ref.entity) === null) {
    return queryFinding('Q1', {
      message: `params ${param.name} の ref が指すエンティティ ${param.ref.entity} は specs/domain にありません`,
      location: param.location,
      suggestion: `ref を実在するエンティティの "{entity}.{field}" に直す(型の導出元になる)`,
      counterexample: { query: query.name, param: param.name, ref: param.ref.raw },
    });
  }
  return checkField(
    query,
    domain,
    param.ref.entity,
    param.ref.field,
    `params.${param.name}.ref`,
    param.location,
  );
}

/** 1 つのフィールド参照を引き当てる。実在すれば null。 */
function checkField(
  query: QuerySpec,
  domain: SpecModel,
  entity: string,
  field: string,
  where: string,
  location: Finding['location'],
): Finding | null {
  const spec = findEntitySpec(domain, entity);
  if (spec === null) return null;
  if (spec.fields.some((candidate) => candidate.name === field)) return null;

  const known = spec.fields.map((candidate) => candidate.name);
  return queryFinding('Q1', {
    message: `${where} の ${field} は ${spec.entity} の entity_spec に存在しないフィールドです`,
    location,
    suggestion:
      `${spec.entity} の entity.md の fields に ${field} を追加するか、` +
      `既存のフィールド(${known.join(', ')})へ直す`,
    counterexample: { query: query.name, field, known_fields: known.join(', ') },
  });
}
