/**
 * `kind: table` / `detail` の部品が**出せる欄**(読みの projection と、1 件に決まる併読の欄)の導出。
 *
 * S18(`shows` の欄が実在するか・ref でないか)と生成器(表・詳細の列 / 項目)が**同じ導出**を見る —
 * 導出が 2 か所に別々にあると、検査が通した欄を生成器が出せない(あるいは逆)食い違いが起きる。
 * 置き場をここ 1 か所にする。純粋関数で、**アプリの語彙は 1 語も持たない**。
 *
 * 出せる欄は 2 種類ある。
 *   - 読みの `projection` の欄(`{欄}`)。
 *   - 併読(`includes`)の `projection` の欄(`{併読名}.{欄}`)。**併読名は併読先のエンティティ名**である。
 *     出せるのは**1 件に決まる併読**(読みの source が、その併読先への `ref` の欄を持つ — 催し → 会場のように
 *     「この行はあの 1 件を指す」)だけ。枠 → 参加者のように 1 行に複数が付く併読は、1 つの欄に収まらないので出せない。
 */

import type { SpecModel } from '../model/types.js';
import type { QuerySpec } from '../model/query/types.js';
import { findEntityFields, findField } from '../semantics/domain-index.js';

/** 部品が出せる欄 1 つ。 */
export interface ShowCandidate {
  /** `shows` に書く綴り(`{欄}` か `{併読名}.{欄}`)。 */
  readonly path: string;
  /** 欄を持つエンティティ(読みの source か併読先)。 */
  readonly entity: string;
  /** 欄の名前。 */
  readonly field: string;
  /** 併読の欄なら併読名(併読先のエンティティ名)。読みの欄は無し。 */
  readonly include?: string;
}

/**
 * 読みの source が、`entity` への `ref` の欄を持つか(= その併読は 1 行に 1 件だけ付く)。
 *
 * @param domain ドメイン仕様
 * @param source 読みの source のエンティティ名
 * @param entity 併読先のエンティティ名
 * @returns 持つなら true
 */
function pointsAt(domain: SpecModel, source: string, entity: string): boolean {
  return (findEntityFields(domain, source) ?? []).some(
    (field) => field.type.kind === 'ref' && field.type.entity === entity,
  );
}

/**
 * 読みが出せる欄の全部(宣言順: projection → 1 件に決まる併読の projection)。
 *
 * @param query 読み(query_spec)
 * @param domain ドメイン仕様
 * @returns 出せる欄
 */
export function showCandidates(query: QuerySpec, domain: SpecModel): readonly ShowCandidate[] {
  const own = query.projection.map((field) => ({ path: field.name, entity: query.source, field: field.name }));
  const included = query.includes
    .filter((include) => pointsAt(domain, query.source, include.entity))
    .flatMap((include) =>
      include.projection.map((field) => ({
        path: `${include.entity}.${field.name}`,
        entity: include.entity,
        field: field.name,
        include: include.entity,
      })),
    );
  return [...own, ...included];
}

/**
 * 併読の欄の見出しに添える**役割**(読みの source が併読先を指す `ref` の欄)。
 *
 * 「メンバーの表示名」では、問い合わせの対応者なのか発行者なのかが読めない。併読先を指す `ref` の欄が**ちょうど 1 つ**あり、
 * その欄の `label`(対応者・発行者)が併読先の集約の `label`(メンバー)と**違う**ときは、役割の名前を見出しの前に付ける
 * (`対応者の表示名`)。同じとき(催しの `venue_id` = 会場 → 会場名)は付けない — 会場の名前が「会場の会場名」になるだけである。
 * 指す欄が複数あれば(誰の表示名か決まらない)付けない。**アプリの語彙は 1 語も持たない**。
 *
 * @param domain ドメイン仕様
 * @param source 読みの source のエンティティ名
 * @param entity 併読先のエンティティ名
 * @returns 役割の欄の名前(付けないときは undefined)
 */
export function includeRoleField(domain: SpecModel, source: string, entity: string): string | undefined {
  const refs = (findEntityFields(domain, source) ?? []).filter(
    (field) => field.type.kind === 'ref' && field.type.entity === entity,
  );
  const only = refs.length === 1 ? refs[0] : undefined;
  if (only?.label === undefined) return undefined;
  const entityLabel = [...domain.aggregates.values()].find((specs) => specs.entity?.entity === entity)?.entity?.label;
  return entityLabel === undefined || entityLabel === only.label ? undefined : only.name;
}

/**
 * 欄が `ref`(他の行を指す id)か。表・詳細は ref の欄を出さない(行に入っているのは id だけで、人が読める値ではない
 * — 併読の欄を `{併読名}.{欄}` で書く)。
 *
 * @param domain ドメイン仕様
 * @param candidate 出せる欄
 * @returns ref なら true
 */
export function isRefField(domain: SpecModel, candidate: ShowCandidate): boolean {
  return findField(domain, candidate.entity, candidate.field)?.type.kind === 'ref';
}

/**
 * `shows` を省略したときに出す欄(**id と ref の欄を除く全欄**。宣言順)。
 *
 * @param query 読み(query_spec)
 * @param domain ドメイン仕様
 * @returns 既定で出す欄
 */
export function defaultShows(query: QuerySpec, domain: SpecModel): readonly ShowCandidate[] {
  return showCandidates(query, domain).filter(
    (candidate) => candidate.field !== 'id' && !isRefField(domain, candidate),
  );
}

/**
 * 部品が実際に出す欄(`shows` の宣言順。省略なら既定)。実在しない欄は黙って落とす — 実在は S18 が見るので、
 * 検査を通った仕様では落ちない(生成器は throw しない)。
 *
 * @param query 読み(query_spec)
 * @param domain ドメイン仕様
 * @param shows 部品の `shows`(書かれた綴りの並び。省略は undefined)
 * @returns 出す欄
 */
export function shownFields(
  query: QuerySpec,
  domain: SpecModel,
  shows: readonly string[] | undefined,
): readonly ShowCandidate[] {
  if (shows === undefined) return defaultShows(query, domain);
  const all = showCandidates(query, domain);
  return shows.flatMap((path) => all.filter((candidate) => candidate.path === path));
}
