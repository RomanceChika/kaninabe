/**
 * 「そのプロセスはもう居ない」を確かめる共通の補助(点検 19 回目 C19-4)。
 *
 * KILL を送ったプロセスは即座には消えない(壊して回収されるまでの隙間。静かな機械で約 1 ms・負荷が高いと延びる)。見張りテストがこの隙間に
 * 当たると「残っている」で赤になる。隙間を閉じるのは**道具の約束**の側である(pre-commit の段を包む道具は、群が消えたのを確かめてから返る)。
 * ここは既定で**待たずに 1 回だけ**見る —— 道具が約束を破れば、負荷に関わらずそのまま赤になる。待つのが仕様の相手(約束の無い外のプロセス)
 * にだけ `waitMs` を渡す。
 */

import { expect } from 'vitest';

/**
 * プロセスがまだ居るか(`kill(pid, 0)`。ESRCH だけを「居ない」とする。EPERM は居る)。
 *
 * @param pid プロセス番号
 * @returns 居れば true
 */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * プロセスが居ないことを確かめる(居れば `message` つきで赤)。
 *
 * @param pid プロセス番号(正の整数でなければ赤。番号の読み違いで `kill(0, 0)` = 自分の群を見て緑にしない)
 * @param message 赤のときの説明
 * @param waitMs 消えるのを待つ上限(ミリ秒。既定 0 = 待たない)
 */
export function expectProcessGone(pid: number, message: string, waitMs = 0): void {
  expect(Number.isInteger(pid) && pid > 0, `プロセス番号が読めない: ${String(pid)}`).toBe(true);
  const deadline = Date.now() + waitMs;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (processAlive(pid) && Date.now() < deadline) Atomics.wait(pause, 0, 0, 10);
  expect(processAlive(pid), message).toBe(false);
}
