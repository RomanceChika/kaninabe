/**
 * `reads[].filters` の左辺(**境界の列がどこにあるか**)の解決。
 *
 * 左辺は対象の列(`{列}`)か、`context` で辿れる親の列(`{集約}.{列}`)である。親へ届く道は
 * `binding` / `when` と同じ探索(`refPathTo`。`context:` の宣言・2 段まで・経路が 2 通りあれば断る)で
 * 決める —— 検査(V2 / V20)と生成器(RLS の述語・world)が別の規則で道を選ぶと、「verify は緑なのに
 * 別の行の列で絞っている」という最も気づきにくい穴になる(ref-path.ts §道は `context:` の宣言が決める)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef, ReadFilter, SpecModel } from './types.js';
import { findEntity } from './path-hops.js';
import { refColumn, refPathTo } from './ref-path.js';

/** 左辺の解決の結果(境界の列を持つ集約・そこへの参照列の並び・列の定義)。 */
export interface ResolvedReadFilter {
  /** 境界の列を持つ集約(エンティティ名。自集約ならその名前)。 */
  readonly entity: string;
  /**
   * 対象の行から境界の列を持つ行へ辿る**参照列**の並び(根から順。自集約の列なら空)。
   * `via[0]` は対象の行の列、`via[i]` は道の `i - 1` 段目の集約の列である。
   */
  readonly via: readonly string[];
  /** 道の各段の集約(根から目的地の順。自集約の列なら空)。 */
  readonly route: readonly string[];
  /** 境界の列の定義。 */
  readonly field: FieldDef;
}

/** 左辺を解決できなかった理由(検査器はこれを Finding の文面に写す)。 */
export type ReadFilterProblem = 'unknown_entity' | 'unreachable' | 'unknown_field';

/** 左辺の解決(成功か、理由)。 */
export type ReadFilterResolution =
  | { readonly ok: true; readonly resolved: ResolvedReadFilter }
  | { readonly ok: false; readonly problem: ReadFilterProblem };

/**
 * `filters` の 1 本の左辺を解決する。
 *
 * @param domain ドメイン仕様
 * @param owner その access_spec の対象エンティティ
 * @param filter 境界の宣言 1 本
 * @returns 境界の列を持つ集約・道・列の定義、または解決できない理由
 */
export function resolveReadFilter(domain: SpecModel, owner: string, filter: ReadFilter): ReadFilterResolution {
  const source = findEntity(domain, owner);
  if (source === null) return { ok: false, problem: 'unknown_entity' };
  if (filter.entity === undefined) {
    const own = source.fields.find((candidate) => candidate.name === filter.field);
    return own === undefined
      ? { ok: false, problem: 'unknown_field' }
      : { ok: true, resolved: { entity: source.entity, via: [], route: [], field: own } };
  }
  const target = findEntity(domain, filter.entity);
  if (target === null) return { ok: false, problem: 'unknown_entity' };
  const route = target.entity === source.entity ? null : refPathTo(domain, source.entity, target.entity);
  const via = route === null ? null : refColumns(domain, source.entity, route);
  if (route === null || via === null) return { ok: false, problem: 'unreachable' };
  const field = target.fields.find((candidate) => candidate.name === filter.field);
  if (field === undefined) return { ok: false, problem: 'unknown_field' };
  return { ok: true, resolved: { entity: target.entity, via, route, field } };
}

/**
 * 境界の左辺を人が読む綴り(`{列}` / `{集約}.{列}`)。
 *
 * @param filter 境界の宣言 1 本
 * @returns 仕様に書いたとおりの左辺
 */
export function readFilterPath(filter: ReadFilter): string {
  return filter.entity === undefined ? filter.field : `${filter.entity}.${filter.field}`;
}

/** 道に沿った参照列の並び(どこかで結べなければ null)。 */
function refColumns(domain: SpecModel, from: string, route: readonly string[]): readonly string[] | null {
  const columns: string[] = [];
  let current = from;
  for (const step of route) {
    const column = refColumn(domain, current, step);
    if (column === null) return null;
    columns.push(column);
    current = step;
  }
  return columns;
}
