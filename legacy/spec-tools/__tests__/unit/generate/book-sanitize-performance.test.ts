/**
 * ハンドブックの無害化の**処理時間**(仕様の文字列だけから、生成を止めるほどの手間を起こさせない)。
 *
 * 長い語と多数のバッククォート(コードスパンの判定を行の頭から数え直す実装は 2 乗になり、8,000 字の語 + 400 個で 11 秒かかった)・50 KB の 1 行・
 * 深い入れ子・`<` や `{` の連なり・多数の行。
 *
 * **2 乗に膨らまないことは手数(`collectValidTags` の steps)で見る** —— 実時間は機械の負荷で揺れる(負荷の高い手元で 1 秒の
 * 上限を 1.2 秒で踏んだ)ので、実時間は壊滅的な遅さ(以前の 11 秒・10 分)だけを捕まえるゆるい保険(10 秒)にする。
 */

import { describe, expect, it } from 'vitest';
import { sanitizeBookMarkdown } from '../../../lib/generate/book-sanitize.js';
import { collectValidTags } from '../../../lib/generate/book-sanitize-balance.js';
import { FUZZ_SEED, seededRandom, SOUP_TOKENS } from '../../helpers/book-fuzz.js';
import { createTrusted } from '../../../lib/kernel/trusted-html.js';

/** 壊滅的な遅さだけを捕まえる時間の保険(ミリ秒)。比べる軸は手数で、実時間は負荷で揺れるので狭くしない。 */
const LIMIT_MS = 10_000;

/** 1 字あたりの手数の上限(既定の予算 60 の 4 分の 1)。 */
const STEPS_PER_CHAR_LIMIT = 15;

/** 手数を 1 字あたりで返す(予算を超えて打ち切ったなら Infinity)。 */
function stepsPerChar(source: string): number {
  const { steps, exhausted } = collectValidTags(source, [], createTrusted());
  return exhausted ? Infinity : steps / (source.length + 1_000);
}

/** 計測して、結果と時間を返す。 */
function timed(source: string): { readonly ms: number; readonly problems: readonly string[] } {
  const registry = createTrusted();
  const start = performance.now();
  sanitizeBookMarkdown(source, registry);
  return { ms: performance.now() - start, problems: registry.problems };
}

/** 入力の作り方(大きさを引数にする)。 */
const SHAPES: ReadonlyArray<readonly [string, (n: number) => string]> = [
  ['長い語 + 多数のバッククォート', (n) => `${'a'.repeat(n)} ${'` '.repeat(n / 20)}`],
  ['長い語 + エスケープされたバッククォート', (n) => `${'a'.repeat(n)} ${'\\` '.repeat(n / 20)}`],
  ['長い語 + 閉じるコードスパン', (n) => `${'a'.repeat(n * 4)} ${'`a` '.repeat(n / 4)}`],
  ['長い語 + タグ', (n) => `${'a'.repeat(n)} ${'<b>x</b> '.repeat(n / 20)}`],
  ['長い語 + 波括弧', (n) => `${'a'.repeat(n)} ${'{x} '.repeat(n / 4)}`],
  ['1 行に記号と部品が入り混じる 50 KB', (n) => 'word <b>x</b> `c` {y} | _ * [a](b) <i> '.repeat((n * 6) / 40)],
  ['深い入れ子(同じ行)', (n) => `${'<div>'.repeat(n * 3)}x${'</div>'.repeat(n * 3)}`],
  ['閉じない開きの連なり', (n) => '<span>'.repeat(n * 4)],
  ['< の連なり', (n) => '<'.repeat(n * 6)],
  ['{ の連なり', (n) => '{ '.repeat(n * 4)],
  ['多数の行', (n) => 'a `b` <i>c</i> {x}\n'.repeat(n * 2)],
  ['表の区切りの連なり', (n) => '| <b>x</b> '.repeat(n * 4)],
  ['フェンスの連なり', (n) => '```\nx\n'.repeat(n)],
  ['引用の入れ子', (n) => `${'> '.repeat(n)}x`],
];

/** 部品とスロット（#default）を n 段に入れ子にした文書。 */
function nestedComponents(depth: number): string {
  let inner = '中身';
  for (let level = 0; level < depth; level += 1) inner = `<Fold kind="x">\n\n<template #default>\n\n${inner}\n\n</template>\n\n</Fold>`;
  return `head\n\n${inner}\n`;
}

describe('無害化の手数は入力の大きさに比例し(2 乗に膨らまない)、壊滅的に遅くならない', () => {
  it.each(SHAPES)('%s(約 8 KB と約 50 KB)', (_name, build) => {
    const small = timed(build(8_000));
    const large = timed(build(50_000));

    expect(small.ms).toBeLessThan(LIMIT_MS);
    expect(large.ms).toBeLessThan(LIMIT_MS);
    expect(stepsPerChar(build(8_000))).toBeLessThan(STEPS_PER_CHAR_LIMIT);
    expect(stepsPerChar(build(50_000))).toBeLessThan(STEPS_PER_CHAR_LIMIT);
    expect(small.problems).toEqual([]);
    expect(large.problems).toEqual([]);
  });

  it('部品の入れ子が深くても（500 段の部品 + #default）、手数の予算を超えない。正しい入れ子は通る', () => {
    const deep = nestedComponents(500);
    const registry = createTrusted();
    const start = performance.now();
    const out = sanitizeBookMarkdown(deep, registry);

    expect(performance.now() - start).toBeLessThan(LIMIT_MS);
    expect(registry.problems).toEqual([]);
    expect(out).toBe(deep);
    expect(sanitizeBookMarkdown(nestedComponents(40), createTrusted())).toBe(nestedComponents(40));
  });

  it('1 行の無作為な入力で、1 字あたりの手数は上限（既定の予算 60 の 4 分の 1）に収まる', () => {
    const random = seededRandom(FUZZ_SEED);
    const tokens = SOUP_TOKENS.filter((token) => !token.includes('\n'));
    let worst = 0;
    for (let index = 0; index < 1_500; index += 1) {
      let source = '';
      for (let target = 200 + Math.floor(random() * 4_000); source.length < target; ) source += tokens[Math.floor(random() * tokens.length)] ?? '';
      const { steps, exhausted } = collectValidTags(source, [], createTrusted());
      worst = Math.max(worst, steps / (source.length + 1_000));

      expect(exhausted).toBe(false);
    }

    expect(worst).toBeLessThan(STEPS_PER_CHAR_LIMIT);
  });

  it('入力を 4 倍にしても、手数は 1 字あたりでほぼ変わらない(2 乗なら 4 倍に増える)', () => {
    for (const [name, build] of SHAPES) {
      const base = stepsPerChar(build(12_000));
      const grown = stepsPerChar(build(48_000));

      expect(grown, name).toBeLessThan(base * 2 + 1);
    }
  });
});
