/**
 * 反例の翻訳(C24 の第 4 段が出す文面)。
 *
 * TLC が返すのは状態の全文であり、そのままでは「どこが動いたのか」が読めない。
 * ここは**状態の差分だけ**を 1 行ずつに畳み、先頭に「この性質が何を言っているか」と
 * 「実装のどこを見ればよいか」を置く —— 反例が人の言葉で読めなければ、
 * 検査は「赤い」以上のことを伝えられない。
 *
 * 純粋関数であり throw しない。
 */

import type { PropertyExpectation, TraceState } from './types.js';

/**
 * 1 行が長くなりすぎたときの打ち切り幅。
 *
 * **最後の 2 状態は打ち切らない。** 違反はたいてい最後の 1 手で起きるので、そこを
 * 幅で切ると「何が起きて破れたのか」がちょうど消える(独立レビューの実測)。
 * 途中の状態は差分だけで筋が追えればよいので、幅で切ってよい。
 */
const MAX_WIDTH = 110;

/**
 * 反例に出さない変数。
 *
 * `pc` は PlusCal が作るプログラムカウンタであり、「どのプロセスがどのラベルに居るか」を
 * 持つ。**それは動作の名前が既に言っている**ので、差分に並べると読み手の目を本題
 * (テーブルの中身がどう動いたか)から逸らすだけである。
 */
const HIDDEN = new Set(['pc']);

function clip(text: string): string {
  return text.length <= MAX_WIDTH ? text : `${text.slice(0, MAX_WIDTH - 1)}…`;
}

/**
 * 状態列を「動作 → 変わった変数」の並びに畳む。
 *
 * @param trace TLC が返した状態列
 * @returns 1 状態 1 行のテキスト
 */
export function formatTrace(trace: readonly TraceState[]): string[] {
  const lines: string[] = [];
  let previous: ReadonlyMap<string, string> | null = null;
  // 最後の 2 状態は全文で出す(違反した瞬間を幅で切らない)。
  const fullFrom = Math.max(0, trace.length - 2);
  for (const [index, state] of trace.entries()) {
    const fit = (text: string): string => (index >= fullFrom ? text : clip(text));
    if (previous === null) {
      const initial = [...state.values.entries()]
        .filter(([name, value]) => !HIDDEN.has(name) && value !== 'FALSE' && value !== '0')
        .map(([name, value]) => `${name}=${value}`)
        .join(', ');
      lines.push(fit(`${state.index}. ${state.action}: ${initial === '' ? '(すべて初期値)' : initial}`));
      previous = state.values;
      continue;
    }
    if (state.values.size === 0) {
      lines.push(`${state.index}. ${state.action}`);
      continue;
    }
    const changed: string[] = [];
    for (const [name, value] of state.values) {
      const before = previous.get(name);
      if (!HIDDEN.has(name) && before !== value) changed.push(`${name}: ${before ?? '(無し)'} → ${value}`);
    }
    lines.push(fit(`${state.index}. ${state.action}: ${changed.length === 0 ? '(変化なし)' : changed.join(' / ')}`));
    previous = state.values;
  }
  return lines;
}

/**
 * 反例に「性質の意図」と「実装のどこ・どう直すか」を被せる。
 *
 * @param property その性質の宣言
 * @param trace TLC が返した状態列
 * @returns 字下げして印字する行の並び
 */
export function explainCounterexample(
  property: PropertyExpectation,
  trace: readonly TraceState[],
): string[] {
  const head = [`意図: ${property.intent}`];
  if (property.verdict === 'violated') {
    head.push(`理由: ${property.reason ?? ''}`);
    head.push(`実装: ${property.where ?? ''}`);
    head.push(`対処: ${property.remedy ?? ''}`);
  }
  if (trace.length === 0) return [...head, '反例: TLC は違反を報告しましたが状態列を読めませんでした'];
  return [...head, `反例(${trace.length} 状態。変わった変数だけを出す):`, ...formatTrace(trace).map((line) => `  ${line}`)];
}
