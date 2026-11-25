/**
 * 表紙の集約関係図(エンティティの参照の SVG)。
 *
 * 事実は集約のモデルだけで、情報は足さない: 節 = エンティティ(内部名・日本語名・状態機械)、線 = ref の欄
 * (`A --欄--> B` = A の欄が B を指す)。置き方だけをここで決める(段に分けて並べる、よくある層の描き方):
 *
 * - 参照される側を上に、参照する側を下に置く。段は「参照の先をたどった最長の手数」(何も参照しないものが最上段)。参照の輪は宣言順の深さ優先でたどり、
 *   輪を閉じる線だけを「戻る線」(点線)にして段の計算から外す
 * - 2 段以上をまたぐ線は、またいだ段ごとに通り道(幅の小さい見えない節)を置き、節と同じように並べる。線は節の上を通らず、通り道を縫う
 * - 同じ段の並びは、隣の段の相手の位置の平均で決める(下向き・上向きに 2 往復。交差を減らす)
 * - 線は参照する側の上の縁から、参照される側の下の縁へ。欄の名前は参照する側の出だしの横に置く。欄の名前が「指す先の名前_id」の線は名前を省く
 *   (名前が指す先を言い直すだけで、線が多い図では名前どうしが重なって読めなくなる。省いたことは図の注記が言う)
 * - 節は、その集約の章(`spec/{集約}.html`)へのリンク
 *
 * ここが持つのは座標だけで、語は持たない。文字列はすべて出力の口を通す。
 */

import type { EntitySpec, SpecModel } from '../../../../model/types.js';
import { textWidth } from './flow-diagram.js';
import { el, url, type Html } from './markup.js';

/** 内部名の字の大きさ。 */
const FONT = 13;
/** 日本語名と状態機械の字の大きさ。 */
const SMALL = 12;
/** 節の中の行の高さ。 */
const LINE = 17;
/** 節の上下の余白。 */
const PAD_Y = 9;
/** 節の左右の余白。 */
const PAD_X = 12;
/** 節の最小の幅。 */
const NODE_MIN_W = 112;
/** 通り道の幅。 */
const WAY_W = 14;
/** 同じ段の節のあいだ。 */
const GAP_X = 24;
/** 段のあいだ(欄の名前を置く分を含む)。 */
const GAP_Y = 64;
/** 図の外側の余白。 */
const MARGIN = 20;

/** 段に置くもの(エンティティの節か、線の通り道)。 */
interface Item {
  /** エンティティ(通り道は null)。 */
  readonly entity: EntitySpec | null;
  readonly lines: readonly { readonly text: string; readonly small: boolean }[];
  readonly href: string | null;
  readonly layer: number;
  order: number;
  x: number;
  y: number;
  width: number;
}

/** 参照の線。 */
interface Ref {
  readonly from: Item;
  readonly to: Item;
  readonly field: string;
  /** 参照の輪を閉じる線(段の計算から外し、点線にする)。 */
  readonly back: boolean;
  /** 上へ進む線の通り道(下の段から順に)。 */
  readonly ways: Item[];
}

/** 図の注記(省いた欄の名前)。 */
export const OMITTED_LABEL_NOTE = '欄の名前が「指す先の名前_id」の線は、名前を省いている。節を押すと、その集約の章へ移る。';

/** 輪を閉じる線を宣言順の深さ優先で見つける(`from\0field` の集合)。 */
function backRefs(entities: readonly EntitySpec[]): ReadonlySet<string> {
  const back = new Set<string>();
  const state = new Map<string, 'open' | 'done'>();
  const byName = new Map(entities.map((entity) => [entity.entity, entity] as const));
  const visit = (entity: EntitySpec): void => {
    state.set(entity.entity, 'open');
    for (const field of entity.fields) {
      if (field.type.kind !== 'ref' || field.type.entity === entity.entity) continue;
      const target = byName.get(field.type.entity);
      if (target === undefined) continue;
      const seen = state.get(target.entity);
      if (seen === 'open') back.add(`${entity.entity}\u0000${field.name}`);
      else if (seen === undefined) visit(target);
    }
    state.set(entity.entity, 'done');
  };
  for (const entity of entities) if (!state.has(entity.entity)) visit(entity);
  return back;
}

/** 段の中の並びを、隣の段の相手の位置の平均で並べ直す。 */
function reorder(layer: Item[], partners: (item: Item) => readonly Item[]): void {
  const key = (item: Item): number => {
    const others = partners(item);
    return others.length === 0 ? item.order : others.reduce((sum, other) => sum + other.order, 0) / others.length;
  };
  const keys = new Map(layer.map((item) => [item, key(item)] as const));
  layer.sort((a, b) => (keys.get(a) ?? 0) - (keys.get(b) ?? 0) || a.order - b.order);
  layer.forEach((item, index) => {
    item.order = index;
  });
}

/** 縦に進む 2 点を、上下に膨らむ曲線で結ぶ。 */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  const bend = Math.max(16, Math.abs(y1 - y2) / 2);
  return `C${x1} ${y1 - bend} ${x2} ${y2 + bend} ${x2} ${y2}`;
}

/**
 * 集約関係図。エンティティが 1 つも無ければ null。
 *
 * @param model 仕様
 * @param chapterHref 集約の名前 → その章への相対の URL
 * @param caption 図の題(読み上げにも使う)
 */
export function aggregateDiagram(model: SpecModel, chapterHref: (aggregate: string) => string, caption: string): Html | null {
  const owners = [...model.aggregates.values()].filter((specs) => specs.entity !== undefined);
  if (owners.length === 0) return null;
  const entities = owners.map((specs) => specs.entity as EntitySpec);
  const back = backRefs(entities);
  const byName = new Map(entities.map((entity) => [entity.entity, entity] as const));

  // 段: 参照の先をたどった最長の手数(戻る線は外す)。
  const depth = new Map<string, number>();
  const depthOf = (entity: EntitySpec): number => {
    const known = depth.get(entity.entity);
    if (known !== undefined) return known;
    const targets = entity.fields.flatMap((field) =>
      field.type.kind === 'ref' && field.type.entity !== entity.entity && !back.has(`${entity.entity}\u0000${field.name}`) ? [byName.get(field.type.entity)] : [],
    );
    const value = Math.max(-1, ...targets.filter((target) => target !== undefined).map(depthOf)) + 1;
    depth.set(entity.entity, value);
    return value;
  };

  const layers: Item[][] = [];
  const place = (item: Item): Item => {
    const layer = layers[item.layer] ?? [];
    item.order = layer.length;
    layer.push(item);
    layers[item.layer] = layer;
    return item;
  };
  const items = new Map<string, Item>();
  for (const specs of owners) {
    const entity = specs.entity as EntitySpec;
    const machines = specs.stateMachines.map((machine) => machine.machine);
    const lines = [
      { text: entity.entity, small: false },
      ...(entity.label === undefined ? [] : [{ text: entity.label, small: true }]),
      ...(machines.length === 0 ? [] : [{ text: `状態機械: ${machines.join(', ')}`, small: true }]),
    ];
    const width = Math.max(NODE_MIN_W, ...lines.map((line) => textWidth(line.text, line.small ? SMALL : FONT) + PAD_X * 2));
    items.set(entity.entity, place({ entity, lines, href: chapterHref(specs.name), layer: depthOf(entity), order: 0, x: 0, y: 0, width }));
  }
  const refs: Ref[] = [];
  for (const from of items.values()) {
    for (const field of (from.entity as EntitySpec).fields) {
      if (field.type.kind !== 'ref') continue;
      const to = items.get(field.type.entity);
      if (to === undefined || to === from) continue;
      const ways: Item[] = [];
      for (let layer = from.layer - 1; layer > to.layer; layer -= 1) ways.push(place({ entity: null, lines: [], href: null, layer, order: 0, x: 0, y: 0, width: WAY_W }));
      refs.push({ from, to, field: field.name, back: back.has(`${from.entity?.entity}\u0000${field.name}`), ways });
    }
  }

  // 並び: 隣の段の相手(線の 1 区間の向こう側)の位置の平均。
  const up = new Map<Item, Item[]>();
  const down = new Map<Item, Item[]>();
  for (const ref of refs) {
    if (ref.to.layer >= ref.from.layer) continue;
    const chain = [ref.from, ...ref.ways, ref.to];
    for (let index = 0; index + 1 < chain.length; index += 1) {
      const lower = chain[index] as Item;
      const upper = chain[index + 1] as Item;
      up.set(lower, [...(up.get(lower) ?? []), upper]);
      down.set(upper, [...(down.get(upper) ?? []), lower]);
    }
  }
  for (let pass = 0; pass < 3; pass += 1) {
    for (const layer of layers.slice(1)) reorder(layer, (item) => up.get(item) ?? []);
    for (const layer of layers.slice(0, -1).reverse()) reorder(layer, (item) => down.get(item) ?? []);
  }

  // 寸法: 段の高さはいちばん行の多い節。各段は図の幅の中で中央に寄せる。
  const heights = layers.map((layer) => Math.max(1, ...layer.map((item) => item.lines.length)) * LINE + PAD_Y * 2);
  const rowWidth = (layer: readonly Item[]): number => layer.reduce((sum, item) => sum + item.width, 0) + GAP_X * (layer.length - 1);
  const width = Math.ceil(Math.max(...layers.map(rowWidth)) + MARGIN * 2);
  let y = MARGIN;
  layers.forEach((layer, index) => {
    let x = (width - rowWidth(layer)) / 2;
    for (const item of [...layer].sort((a, b) => a.order - b.order)) {
      item.x = Math.round(x);
      item.y = y;
      x += item.width + GAP_X;
    }
    y += (heights[index] ?? 0) + GAP_Y;
  });
  const height = Math.ceil(y - GAP_Y + MARGIN);
  const heightOf = (item: Item): number => heights[item.layer] ?? 0;

  // 線の端: 1 つの縁に複数の線が付くときは、縁に沿って等間隔に散らす(相手の側の位置の順)。
  const firstStep = (ref: Ref): Item => ref.ways[0] ?? ref.to;
  const lastStep = (ref: Ref): Item => ref.ways[ref.ways.length - 1] ?? ref.from;
  const spread = (item: Item, side: 'top' | 'bottom', ref: Ref): number => {
    const mine = refs.filter((other) => other.to.layer < other.from.layer && (side === 'top' ? other.from === item : other.to === item));
    const sorted = [...mine].sort((a, b) => (side === 'top' ? firstStep(a).x - firstStep(b).x : lastStep(a).x - lastStep(b).x));
    return Math.round(item.x + (item.width * (sorted.indexOf(ref) + 1)) / (sorted.length + 1));
  };
  // 同じ節から出る名前つきの線の順(名前を 1 行ずつ上へずらして重ねない)。
  const namedIndex = (ref: Ref): number =>
    refs
      .filter((other) => other.from === ref.from && other.to.layer < other.from.layer && other.field !== `${other.to.entity?.entity}_id`)
      .sort((a, b) => firstStep(a).x - firstStep(b).x)
      .indexOf(ref);
  const lines = refs.map((ref) => {
    const named = ref.field !== `${ref.to.entity?.entity}_id`;
    if (ref.to.layer < ref.from.layer) {
      const points: [number, number][] = [
        [spread(ref.from, 'top', ref), ref.from.y],
        ...ref.ways.flatMap((way): [number, number][] => [
          [way.x + WAY_W / 2, way.y + heightOf(way)],
          [way.x + WAY_W / 2, way.y],
        ]),
        [spread(ref.to, 'bottom', ref), ref.to.y + heightOf(ref.to) + 2],
      ];
      let d = `M${points[0]?.[0]} ${points[0]?.[1]}`;
      for (let index = 1; index < points.length; index += 1) {
        const [x1, y1] = points[index - 1] as [number, number];
        const [x2, y2] = points[index] as [number, number];
        d += x1 === x2 ? ` L${x2} ${y2}` : ` ${curve(x1, y1, x2, y2)}`;
      }
      const [sx, sy] = points[0] as [number, number];
      return el(
        'g',
        { class: ['bf-fl-edge', ref.back && 'bf-fl-edge--back'] },
        el('path', { d, 'marker-end': 'url(#bf-ag-arrow)' }),
        // 名前は線の出だしの横に、節の中心から遠い側へ寄せて置く。同じ節から出る名前は 1 行ずつ上へずらす。
        named
          ? el(
              'text',
              {
                class: 'bf-fl-edge-label bf-ag-label',
                x: sx < ref.from.x + ref.from.width / 2 ? sx - 4 : sx + 4,
                y: sy - 12 - 14 * namedIndex(ref),
                dy: 4,
                'text-anchor': sx < ref.from.x + ref.from.width / 2 ? 'end' : 'start',
              },
              ref.field,
            )
          : null,
      );
    }
    // 同じ段か下の段を指す線(参照の輪を閉じる線): 節の右の縁から出て、相手の右の縁へ回る。
    const x1 = ref.from.x + ref.from.width;
    const y1 = Math.round(ref.from.y + heightOf(ref.from) / 2);
    const x2 = ref.to.x + ref.to.width;
    const y2 = Math.round(ref.to.y + heightOf(ref.to) / 2);
    const out = Math.max(x1, x2) + 36;
    return el(
      'g',
      { class: ['bf-fl-edge', ref.back && 'bf-fl-edge--back'] },
      el('path', { d: `M${x1} ${y1} C${out} ${y1} ${out} ${y2} ${x2 + 2} ${y2}`, 'marker-end': 'url(#bf-ag-arrow)' }),
      named ? el('text', { class: 'bf-fl-edge-label bf-ag-label', x: out - 6, y: Math.round((y1 + y2) / 2), dy: 4, 'text-anchor': 'start' }, ref.field) : null,
    );
  });
  const boxes = [...items.values()].map((item) => {
    const box = el(
      'g',
      { class: 'bf-ag-node' },
      el('rect', { x: item.x, y: item.y, width: Math.round(item.width), height: heightOf(item), rx: 6, ry: 6 }),
      el(
        'text',
        { 'text-anchor': 'middle' },
        item.lines.map((line, index) =>
          el('tspan', { class: line.small ? 'bf-ag-small' : 'bf-ag-name', x: Math.round(item.x + item.width / 2), y: item.y + PAD_Y + LINE * index + LINE / 2, dy: 4 }, line.text),
        ),
      ),
    );
    return item.href === null ? box : el('a', { href: url(item.href) }, box);
  });
  const svg = el(
    'svg',
    { class: 'bf-fl-svg', xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': caption },
    el(
      'defs',
      null,
      el('marker', { id: 'bf-ag-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, el('path', { d: 'M0 0 L10 5 L0 10 z' })),
    ),
    lines,
    boxes,
  );
  return el('figure', { class: 'bf-fl' }, el('div', { class: 'bf-fl-scroll' }, svg), el('figcaption', { class: 'bf-fl-cap' }, caption));
}
