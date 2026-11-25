/**
 * **本物の Z3 の worker** で、host の期限と入れ替えを実測する(偽の worker の配線は z3-host.test.ts)。
 *
 * 偽物では確かめられない 2 点を見る: ① 本当に解き終わらない問い(鳩の巣原理)を host の期限で止められ、
 * 止めた後も次の worker が新しい実行環境で答えること ② 割当の見積りが閾値を超えたら問いの間で worker が入れ替わり、
 * 入れ替えた先の worker も答えること。
 */

import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { Z3Host, type Question, type WorkerLike } from '../../../lib/guard/z3-host.js';

const spawnReal = (): WorkerLike => new Worker(new URL('../../../lib/guard/z3-worker.ts', import.meta.url));

/** n+1 羽の鳩を n 個の巣に入れる(解けない・解くのは指数時間)。 */
function pigeonhole(holes: number): string {
  const lines: string[] = [];
  for (let pigeon = 0; pigeon <= holes; pigeon++) for (let hole = 0; hole < holes; hole++) lines.push(`(declare-const p${pigeon}_${hole} Bool)`);
  for (let pigeon = 0; pigeon <= holes; pigeon++) lines.push(`(assert (or ${Array.from({ length: holes }, (_, hole) => `p${pigeon}_${hole}`).join(' ')}))`);
  for (let hole = 0; hole < holes; hole++)
    for (let a = 0; a <= holes; a++) for (let b = a + 1; b <= holes; b++) lines.push(`(assert (not (and p${a}_${hole} p${b}_${hole})))`);
  return lines.join('\n');
}

const EASY: Question = { context: 'scratch', params: [], sources: ['(declare-const x Int)(assert (> x 1))'], withModel: false, deadlineMs: 30_000 };

const hosts: Z3Host[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.shutdown();
});

function realHost(recycleAboveBytes: number, logs: string[]): Z3Host {
  const host = new Z3Host({ spawn: spawnReal, recycleAboveBytes, log: (line) => logs.push(line) });
  hosts.push(host);
  return host;
}

describe('本物の Z3 の worker', () => {
  it('解き終わらない問いは host の期限で止まり、残りは error、shutdown の後は新しい worker で答える', async () => {
    const logs: string[] = [];
    const host = realHost(1024 ** 3, logs);

    const hard = host.request({ context: 'scratch', params: [['timeout', 600_000]], sources: [pigeonhole(13)], withModel: false, deadlineMs: 1_500 });
    await expect(hard).rejects.toThrow('Z3 のセッションが期限超過で停止した');
    await expect(host.request(EASY)).rejects.toThrow('この問いは確かめていない');

    await host.shutdown();
    await expect(host.request(EASY)).resolves.toEqual({ status: 'sat' });
    expect(logs.join('\n')).toContain('期限超過');
  });

  it('割当の見積りが閾値を超えたら問いの間で入れ替え、入れ替えた先の worker も答える', async () => {
    const logs: string[] = [];
    const host = realHost(0, logs);

    // 起動直後の worker の見積りは 0(閾値 0 を超えない)。2 問目の前に超え、3 問目は入れ替えた先の新しい worker が解く。
    const answers = [await host.request(EASY), await host.request(EASY), await host.request(EASY)];

    expect(answers).toEqual([{ status: 'sat' }, { status: 'sat' }, { status: 'sat' }]);
    expect(logs.filter((line) => line.includes('入れ替えた'))).toHaveLength(1);
  });
});
