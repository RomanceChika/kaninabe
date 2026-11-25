/**
 * 状態機械の遷移表レンダラーと、Markdown 表の組み立てヘルパー。
 *
 * 遷移表は「定義された遷移」だけを 1 イベント 1 行で見せる。
 * 定義されていないマス(暗黙の禁止)は state × event マトリクスの担当
 * (state-machine-matrix.ts)。
 */

import type { EventDef, StateMachineSpec } from '../model/types.js';

/** 値が無いセルの表記(空セルにすると表の列ずれに気付けないため記号を置く)。 */
export const EMPTY_CELL = '—';

const TRANSITION_HEADERS = ['イベントID', 'from', 'to', 'by', 'guard', '書き留める時刻', 'effects'] as const;

/**
 * Markdown のパイプ表を組み立てる。
 *
 * @param headers 見出し行のセル
 * @param rows 本体行(各行のセル数は headers と揃っていること)
 * @returns 表の Markdown(末尾に改行を含まない)
 */
export function markdownTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  const separator = headers.map(() => '---');
  return [line(headers), line(separator), ...rows.map(line)].join('\n');
}

/**
 * 表のセルに埋め込める形に文字列を整える。
 * パイプは列区切りと解釈されるためエスケープし、改行は行が壊れるため空白にする。
 */
export function cell(text: string): string {
  const normalized = text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
  return normalized.length === 0 ? EMPTY_CELL : normalized;
}

/**
 * 識別子に日本語名を併記した表記(`draft(下書き)`)にする。
 * label が無ければ ID のまま。ID は他レイヤーが参照する正の名前なので必ず残す。
 *
 * @param id 識別子(状態 ID / イベント ID / ロール ID)
 * @param label 日本語名(省略可)
 */
export function withLabel(id: string, label: string | undefined): string {
  const text = label?.trim() ?? '';
  return text.length === 0 ? id : `${id}(${text})`;
}

/**
 * 1 つの状態機械の遷移表を作る。行はイベント定義 1 つにつき 1 行で、
 * from が複数ある遷移は from 列にカンマ区切りで並べる(条件・副作用は from に依らないため)。
 * 状態・イベントは label があれば `ID(日本語名)` で併記する。
 *
 * **「書き留める時刻」列**は `records_time`(その遷移が `now()` を書く自分の列)である ——
 * 状態が動いた**時点そのもの**を行に残す遷移があり、その事実は図にもガードにも現れない
 * (書くのは呼び手ではなく DB の `now()` なので、引数の一覧にも出てこない)。
 *
 * @param machine 対象の状態機械
 * @returns Markdown 表(イベントが 0 件でも見出し行は出す)
 */
export function renderTransitionTable(machine: StateMachineSpec): string {
  const { headers, rows } = transitionTableRows(machine);
  return markdownTable(headers, rows);
}

/** 遷移表の見出しと行(Markdown の表と HTML の表が同じ行を使う)。 */
export function transitionTableRows(machine: StateMachineSpec): { readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] } {
  const effects = effectsByEvent(machine);
  const state = (id: string): string => withLabel(id, machine.stateLabels[id]);
  const rows = machine.events.map((event) => [
    cell(withLabel(`${machine.machine}.${event.id}`, event.label)),
    cell(event.from.map(state).join(', ')),
    cell(state(event.to)),
    cell(event.by.join(', ')),
    guardCell(event),
    cell((event.recordsTime ?? []).join(', ')),
    cell(effects.get(event.id)?.join(', ') ?? ''),
  ]);
  return { headers: TRANSITION_HEADERS, rows };
}

/** ガード列。式はコードとして読ませたいのでバッククォートで包む。無ければ EMPTY_CELL。 */
function guardCell(event: EventDef): string {
  const guard = event.guard?.trim() ?? '';
  return guard.length === 0 ? EMPTY_CELL : `\`${cell(guard)}\``;
}

/**
 * effects を イベントID → 副作用ID列 の写像にする。
 * `on` は素のイベントID(`submit`)でも `{machine}.{event}` 形式でも受け取る。
 * 同じイベントに対する複数の effects 宣言は連結する。
 */
function effectsByEvent(machine: StateMachineSpec): Map<string, string[]> {
  const prefix = `${machine.machine}.`;
  const map = new Map<string, string[]>();
  for (const effect of machine.effects) {
    const key = effect.on.startsWith(prefix) ? effect.on.slice(prefix.length) : effect.on;
    const current = map.get(key);
    if (current === undefined) map.set(key, [...effect.do]);
    else current.push(...effect.do);
  }
  return map;
}
