/**
 * 「その集約から `context` の連鎖でどのエンティティへ届くか」を答える純粋モジュール。
 *
 * `v11-role-grounding.ts` が使う。
 *
 * 段の上限も経路の探し方も `lib/model/path-hops.ts`(ガード式のパス解決が使う規則)に委ねる
 * —— 届く先が食い違うと、「V11 は通るのにパスが解決できない」(またはその逆)という宣言の穴が
 * できる。**経路が 2 通りあるときに断るかどうか**も同じ規則を共有する(束 ⑲-2a)。
 */

import type { EntitySpec, SpecModel } from '../../model/types.js';
import { contextRoutes, MAX_CONTEXT_HOPS } from '../../model/path-hops.js';

/**
 * その集約から相手へ `context` を辿る**最短の経路の全体**。
 *
 * 0 本なら届かない。2 本以上なら**どの行を指すかが決まらない**(中継が違えば指す行も違う)。
 *
 * @param model ドメイン仕様全体
 * @param aggregate 起点の集約名(エンティティ名でもよい)
 * @param target 届きたいエンティティ名
 * @returns 辿るエンティティ名の並びの全体(届かなければ空)
 */
export function contextRoutesTo(
  model: SpecModel,
  aggregate: string,
  target: string,
): readonly (readonly string[])[] {
  const spec = entitySpecOf(model, aggregate);
  if (spec === undefined) return [];
  return contextRoutes(model, spec, target, MAX_CONTEXT_HOPS);
}

/**
 * その集約から `context` の連鎖で届くエンティティ名。
 *
 * 1 段しか見ていなかったあいだ、木の各段に写しの列とそれを埋めるトリガと一致を守る
 * 不変条件が要っていた(束 ⑱ の実測 → 束 ⑲-2a)。
 *
 * @param model ドメイン仕様全体
 * @param aggregate 起点の集約名(エンティティ名でもよい)
 * @returns 届くエンティティ名の集合(起点自身は含まない)
 */
export function reachableEntities(model: SpecModel, aggregate: string): ReadonlySet<string> {
  const reached = new Set<string>();
  let frontier = [aggregate];
  for (let hop = 0; hop < MAX_CONTEXT_HOPS; hop += 1) {
    const next: string[] = [];
    for (const name of frontier) {
      for (const target of Object.keys(entitySpecOf(model, name)?.context ?? {})) {
        if (reached.has(target)) continue;
        reached.add(target);
        next.push(target);
      }
    }
    frontier = next;
  }
  return reached;
}

/** エンティティ名(または集約名)から entity_spec を引く。 */
function entitySpecOf(model: SpecModel, name: string): EntitySpec | undefined {
  for (const [aggregate, specs] of model.aggregates) {
    const spec = specs.entity;
    if (spec === undefined) continue;
    if (spec.entity === name || aggregate === name) return spec;
  }
  return undefined;
}
