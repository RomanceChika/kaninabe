/**
 * 遷移 `T` の (from状態, byロール) の組ごとに、それを実行できて届く画面を探す共通探索。
 *
 * S13(検証。届かなければエラー)と L2 網羅台帳(生成。判定はせず「どこまで届くか」を出す)が
 * 同じ探索を共有する — 判定する側と判定しない側が違う探索を書くと、片方だけが直る事故が起きる。
 * 以前は `lib/screen/transition-reach.ts` にいて、ユースケースの導出(`lib/usecase/derive.ts`)が同じ
 * ディレクトリの画面の部品を読んでいた(関係の層 `lib/relations/screen-reachability/` へ移した)。
 */

import type { GuardServices } from '../../guard/ast.js';
import type { SpecModel } from '../../model/types.js';
import type { ScreenSpec } from '../../model/screen/types.js';
import type { EventEntry } from '../../semantics/domain-index.js';
import { entityNameOfAggregate, isHumanRole } from '../../semantics/domain-index.js';
import { admitsState, preconditionExpr, stateFieldOf } from '../../semantics/state-admit.js';
import type { ScreenReach, StateRoleReach } from './types.js';

/** 探索が読む道具(`ScreenReachability` が自分の入力から用意する)。 */
export interface StateRoleReachTools {
  readonly domain: SpecModel;
  /** 内部実行ロールの ID(人間ロールの判定に使う)。 */
  readonly systemRole: string | undefined;
  /** 操作 ID(正規化済み)→ その操作を宣言する画面。 */
  readonly exposedBy: ReadonlyMap<string, readonly ScreenSpec[]>;
  /** ロールが `entry_point` から届く画面(`ReachStart` が `entry-points`)。 */
  readonly entryReach: (role: string) => ScreenReach;
  /** ロールがその画面に入れるか。 */
  readonly canEnter: (screen: ScreenSpec, role: string) => boolean;
}

/**
 * 遷移 `entry` の人間が実行できる (state, role) の組それぞれについて、届く画面を探す。
 *
 * 満たす条件は screen-spec-writing.md の S13(a)〜(d) と同じ:
 * 画面が `T` を発火する(`exposedBy` の母集合)・ロールが入れる・precondition が状態を弾かない・
 * ロールの入口画面から届く。状態フィールドを引けない機械(構造上ありえない)は空配列を返す。
 *
 * @param tools 入場判定・入口からの到達・操作を出す画面の索引
 * @param guards ガード式の共有サービス
 * @param entry 対象の遷移(集約・機械・イベントの組)
 * @returns (state, role) ごとの到達結果(state × by の人間ロールの直積)
 */
export function findStateRoleReach(
  tools: StateRoleReachTools,
  guards: GuardServices,
  entry: EventEntry,
): readonly StateRoleReach[] {
  const { domain } = tools;
  const stateField = stateFieldOf(domain, entry.aggregate, entry.machine.machine);
  if (stateField === undefined) return [];
  const entityName = entityNameOfAggregate(domain, entry.aggregate);
  const candidates = tools.exposedBy.get(entry.id) ?? [];

  const reachCache = new Map<string, ReadonlySet<string>>();
  const reachFor = (role: string): ReadonlySet<string> => {
    const cached = reachCache.get(role);
    if (cached !== undefined) return cached;
    const computed = tools.entryReach(role).screenIds;
    reachCache.set(role, computed);
    return computed;
  };

  const results: StateRoleReach[] = [];
  for (const role of entry.event.by) {
    if (!isHumanRole(role, tools.systemRole)) continue;
    const reach = reachFor(role);
    for (const state of entry.event.from) {
      const screen = candidates.find(
        (candidate) =>
          reach.has(candidate.id) &&
          tools.canEnter(candidate, role) &&
          admitsState(
            guards,
            domain,
            preconditionExpr(guards, candidate),
            candidate.subject?.entity,
            entry.aggregate,
            entityName,
            stateField,
            state,
          ),
      );
      results.push({ role, state, screen });
    }
  }
  return results;
}
