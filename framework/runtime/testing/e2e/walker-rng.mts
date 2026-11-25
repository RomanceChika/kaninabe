/**
 * ランダムウォーク用のシード付き乱数。
 *
 * `Math.random` を直に使うと**再現ができない**（異常が出た実行をもう一度見られない）。
 * mulberry32 は 32bit シードの軽量 PRNG で、同じシードなら同じ操作列になる。
 * 暗号用途ではない（ここに要るのは再現性だけである）。
 */

/** ウォーカーが使う乱数の口。すべてこの 4 つを通す（`Math.random` を直に呼ばない）。 */
export interface WalkerRng {
  /** [0, 1) の一様乱数。 */
  next(): number;
  /** min 以上 max 以下の整数（両端を含む）。 */
  int(min: number, max: number): number;
  /** 配列から 1 要素を選ぶ（空配列を渡すのは呼び出し側の誤り）。 */
  pick<T>(items: readonly T[]): T;
  /** 確率 p で true。 */
  chance(p: number): boolean;
}

/**
 * シードから乱数器を作る。
 *
 * @param seed - 32bit シード（レポートに記録して再現に使う）
 * @returns シード決定的な乱数器
 */
export function createRng(seed: number): WalkerRng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      if (items.length === 0) throw new Error('空の配列から選ぼうとしました（ウォーカーのバグ）。');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    chance: (p) => next() < p,
  };
}
