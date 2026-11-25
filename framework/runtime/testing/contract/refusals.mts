import { expect } from 'vitest';
import { neutralOf } from './neutral.mjs';
import { sweep } from './sweep.mjs';
import type { ContractDriver, ContractWorld, Situation } from './types.mjs';

/**
 * 契約テスト ② **拒否の分類**。
 *
 * DB が断ったとき、adapter が違っても**同じ種類**の結果になる: 業務の拒否 3 種(`forbidden` / `guard_unsatisfied` /
 * `conflict`。落ちた操作の ID つき)・不変条件違反(制約名が不変条件に引ける)・0 行(`conflict`。操作の ID は空)・
 * 仕様に無い理由の失敗(`unknown_failure`。SQLSTATE を載せ、コミットは `commitOfDbError` の表 —— `P0001` は txn ごと戻るので `not_committed`)。
 *
 * 期待は世界(`ContractWorld.scenario`)が中立の結果で言い、全ドライバがそれと一致することを見る
 * (ドライバ同士の一致は `sweep` が見る)。
 */

/** この群が起こす状況(DB が答えた失敗と、エラー無しの 0 行)。 */
export const REFUSAL_SITUATIONS: readonly Situation[] = [
  'forbidden',
  'guard_unsatisfied',
  'conflict',
  'invariant_violated',
  'zero_rows',
  'unexpected',
];

/**
 * 拒否の分類の群を全ドライバに当てる。
 *
 * @param drivers - 当てる adapter
 * @param world - 製品が渡す世界
 * @returns 歩いた回数
 */
export function contractRefusals(drivers: readonly ContractDriver[], world: ContractWorld): Promise<number> {
  return sweep(drivers, world, REFUSAL_SITUATIONS, ['rpc', 'usecase'], ({ outcome, scenario, label }) => {
    expect(neutralOf(outcome), label).toEqual(scenario.expected);
  });
}
