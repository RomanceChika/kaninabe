/**
 * 新しい形の章の「流れ」の図(状態機械 1 本の SVG)。
 *
 * 本筋の段(`StateFact.step` を持つ状態)を上から下へ、始まりからの手数の順に並べる。同じ手数の段は横に並べる。本筋に乗らない状態
 * (否定的な状態など)は右の列に、入ってくる遷移の出どころのいちばん上の行の 1 つ下に置く。色は区分(`bf-state--{category}`)のクラスで付け、
 * 値はテーマ(`html.css`)が持つ。どこからでも出る遷移は線にしない(表の下に書く。表と同じ規則)。
 *
 * 線:
 * - 下へ進む線は、節の下の縁から次の節の上の縁へ。名前は線の右に 1 行ずつ置く
 * - 上へ戻る線は、節の左の縁から左を回って戻る(点線)
 * - 右の列(本筋の外)へ出る線は、節の右の縁から出る
 * - 同じ 2 状態を結ぶ遷移はまとめて 1 本にし、名前を行に分けて並べる
 *
 * ここが持つのは座標だけで、語は持たない(状態と遷移の名前は事実のまま)。文字列はすべて出力の口を通す。
 */

import type { LifecycleFacts, StateFact } from '../../../../semantics/spec-book/lifecycle-facts.js';
import { el, type Html } from './markup.js';

/** 字の大きさ(CSS の `--text-sm` 相当)。幅の見積りに使う。 */
const FONT = 13;
/** 線の名前の字の大きさ(`--text-xs` 相当)。 */
const LABEL_FONT = 12;
/** 線の名前の行の高さ。 */
const LABEL_LINE = 15;
/** 節の高さ。 */
const NODE_H = 34;
/** 節の左右の余白。 */
const PAD_X = 14;
/** 節の最小の幅。 */
const NODE_MIN_W = 120;
/** 列のあいだ(線の名前を置く分を含む)。 */
const GAP_X = 56;
/** 行のあいだの最小。 */
const GAP_Y = 30;
/** 図の外側の余白。 */
const MARGIN = 24;
/** 戻る線が左へ出る幅(1 本ごと)。 */
const BACK_STEP = 14;

/** 文字列の幅の見積り(全角 1 字 = 字の大きさ、半角 = 0.6 倍)。 */
export function textWidth(value: string, font: number): number {
  let width = 0;
  for (const char of value) width += char.charCodeAt(0) > 0xff ? font : font * 0.6;
  return width;
}

/** 節の中の字(段の番号と名前)。 */
function nodeLabel(state: StateFact, steps: number): string {
  return state.step === undefined || steps < 2 ? state.label : `${state.step}/${steps} ${state.label}`;
}

/** 置いた節。 */
interface Placed {
  readonly state: StateFact;
  readonly row: number;
  readonly column: number;
  x: number;
  y: number;
  width: number;
}

/** まとめた線。 */
interface Edge {
  readonly from: Placed;
  readonly to: Placed;
  readonly labels: string[];
}

/** 行(手数)と列を決める。 */
function place(facts: LifecycleFacts): Map<string, Placed> {
  const depth = new Map<string, number>([[facts.initial, 0]]);
  const queue = [facts.initial];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const transition of facts.transitions) {
      if (transition.fromAnywhere || !transition.from.includes(current) || depth.has(transition.to)) continue;
      const target = facts.states.find((state) => state.id === transition.to);
      if (target?.step === undefined) continue;
      depth.set(transition.to, (depth.get(current) ?? 0) + 1);
      queue.push(transition.to);
    }
  }
  const placed = new Map<string, Placed>();
  const columnsInRow = new Map<number, number>();
  const main = facts.states.filter((state) => state.step !== undefined).sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  for (const state of main) {
    const row = depth.get(state.id) ?? 0;
    const column = columnsInRow.get(row) ?? 0;
    columnsInRow.set(row, column + 1);
    placed.set(state.id, { state, row, column, x: 0, y: 0, width: 0 });
  }
  const sideColumn = Math.max(1, ...columnsInRow.values());
  const usedRows = new Set<number>();
  for (const state of facts.states) {
    if (placed.has(state.id)) continue;
    const sources = facts.transitions.filter((transition) => transition.to === state.id && !transition.fromAnywhere).flatMap((transition) => transition.from);
    const rows = sources.map((source) => placed.get(source)?.row).filter((row): row is number => row !== undefined);
    let row = rows.length === 0 ? Math.max(0, ...[...placed.values()].map((item) => item.row)) : Math.min(...rows) + 1;
    while (usedRows.has(row)) row += 1;
    usedRows.add(row);
    placed.set(state.id, { state, row, column: sideColumn, x: 0, y: 0, width: 0 });
  }
  return placed;
}

/** 線の道筋と名前の位置。 */
function route(edge: Edge, backIndex: number): { readonly d: string; readonly labelX: number; readonly labelY: number; readonly anchor: 'start' | 'end' } {
  const { from, to } = edge;
  if (to.row > from.row && to.column === from.column) {
    const x = from.x + from.width / 2;
    const tx = to.x + to.width / 2;
    const sy = from.y + NODE_H;
    const ey = to.y;
    const d = x === tx ? `M${x} ${sy} L${tx} ${ey - 2}` : `M${x} ${sy} C${x} ${(sy + ey) / 2} ${tx} ${(sy + ey) / 2} ${tx} ${ey - 2}`;
    return { d, labelX: Math.max(x, tx) + 10, labelY: (sy + ey) / 2, anchor: 'start' };
  }
  if (to.column !== from.column) {
    // 横の列へ(本筋の外へ出る線・枝分かれ)。出る側の縁から、入る側の縁へ。
    const right = to.column > from.column;
    const sx = right ? from.x + from.width : from.x;
    const ex = right ? to.x : to.x + to.width;
    const sy = from.y + NODE_H / 2;
    const ey = to.y + NODE_H / 2;
    const mx = (sx + ex) / 2;
    return {
      d: `M${sx} ${sy} C${mx} ${sy} ${mx} ${ey} ${right ? ex - 2 : ex + 2} ${ey}`,
      labelX: mx,
      labelY: Math.min(sy, ey) - 6 + (to.row > from.row ? (ey - sy) / 2 : 0),
      anchor: 'start',
    };
  }
  // 同じ列で上へ戻る線: 左を回る。
  const out = Math.min(from.x, to.x) - BACK_STEP * (backIndex + 1);
  const sy = from.y + NODE_H / 2;
  const ey = to.y + NODE_H / 2;
  return { d: `M${from.x} ${sy} C${out} ${sy} ${out} ${ey} ${to.x - 2} ${ey}`, labelX: out - 4, labelY: (sy + ey) / 2, anchor: 'end' };
}

/**
 * 図の HTML(`<figure>`)。状態が無ければ null。
 *
 * @param facts 状態機械 1 本の事実
 * @param caption 図の説明(読み方の語)
 */
export function flowDiagram(facts: LifecycleFacts, caption: string): Html | null {
  if (facts.states.length === 0) return null;
  const placed = place(facts);
  const items = [...placed.values()];

  const edges = new Map<string, Edge>();
  for (const transition of facts.transitions) {
    if (transition.fromAnywhere) continue;
    for (const from of transition.from) {
      const source = placed.get(from);
      const target = placed.get(transition.to);
      if (source === undefined || target === undefined || source === target) continue;
      const key = `${from}\u0000${transition.to}`;
      const edge = edges.get(key) ?? { from: source, to: target, labels: [] };
      if (!edge.labels.includes(transition.label)) edge.labels.push(transition.label);
      edges.set(key, edge);
    }
  }

  // 寸法: 列の幅は節の字の幅、列のあいだは下へ進む線の名前の幅。行の高さは、その行から下へ出る線の名前の行数。
  const columns = Math.max(...items.map((item) => item.column)) + 1;
  const rows = Math.max(...items.map((item) => item.row)) + 1;
  const columnWidth = Array.from({ length: columns }, (_, column) =>
    Math.max(NODE_MIN_W, ...items.filter((item) => item.column === column).map((item) => textWidth(nodeLabel(item.state, facts.steps), FONT) + PAD_X * 2)),
  );
  const labelWidth = (labels: readonly string[]): number => Math.max(0, ...labels.map((label) => textWidth(label, LABEL_FONT)));
  const gapAfter = Array.from({ length: columns }, (_, column) =>
    Math.max(
      GAP_X,
      ...[...edges.values()].filter((edge) => edge.from.column === column && edge.to.column === column && edge.to.row > edge.from.row).map((edge) => labelWidth(edge.labels) + 24),
    ),
  );
  const rowGap = Array.from({ length: rows }, (_, row) =>
    Math.max(GAP_Y, ...[...edges.values()].filter((edge) => edge.from.row === row && edge.to.row > row).map((edge) => edge.labels.length * LABEL_LINE + 12)),
  );
  const backEdges = [...edges.values()].filter((edge) => edge.to.column === edge.from.column && edge.to.row < edge.from.row);
  const left = MARGIN + BACK_STEP * backEdges.length + Math.max(0, ...backEdges.map((edge) => labelWidth(edge.labels)));
  const columnX: number[] = [];
  let x = left;
  for (let column = 0; column < columns; column += 1) {
    columnX.push(x);
    x += (columnWidth[column] ?? 0) + (gapAfter[column] ?? GAP_X);
  }
  const rowY: number[] = [];
  let y = MARGIN + 16;
  for (let row = 0; row < rows; row += 1) {
    rowY.push(y);
    y += NODE_H + (rowGap[row] ?? GAP_Y);
  }
  for (const item of items) {
    item.width = columnWidth[item.column] ?? NODE_MIN_W;
    item.x = columnX[item.column] ?? left;
    item.y = rowY[item.row] ?? MARGIN;
  }
  const width = Math.ceil(x - (gapAfter[columns - 1] ?? GAP_X) + MARGIN + Math.max(0, ...[...edges.values()].map((edge) => labelWidth(edge.labels))));
  const height = Math.ceil(y - (rowGap[rows - 1] ?? GAP_Y) + MARGIN);

  const lines = [...edges.values()].map((edge) => {
    const back = edge.to.column === edge.from.column && edge.to.row < edge.from.row;
    const path = route(edge, back ? backEdges.indexOf(edge) : 0);
    const top = path.labelY - ((edge.labels.length - 1) * LABEL_LINE) / 2;
    return el(
      'g',
      { class: ['bf-fl-edge', back && 'bf-fl-edge--back'] },
      el('path', { d: path.d, 'marker-end': 'url(#bf-fl-arrow)' }),
      el(
        'text',
        { class: 'bf-fl-edge-label', 'text-anchor': path.anchor },
        edge.labels.map((label, index) => el('tspan', { x: Math.round(path.labelX), y: Math.round(top + index * LABEL_LINE), dy: 4 }, label)),
      ),
    );
  });
  const nodes = items.map((item) =>
    el(
      'g',
      { class: ['bf-fl-node', `bf-state--${item.state.category}`, item.state.final && 'bf-state--final'] },
      el('rect', { x: item.x, y: item.y, width: item.width, height: NODE_H, rx: 6, ry: 6 }),
      el('text', { x: Math.round(item.x + item.width / 2), y: Math.round(item.y + NODE_H / 2), dy: 4, 'text-anchor': 'middle' }, nodeLabel(item.state, facts.steps)),
    ),
  );
  const start = placed.get(facts.initial);
  const startMark =
    start === undefined
      ? null
      : el(
          'g',
          { class: 'bf-fl-start' },
          el('circle', { cx: Math.round(start.x + start.width / 2), cy: start.y - 14, r: 5 }),
          el('path', { d: `M${Math.round(start.x + start.width / 2)} ${start.y - 9} L${Math.round(start.x + start.width / 2)} ${start.y - 2}`, 'marker-end': 'url(#bf-fl-arrow)' }),
        );
  const svg = el(
    'svg',
    { class: 'bf-fl-svg', xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': caption },
    el(
      'defs',
      null,
      el('marker', { id: 'bf-fl-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, el('path', { d: 'M0 0 L10 5 L0 10 z' })),
    ),
    startMark,
    lines,
    nodes,
  );
  return el('figure', { class: 'bf-fl' }, el('div', { class: 'bf-fl-scroll' }, svg), el('figcaption', { class: 'bf-fl-cap' }, caption));
}
