/**
 * `filters` に現れるパスを、どのエンティティのどのフィールドを指すかまで解決する純粋モジュール。
 *
 * 解決規則はガード式(domain-spec-writing.md §ガード式の文法)と同じで、
 * query_spec の事情として `param.{name}`(実行時入力)を足したものになる。
 *
 * - `actor` / `now`      … 予約語。解決対象を持たない
 * - `param.{name}`       … `params` に宣言された実行時入力(**query_spec だけの語彙**)
 * - `{field}`            … source 自身のフィールド(裸のフィールド名)
 * - `{source}.{field}`   … source 自身のフィールド(完全形)
 * - `{other}.{field}`    … source の entity_spec の `context` で解決できるエンティティのフィールド
 *
 * 下の 4 つは仕様種に依らないので lib/model/path-resolve.ts が持ち、ここは
 * `param.{name}` の解決だけを足して委譲する(同じ解決規則を 2 つ書かないため。
 * screen_spec の `precondition` も同じ核を使う)。
 *
 * 解決結果は 2 つの検査が共有する。Q4 は解決できないパスを違反として報告し、
 * Q3 は解決できたパスを「隠しフィールドで絞り込んでいないか」の検査対象にする
 * (隠したフィールドで絞れば、件数や並び順から中身が漏れるため)。
 *
 * **置き場**: 事実の層(`lib/semantics/`)。索引の要求の導出(`lib/relations/index-requirements/`)も
 * 同じ解決を使うが、関係の層は種類のディレクトリ(`lib/query/`)の解析を読めない —— モデルだけを引数に
 * 取る葉なので、ここに置いて両方が下から読む。
 */

import type { PathRef } from '../guard/ast.js';
import type { SpecModel } from '../model/types.js';
import { resolveEntityPath, type ResolvedPath } from '../model/path-resolve.js';
import type { QuerySpec } from '../model/query/types.js';

export type { ResolvedPath } from '../model/path-resolve.js';

/** 実行時入力を指すルート。 */
const PARAM_ROOT = 'param';

/**
 * 解決の起点。既定は source だが、併読(`includes`)の filters は併読先が起点になる。
 */
export interface FilterOrigin {
  /** 起点のエンティティ名。 */
  readonly entity: string;
  /** 人間に示すときの呼び名(例: "source" / "includes.entry")。 */
  readonly label: string;
}

/**
 * `filters` のパス 1 本を解決する。
 *
 * @param model ドメイン仕様全体(context の解決に使う)
 * @param query 解決の文脈になる query_spec(source と params を持つ)
 * @param path 解決するパス
 * @param origin 解決の起点(省略時は source)。`param.{name}` はどちらの起点でも同じ params を見る
 * @returns 解決結果
 */
export function resolveFilterPath(
  model: SpecModel,
  query: QuerySpec,
  path: PathRef,
  origin: FilterOrigin = { entity: query.source, label: 'source' },
): ResolvedPath {
  const root = path.segments[0];
  if (root === undefined) return { kind: 'error', reason: '空のパスです' };
  if (root === PARAM_ROOT) return resolveParam(query, path);
  return resolveEntityPath(model, origin.entity, path, origin.label);
}

/** `param.{name}` を params の宣言に接地する。 */
function resolveParam(query: QuerySpec, path: PathRef): ResolvedPath {
  const name = path.segments[1];
  if (name === undefined || path.segments.length > 2) {
    return { kind: 'error', reason: '実行時入力は param.{name} の形で参照します' };
  }
  if (query.params.some((param) => param.name === name)) return { kind: 'reserved' };
  return {
    kind: 'error',
    reason: `params に ${name} の宣言がありません`,
  };
}
