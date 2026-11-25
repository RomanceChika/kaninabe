/**
 * TLC の出力の読み取り(C24 の第 3 段の写像)。
 *
 * **判定そのものは既製品(TLC)が下す。** ここがやるのは、その答えを
 * 「通った / 破れた(反例つき)/ 道具が答えられなかった」の 3 つに写すことだけである。
 *
 * 純粋関数であり throw しない。
 */

import type { TlcResult, TraceState } from './types.js';

/** 反例の 1 状態の見出し(`State 3: <claim("w1") line 12, col 3 … >`)。 */
const STATE_HEADER = /^State (\d+): <(.*)>$/;

/** 戻り先の見出し(無限ループの反例)。 */
const BACK_TO_STATE = /^Back to state (\d+)(?::\s*<(.*)>)?/;

/** 1 変数の始まり(`/\ status = [j1 |-> "pending"]`)。 */
const VALUE_HEAD = /^\/\\ ([A-Za-z_][A-Za-z0-9_]*) = (.*)$/;

/** 統計行(`3113 states generated, 1383 distinct states found, 0 states left on queue.`)。 */
const STATS = /^([\d,]+) states generated, ([\d,]+) distinct states found/;

/** 探索の深さ。 */
const DEPTH = /depth of the complete state graph search is ([\d,]+)/;

function toNumber(text: string): number {
  const parsed = Number.parseInt(text.replace(/,/g, ''), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** 動作の名前だけを取り出す(`claim("w1") line 12, col …` → `claim("w1")`)。 */
function actionName(raw: string): string {
  if (raw === 'Initial predicate') return '初期状態';
  const cut = raw.indexOf(' line ');
  return (cut === -1 ? raw : raw.slice(0, cut)).trim();
}

/**
 * 反例の状態列を読み取る。
 *
 * 値が複数行に折り返されることがあるので、次の `/\ ` か空行までを 1 つの値として畳む。
 *
 * @param lines TLC の出力行
 * @returns 読めた状態の並び(読めなければ空配列)
 */
export function parseTrace(lines: readonly string[]): readonly TraceState[] {
  const states: TraceState[] = [];
  let current: { index: number; action: string; values: Map<string, string> } | null = null;
  let key: string | null = null;
  const flush = (): void => {
    if (current !== null) states.push({ index: current.index, action: current.action, values: current.values });
    current = null;
    key = null;
  };
  for (const line of lines) {
    const header = STATE_HEADER.exec(line);
    if (header !== null) {
      flush();
      current = { index: toNumber(header[1] ?? '0'), action: actionName(header[2] ?? ''), values: new Map() };
      continue;
    }
    const back = BACK_TO_STATE.exec(line);
    if (back !== null) {
      flush();
      states.push({
        index: states.length + 1,
        action: `${toNumber(back[1] ?? '0')} 番目の状態へ戻る(ここから無限に繰り返す)`,
        values: new Map(),
      });
      continue;
    }
    if (current === null) continue;
    const head = VALUE_HEAD.exec(line);
    if (head !== null) {
      key = head[1] ?? null;
      if (key !== null) current.values.set(key, (head[2] ?? '').trim());
      continue;
    }
    if (line.trim() === '') {
      key = null;
      continue;
    }
    if (key !== null) {
      const previous = current.values.get(key) ?? '';
      current.values.set(key, `${previous} ${line.trim()}`.trim());
    }
  }
  flush();
  return states;
}

/**
 * TLC を 1 回実行した出力を答えに写す。
 *
 * @param output 標準出力と標準エラーを 1 本にした行の並び
 * @param exitCode プロセスの終了コード
 * @returns 通った / 破れた / 道具が答えられなかった
 */
export function parseTlcOutput(output: readonly string[], exitCode: number): TlcResult {
  const violated = output.some(
    (line) =>
      /^Error: Invariant \S+ is violated/.test(line) ||
      /^Error: Temporal properties were violated/.test(line) ||
      // `CHECK_DEADLOCK TRUE` の実行(掴む順の検査)。ここから先へ進めない状態が反例である。
      /^Error: Deadlock reached/.test(line),
  );
  if (violated) {
    const trace = parseTrace(output);
    return { kind: 'violated', trace };
  }
  const completed = output.some((line) => line.startsWith('Model checking completed. No error has been found'));
  if (completed && exitCode === 0) {
    const stats = output.map((line) => STATS.exec(line)).find((matched) => matched !== null);
    const depth = output.map((line) => DEPTH.exec(line)).find((matched) => matched !== null);
    return {
      kind: 'holds',
      states: toNumber(stats?.[1] ?? '0'),
      distinct: toNumber(stats?.[2] ?? '0'),
      depth: toNumber(depth?.[1] ?? '0'),
    };
  }
  const reason =
    output.find((line) => line.startsWith('Error:')) ??
    (exitCode === 0 ? 'TLC が「検査を終えた」と言わずに終了しました' : `TLC が終了コード ${exitCode} で落ちました`);
  return { kind: 'error', reason, output };
}
