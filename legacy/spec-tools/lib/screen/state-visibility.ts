/**
 * 「状態機械のある状態を、人間が読み取り経路から見られるか」の探索を 1 箇所に集める。
 *
 * S14(状態の可視性)の判定そのものと、L2 網羅台帳(状態の行)の「可視性」欄の生成が
 * 同じ探索(候補クエリ → その状態を弾かないか → それを読む画面 → その画面にロールが入れるか)
 * を必要とするため、検査(verifiers/)と生成(generate/render/)の両方から呼べる
 * ここに置く(判定はしない側 = L2 も、判定する側 = S14 も、同じ母集合を見る)。
 */

import type { GuardExpr, GuardServices } from '../guard/ast.js';
import type { SpecModel } from '../model/types.js';
import type { AuthGateDecl } from '../model/auth/types.js';
import type { QuerySpec } from '../model/query/types.js';
import type { ScreenSpec } from '../model/screen/types.js';
import { admitsState, andAll } from '../semantics/state-admit.js';
import { roleCanEnter } from '../relations/screen-reachability/index.js';

/** その状態を見せている経路の実例 1 つ(クエリ・画面・ロールの組)。 */
export interface StateVisibilityWitness {
  readonly query: QuerySpec;
  readonly screen: ScreenSpec;
  readonly role: string;
}

/**
 * 状態機械のある状態を見せる(クエリ・画面・ロール)の組をすべて探す。
 *
 * 母集合は「その集約を主エンティティとするクエリ」(`source` が対象の entity / aggregate と
 * 一致するもの。併読 `includes` は対象外 — screen-spec-writing.md §S14)。
 *
 * @param guards ガード式の共有サービス
 * @param domain ドメイン仕様全体
 * @param queries query_spec の全件
 * @param screens screen_spec の全件(chrome 展開済みのもの)
 * @param gates auth_spec の `gates`
 * @param anonymousRole 匿名ロールの ID
 * @param aggregate 対象の集約(`SpecModel.aggregates` のキー)
 * @param entity `aggregate` の entity 名
 * @param stateField 状態フィールド名
 * @param state 見えるかを判定する状態 ID
 * @returns 見つかった実例の一覧(0 件なら「見せる経路が無い」)
 */
export function findStateVisibility(
  guards: GuardServices,
  domain: SpecModel,
  queries: readonly QuerySpec[],
  screens: readonly ScreenSpec[],
  gates: readonly AuthGateDecl[],
  anonymousRole: string | undefined,
  aggregate: string,
  entity: string,
  stateField: string,
  state: string,
): readonly StateVisibilityWitness[] {
  const witnesses: StateVisibilityWitness[] = [];
  for (const query of queries) {
    if (query.source !== entity && query.source !== aggregate) continue;
    const expr = filtersExpr(guards, query);
    if (!admitsState(guards, domain, expr, query.source, aggregate, entity, stateField, state)) continue;

    const readers = screens.filter((screen) => screen.reads.some((read) => read.id === query.id));
    for (const screen of readers) {
      for (const role of query.forRoles) {
        if (roleCanEnter(domain, gates, screen, role, anonymousRole)) {
          witnesses.push({ query, screen, role });
        }
      }
    }
  }
  return witnesses;
}

/** query_spec の `filters` を 1 つの式に畳み込む(パースに失敗した個々の filter は無視する)。 */
function filtersExpr(guards: GuardServices, query: QuerySpec): GuardExpr | undefined {
  const parsed: GuardExpr[] = [];
  for (const filter of query.filters) {
    const result = guards.parse(filter.source);
    if (result.ok) parsed.push(result.expr);
  }
  return andAll(parsed);
}
