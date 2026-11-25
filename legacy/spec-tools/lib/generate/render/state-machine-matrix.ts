/**
 * state × event マトリクス(全状態 × 全イベント)のレンダラー。
 *
 * 仕様側は「イベントごとに 1 つの包括的な禁止理由(otherwise_forbidden)」しか書かないため、
 * どの状態がどの理由で禁止されているかは YAML を読むだけでは見えない。
 * この表は全マスを展開して**暗黙の禁止を人間が目視できる**ようにするための生成物であり、
 * V3(全域性)が機械的に保証している内容の人間向けの対応物にあたる
 * (domain-spec-writing.md §state_spec)。
 */

import type { EventDef, ForbiddenDef, StateMachineSpec } from '../../model/types.js';
import { cell, markdownTable, withLabel } from '../../gen-kit/state-machine-table.js';

/** 1 マスの分類。forbidden は machine.forbidden 内の添字を保持し、後で脚注番号に変換する。 */
type MatrixCell =
  | { readonly kind: 'allowed'; readonly to: string }
  | { readonly kind: 'forbidden'; readonly index: number }
  | { readonly kind: 'otherwise' }
  | { readonly kind: 'unspecified' };

const CORNER = '状態＼イベント';

const LEGEND =
  '凡例: `✓→{to}` = 遷移が定義されている / `✗(fN)` = 明示的な禁止(脚注 fN) / ' +
  '`✗(o)` = otherwise_forbidden による包括禁止 / `✗(?)` = 理由が書かれていない(V3 違反)';

/**
 * 1 つの状態機械の state × event マトリクスを作る。
 *
 * 表の下に脚注を付ける。fN は forbidden ブロックの理由、o は otherwise_forbidden の理由を
 * イベントごとに並べたもの。使われていない脚注は出さない。
 *
 * @param machine 対象の状態機械
 * @returns Markdown(表 + 凡例 + 脚注。末尾に改行を含まない)
 */
export function renderStateEventMatrix(machine: StateMachineSpec): string {
  const view = matrixView(machine);
  const lines = view.notes.flatMap((note) => [`- ${note.text}`, ...note.sub.map((sub) => `    - ${sub}`)]);
  const blocks = [markdownTable([...view.headers], view.rows.map((row) => [...row])), view.legend, ...(lines.length === 0 ? [] : [`脚注:\n\n${lines.join('\n')}`])];
  return blocks.join('\n\n');
}

/** マトリクスの脚注 1 項目(本文と、その下に並ぶ項目)。 */
export interface MatrixNote {
  readonly text: string;
  readonly sub: readonly string[];
}

/** マトリクスの中身(Markdown の表と HTML の表が同じ見出し・行・凡例・脚注を使う)。 */
export interface MatrixView {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** 凡例(`` `識別子` `` を含む文)。 */
  readonly legend: string;
  readonly notes: readonly MatrixNote[];
}

/** 1 つの状態機械の state × event マトリクスの中身を作る。 */
export function matrixView(machine: StateMachineSpec): MatrixView {
  const grid = machine.states.map((state) =>
    machine.events.map((event) => classify(machine, state, event)),
  );
  const numbers = assignFootnoteNumbers(grid);

  const headers = [CORNER, ...machine.events.map((event) => cell(withLabel(event.id, event.label)))];
  const rows = grid.map((cells, row) => {
    const state = machine.states[row] ?? '';
    return [
      cell(withLabel(state, machine.stateLabels[state])),
      ...cells.map((c) => renderCell(c, numbers)),
    ];
  });

  return { headers, rows, legend: LEGEND, notes: footnotes(machine, grid, numbers) };
}

/**
 * 1 マスを分類する。優先順位は「定義済み > 明示的な禁止 > 包括禁止 > 未分類」。
 * 定義と禁止が矛盾している場合は定義側を採る(矛盾自体は検証器の担当)。
 */
function classify(machine: StateMachineSpec, state: string, event: EventDef): MatrixCell {
  if (event.from.includes(state)) return { kind: 'allowed', to: event.to };

  const index = machine.forbidden.findIndex(
    (fb) => matchesEvent(fb, machine.machine, event.id) && fb.from.includes(state),
  );
  if (index !== -1) return { kind: 'forbidden', index };

  return hasReason(event.otherwiseForbidden) ? { kind: 'otherwise' } : { kind: 'unspecified' };
}

/** 理由として有効な文字列か(空・空白のみは V3 と同じく「書いていない」と見なす)。 */
function hasReason(text: string | undefined): boolean {
  return text !== undefined && text.trim().length > 0;
}

/** forbidden.event は素のイベントID でも `{machine}.{event}` 形式でも書けるものとして照合する。 */
function matchesEvent(fb: ForbiddenDef, machineName: string, eventId: string): boolean {
  return fb.event === eventId || fb.event === `${machineName}.${eventId}`;
}

/** 実際に使われた forbidden ブロックにだけ、宣言順で f1, f2, ... を振る。 */
function assignFootnoteNumbers(grid: readonly (readonly MatrixCell[])[]): Map<number, number> {
  const used = new Set<number>();
  for (const row of grid) {
    for (const c of row) {
      if (c.kind === 'forbidden') used.add(c.index);
    }
  }
  const numbers = new Map<number, number>();
  [...used]
    .sort((a, b) => a - b)
    .forEach((index, order) => {
      numbers.set(index, order + 1);
    });
  return numbers;
}

/** マスの表示文字列。 */
function renderCell(c: MatrixCell, numbers: ReadonlyMap<number, number>): string {
  switch (c.kind) {
    case 'allowed':
      return `✓→${c.to}`;
    case 'forbidden':
      return `✗(f${String(numbers.get(c.index) ?? 0)})`;
    case 'otherwise':
      return '✗(o)';
    case 'unspecified':
      return '✗(?)';
  }
}

/**
 * 脚注。使われた fN の理由、o の理由一覧(イベントID: 理由)、
 * 未分類マスがある場合の注意書きを、この順で並べる。
 */
function footnotes(
  machine: StateMachineSpec,
  grid: readonly (readonly MatrixCell[])[],
  numbers: ReadonlyMap<number, number>,
): MatrixNote[] {
  const notes: MatrixNote[] = [];

  for (const [index, number] of [...numbers].sort((a, b) => a[1] - b[1])) {
    const fb = machine.forbidden[index];
    if (fb !== undefined) notes.push({ text: `f${String(number)}: ${reasonText(fb.reason)}`, sub: [] });
  }

  const otherwiseEvents = machine.events.filter((_, column) =>
    grid.some((row) => row[column]?.kind === 'otherwise'),
  );
  if (otherwiseEvents.length > 0) {
    notes.push({
      text: 'o: from に無い状態の包括禁止(otherwise_forbidden)。イベントごとの理由は次のとおり。',
      sub: otherwiseEvents.map((event) => `${withLabel(event.id, event.label)}: ${reasonText(event.otherwiseForbidden)}`),
    });
  }

  if (grid.some((row) => row.some((c) => c.kind === 'unspecified'))) {
    notes.push({ text: '?: 禁止理由が書かれていません(otherwise_forbidden か forbidden を追加してください)。', sub: [] });
  }

  return notes;
}

/** 理由の表示。空・空白のみは「書かれていない」ことが分かる表記にする。 */
function reasonText(reason: string | undefined): string {
  const text = reason?.replace(/\r?\n/g, ' ').trim() ?? '';
  return text.length === 0 ? '(理由未記入)' : text;
}
