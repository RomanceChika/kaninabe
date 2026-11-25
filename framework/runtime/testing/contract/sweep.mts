import { expect } from 'vitest';
import { neutralOf, ran } from './neutral.mjs';
import type { Ran } from './neutral.mjs';
import type { ContractDriver, ContractWorld, NeutralOutcome, PortName, Scenario, Situation } from './types.mjs';

/**
 * 群の共通の歩き方: 「状況 × 口」を全ドライバに当て、ドライバ同士の結果が一致することを確かめる。
 *
 * 各群は**何を表明するか**(`check`)だけを書く。ここが受け持つのは ①世界が起こせる組だけを歩く
 * ②ドライバごとに新しい値で呼び出しを組む(実 DB で名前・ID を使い回さない)③全ドライバの中立の結果が
 * 同じであること(adapter が違っても契約は 1 つ)④歩いた数を返す(試験が空振りしていないことを呼び側が見る)。
 */

/** 歩いた 1 回(`check` に渡す)。 */
export interface Visit extends Ran {
  readonly driver: ContractDriver;
  readonly situation: Situation;
  readonly port: PortName;
  readonly scenario: Scenario;
  /** 報告に出す場所の名前。 */
  readonly label: string;
}

/**
 * 状況 × 口を歩く。
 *
 * @param drivers - 当てる adapter(2 つ以上で「同じ契約」の一致も見る)
 * @param world - 製品が渡す世界
 * @param situations - 歩く状況
 * @param ports - 歩く口
 * @param check - 1 回ごとの表明
 * @returns 歩いた回数(世界が起こせない組・ドライバごとの数え方で、全部を足したもの)
 */
export async function sweep(
  drivers: readonly ContractDriver[],
  world: ContractWorld,
  situations: readonly Situation[],
  ports: readonly PortName[],
  check: (visit: Visit) => void | Promise<void>,
): Promise<number> {
  let visits = 0;
  for (const situation of situations) {
    for (const port of ports) {
      const outcomes: { readonly name: string; readonly neutral: NeutralOutcome }[] = [];
      for (const driver of drivers) {
        const scenario = world.scenario(situation, port);
        if (scenario === null) continue;
        const result = await ran(driver, situation, scenario);
        const label = `${driver.name} / ${situation} / ${port} / ${scenario.call.rpc}`;
        await check({ ...result, driver, situation, port, scenario, label });
        outcomes.push({ name: driver.name, neutral: neutralOf(result.outcome) });
        visits += 1;
      }
      const [first, ...rest] = outcomes;
      for (const other of rest) {
        expect(other.neutral, `${situation} / ${port}: ${other.name} の結果が ${first?.name ?? ''} と違う`).toEqual(first?.neutral);
      }
    }
  }
  return visits;
}
