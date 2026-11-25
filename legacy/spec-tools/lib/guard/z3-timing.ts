/**
 * Z3 の親(`z3-host.ts`)が使う時間の定数と、`terminate()` を上限つきで待つ道具。
 */

/** `setTimeout` が受けられる最大の遅延(これを超えると 1 ms に丸められて、全部の問いが即座に死亡になる)。 */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** worker が問いを始めたと知らせるまでの既定の待ち(worker スレッドの起動・モジュールの読み込みの見込み)。 */
export const START_DEADLINE_MS = 30_000;

/** `terminate()` が返るまでの既定の待ち(ミリ秒)。超えたら「終了を確認できない」(失敗)として扱う。 */
export const TERMINATE_DEADLINE_MS = 10_000;

/** タイマーに渡せる待ちか(有限・0 より大きい・`MAX_TIMER_MS` 以下)。 */
export function isTimerRange(ms: number): boolean {
  return Number.isFinite(ms) && ms > 0 && ms <= MAX_TIMER_MS;
}

/**
 * `terminate()` を上限つきで待つ。**「終了を確認できた」の定義はここだけ**: `terminate()` の Promise が resolve したときだけ
 * null を返す。reject・同期 throw・上限超過(返らない)はどれも「確認できていない」で、理由の文面を返す(上限超過は止まったと見なさない)。
 * **reject しない**(呼び出しが同期に throw した場合も文面にする)。
 * 戻りが Promise であることに頼る親(`closing` の連鎖)が、reject の口を持たなくてよいように。
 */
export function terminateWithin(worker: { terminate(): Promise<number> }, ms: number): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(`terminate が ${ms} ms 返らなかった`), ms);
    const finish = (result: string | null): void => {
      clearTimeout(timer);
      resolve(result);
    };
    const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
    let terminating: Promise<number>;
    try {
      terminating = worker.terminate();
    } catch (error) {
      finish(reasonOf(error));
      return;
    }
    terminating.then(() => finish(null), (error: unknown) => finish(reasonOf(error)));
  });
}
