import { expect } from 'vitest';
import { neutralOf, ran, runCall } from './neutral.mjs';
import { sweep } from './sweep.mjs';
import type { Call, ContractDriver, ContractWorld, Scenario } from './types.mjs';

/**
 * 契約テスト ⑤ **受領**。
 *
 * 書けたとき、口が返す受領は次を約束する(adapter が違っても同じ):
 *
 * - `outbox` は**常に `unknown`**: 発火の実体は RPC の本体の中にあり、戻り値から「今回積んだ」を証明できない。
 *   同じ呼び出しをもう一度流して(再送)も `unknown` のまま(「積んだ」「積んでいない」を戻り値から区別しない)。
 * - `requestedEffects`: 単発の定型 RPC は引数 `p_effects` の**写し**(同じ配列の実体を共有しない)・
 *   効果を引数に載せない呼び方(`tracksEffects: false`)と保存点の複合 RPC・受信口は `null`(**追っていない**。
 *   空の配列は「積まなかった」と読めてしまうので使わない)。
 * - 戻り値の形: 定型 RPC は行の列(`rows`)・複合 RPC は jsonb 1 つ(`document`)。
 */

/**
 * 受領の群を全ドライバに当てる。
 *
 * @param drivers - 当てる adapter
 * @param world - 製品が渡す世界
 * @returns 歩いた回数
 */
export async function contractReceipt(drivers: readonly ContractDriver[], world: ContractWorld): Promise<number> {
  const written = await sweep(drivers, world, ['rows', 'document'], ['rpc', 'usecase'], ({ outcome, scenario, label }) => {
    expect(neutralOf(outcome), label).toEqual(scenario.expected);
    expect(outcome.kind, label).toBe('saved');
    if (outcome.kind !== 'saved') return;
    expect(outcome.receipt.outbox, `${label}: outbox は常に unknown`).toBe('unknown');
    expectRequestedEffects(scenario.call, outcome.receipt.requestedEffects, label);
  });
  return written + (await untracked(drivers, world)) + (await resent(drivers, world));
}

/** 受領の `requestedEffects` が、呼び方から決まる値になっていること。 */
function expectRequestedEffects(call: Call, requested: readonly string[] | null, label: string): void {
  if (call.port === 'usecase' || call.options?.tracksEffects === false) {
    expect(requested, `${label}: 効果を追わない呼び出しは null(空の配列にしない)`).toBeNull();
    return;
  }
  const sent = call.args['p_effects'];
  expect(requested, `${label}: 要求した効果の写し`).toEqual(Array.isArray(sent) ? sent : []);
  expect(requested, `${label}: 引数の配列の実体を共有しない`).not.toBe(sent);
}

/** 定型 RPC の `rows` の呼び出しを、効果を追わない呼び方に直した場面にする(定型 RPC でなければ `null`)。 */
function untrackedOf(base: Scenario | null): Scenario | null {
  if (base === null || base.call.port !== 'rpc' || base.expected.kind !== 'saved') return null;
  const call: Call = { ...base.call, options: { tracksEffects: false } };
  return { call, expected: { ...base.expected, requestedEffects: null } };
}

/** 効果を追わない呼び方(受信口の RPC の呼び方)では、受領の `requestedEffects` は `null` になる。 */
async function untracked(drivers: readonly ContractDriver[], world: ContractWorld): Promise<number> {
  let visits = 0;
  for (const driver of drivers) {
    const scenario = untrackedOf(world.scenario('rows', 'rpc'));
    if (scenario === null) continue;
    const { outcome } = await ran(driver, 'rows', scenario);
    expect(neutralOf(outcome), `${driver.name}: tracksEffects: false`).toEqual(scenario.expected);
    visits += 1;
  }
  return visits;
}

/** 同じ呼び出しを 2 回流して(再送)も、どちらの受領も outbox は unknown のまま。 */
async function resent(drivers: readonly ContractDriver[], world: ContractWorld): Promise<number> {
  let visits = 0;
  for (const driver of drivers) {
    const scenario = world.scenario('rows', 'rpc');
    if (scenario === null) continue;
    const channel = await driver.open('rows', scenario);
    for (const attempt of [1, 2]) {
      const outcome = await runCall(channel.ports, scenario.call);
      expect(outcome.kind === 'saved' ? outcome.receipt.outbox : outcome.kind, `${driver.name}: ${String(attempt)} 回目`).toBe('unknown');
      visits += 1;
    }
  }
  return visits;
}
