import { expect } from 'vitest';
import { sweep } from './sweep.mjs';
import type { ContractDriver, ContractWorld, Situation } from './types.mjs';

/**
 * 契約テスト ④ **再試行しない**。
 *
 * 口は 1 回の呼び出しで通信路に**ちょうど 1 回**しか要求を出さない。とくにコミットが不明な失敗
 * (`dropped` / `timed_out`)のあとの自動の再試行は、遷移・編集・削除では**自分の前回の成功が競合に見える**ので
 * してはならない(再試行の方針は配線側のラッパーに置き、既定は再試行なし)。接続の前に落ちた(`refused`)も、
 * DB が断った失敗も、書けた場合も、同じく 1 回である。
 */

/** この群が起こす状況(書けた・断られた・通信が失敗した、の全部)。 */
export const NO_RETRY_SITUATIONS: readonly Situation[] = [
  'rows',
  'document',
  'zero_rows',
  'forbidden',
  'guard_unsatisfied',
  'conflict',
  'invariant_violated',
  'unexpected',
  'refused',
  'dropped',
  'timed_out',
  'mixed_transport',
];

/**
 * 再試行しないことの群を全ドライバに当てる。
 *
 * @param drivers - 当てる adapter
 * @param world - 製品が渡す世界
 * @returns 歩いた回数
 */
export function contractNoRetry(drivers: readonly ContractDriver[], world: ContractWorld): Promise<number> {
  return sweep(drivers, world, NO_RETRY_SITUATIONS, ['rpc', 'usecase'], ({ channel, scenario, label }) => {
    const sent = channel.sent();
    expect(sent, `${label}: 通信路への要求はちょうど 1 回`).toHaveLength(1);
    expect(sent[0]?.rpc, `${label}: 呼んだ RPC`).toBe(scenario.call.rpc);
  });
}
