import { expect } from 'vitest';
import { neutralOf } from './neutral.mjs';
import { sweep } from './sweep.mjs';
import type { ContractDriver, ContractWorld, Situation } from './types.mjs';

/**
 * 契約テスト ③ **通信の失敗**。
 *
 * 接続の前に落ちた(接続拒否)なら `not_committed`、送ったあとに切られた・時間切れになったなら `unknown`。
 * 接続拒否と切断が混ざる(独立した試みのどれかは送れたかもしれない)なら `unknown`。
 * どちらも**投げずに結果として返り**(投げるのは実行器の 1 か所)、元の失敗は `cause` に残る
 * (契約の欄にはメッセージを出さないが、握りつぶさない)。
 */

/** この群が起こす状況。 */
export const TRANSPORT_SITUATIONS: readonly Situation[] = ['refused', 'dropped', 'timed_out', 'mixed_transport'];

/**
 * 通信の失敗の群を全ドライバに当てる。
 *
 * @param drivers - 当てる adapter
 * @param world - 製品が渡す世界
 * @returns 歩いた回数
 */
export function contractTransport(drivers: readonly ContractDriver[], world: ContractWorld): Promise<number> {
  return sweep(drivers, world, TRANSPORT_SITUATIONS, ['rpc', 'usecase'], ({ outcome, scenario, label }) => {
    expect(neutralOf(outcome), label).toEqual(scenario.expected);
    expect(outcome.kind === 'transport_failed' && outcome.cause !== undefined, `${label}: 元の失敗(cause)を捨てない`).toBe(true);
  });
}
