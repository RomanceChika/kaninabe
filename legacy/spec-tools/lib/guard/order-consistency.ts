/**
 * 比較原子 → 順序制約への変換と、「稠密全順序 + 非等号」制約の充足性判定
 * (充足性判定器の内部エンジン)。
 *
 * ordered ドメイン(数値・日時・now)の区間整合と、opaque ドメイン(ref/uuid)の
 * 等号整合を、同じグラフ問題に落として判定する。ノードは変数と定数の区別を持たない
 * 文字列キーで、定数のうち数値だけが固定の順序を持つ(numericNodes で与える)。
 *
 * 判定は完全である: 制約の連言が充足可能 ⇔ ≤ 到達関係のなかで
 *   (a) 強不等号 a<b の両端が相互到達(= 同値)にならない
 *   (b) 非等号 a≠b の両端が相互到達にならない
 * 稠密性より、条件を満たすときは推移閉包の位相順序に沿って相異なる値を割り当てられる。
 */

import type { CompareOp } from './ast.js';
import { numericNode, type CompareAtom } from './atoms.js';

/** 制約 1 件。le は left ≤ right、lt は left < right、ne は left ≠ right。 */
export interface OrderConstraint {
  readonly kind: 'le' | 'lt' | 'ne';
  readonly left: string;
  readonly right: string;
}

/** 否定したときの比較演算子。 */
const NEGATED_OP: Readonly<Record<CompareOp, CompareOp>> = {
  '==': '!=',
  '!=': '==',
  '<': '>=',
  '<=': '>',
  '>': '<=',
  '>=': '<',
};

/**
 * 比較原子 1 つを、与えられた真理値のもとでの順序制約に変換する。
 *
 * 離散(整数)ドメインの変数と数値定数の比較は、境界を整数に丸めて非厳密不等号へ書き換える
 * (`n > 1` → `n >= 2`)。これにより `n > 1 and n < 2` が整数では空区間であることを、
 * 到達グラフの矛盾として検出できる。
 *
 * @param atom 対象の比較原子
 * @param truth この原子に割り当てる真理値
 * @param discrete 左辺が離散な順序ドメインか(右辺が数値リテラルのときだけ意味を持つ)
 * @param numericNodes 数値ノードの登録先。丸めで新しい定数が生まれた場合ここに追記する
 * @returns 連言として解釈する制約
 */
export function constraintsOf(
  atom: CompareAtom,
  truth: boolean,
  discrete: boolean,
  numericNodes: Map<string, number>,
): readonly OrderConstraint[] {
  let op = truth ? atom.op : NEGATED_OP[atom.op];
  let node = atom.node;

  if (discrete && atom.numeric !== null) {
    const tightened = tightenToInteger(op, atom.numeric);
    op = tightened.op;
    node = numericNode(tightened.value);
    numericNodes.set(node, tightened.value);
  }

  switch (op) {
    case '==':
      return [
        { kind: 'le', left: atom.varKey, right: node },
        { kind: 'le', left: node, right: atom.varKey },
      ];
    case '!=':
      return [{ kind: 'ne', left: atom.varKey, right: node }];
    case '<':
      return [{ kind: 'lt', left: atom.varKey, right: node }];
    case '<=':
      return [{ kind: 'le', left: atom.varKey, right: node }];
    case '>':
      return [{ kind: 'lt', left: node, right: atom.varKey }];
    case '>=':
      return [{ kind: 'le', left: node, right: atom.varKey }];
  }
}

/** 整数変数に対する境界を整数へ丸め、厳密不等号を非厳密不等号にする。 */
function tightenToInteger(op: CompareOp, value: number): { op: CompareOp; value: number } {
  switch (op) {
    case '>':
      return { op: '>=', value: Math.floor(value) + 1 };
    case '>=':
      return { op: '>=', value: Math.ceil(value) };
    case '<':
      return { op: '<=', value: Math.ceil(value) - 1 };
    case '<=':
      return { op: '<=', value: Math.floor(value) };
    default:
      return { op, value };
  }
}

/**
 * 制約の連言が充足可能かを判定する。
 *
 * @param constraints 連言として解釈する制約の集合
 * @param numericNodes 値が確定している数値ノード(キー → 数値)。相互の順序は固定される
 * @returns 充足可能なら true。矛盾していれば false
 */
export function isOrderConsistent(
  constraints: readonly OrderConstraint[],
  numericNodes: ReadonlyMap<string, number>,
): boolean {
  const nodes = collectNodes(constraints, numericNodes);
  const index = new Map(nodes.map((node, i) => [node, i]));
  const size = nodes.length;
  const reach = new Uint8Array(size * size);
  const at = (from: number, to: number): boolean => reach[from * size + to] === 1;
  const link = (from: number, to: number): void => {
    reach[from * size + to] = 1;
  };

  for (let i = 0; i < size; i += 1) link(i, i);

  const strict: Array<readonly [number, number]> = [];
  const distinct: Array<readonly [number, number]> = [];

  for (const c of constraints) {
    const left = index.get(c.left) ?? 0;
    const right = index.get(c.right) ?? 0;
    if (c.kind === 'ne') {
      distinct.push([left, right]);
      continue;
    }
    link(left, right);
    if (c.kind === 'lt') strict.push([left, right]);
  }

  for (const [lower, upper] of numericOrderPairs(numericNodes)) {
    const from = index.get(lower) ?? 0;
    const to = index.get(upper) ?? 0;
    link(from, to);
    strict.push([from, to]);
  }

  closeTransitively(size, at, link);

  for (const [from, to] of strict) if (at(to, from)) return false;
  for (const [left, right] of distinct) if (at(left, right) && at(right, left)) return false;
  return true;
}

/** 制約と数値ノードに現れる全ノードを重複なく列挙する。 */
function collectNodes(
  constraints: readonly OrderConstraint[],
  numericNodes: ReadonlyMap<string, number>,
): readonly string[] {
  const nodes = new Set<string>();
  for (const c of constraints) {
    nodes.add(c.left);
    nodes.add(c.right);
  }
  for (const key of numericNodes.keys()) nodes.add(key);
  return [...nodes];
}

/** 数値ノードを昇順に並べ、隣接ペア(小, 大)を返す。 */
function numericOrderPairs(numericNodes: ReadonlyMap<string, number>): Array<readonly [string, string]> {
  const sorted = [...numericNodes.entries()].sort((a, b) => a[1] - b[1]);
  const pairs: Array<readonly [string, string]> = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev !== undefined && cur !== undefined) pairs.push([prev[0], cur[0]]);
  }
  return pairs;
}

/** 到達関係を推移閉包する(Floyd–Warshall)。ノード数は式のサイズに比例し小さい。 */
function closeTransitively(
  size: number,
  at: (from: number, to: number) => boolean,
  link: (from: number, to: number) => void,
): void {
  for (let via = 0; via < size; via += 1) {
    for (let from = 0; from < size; from += 1) {
      if (!at(from, via)) continue;
      for (let to = 0; to < size; to += 1) {
        if (at(via, to)) link(from, to);
      }
    }
  }
}
