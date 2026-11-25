/**
 * 反例(witness)の組み立て。
 *
 * 充足性判定が「真にできる」と結論した割り当てを、人間が読める変数割当
 * (例: `{ "workshop.state": "accepting", "entry.duration_min": "7" }`)に直す。
 * Finding の counterexample にそのまま載せるためのもので、判定そのものには影響しない。
 *
 * 復元できるのは次の 4 種。それ以外の変数は省略する(契約上、省略可)。
 *  1. finite 変数 … 列挙した値をそのまま。
 *  2. 等号で定数に固定された変数 … `x == draft` が真、`x != draft` が偽、など。
 *  3. 数値リテラルとの比較だけで縛られた ordered 変数 … 区間の代表値を 1 つ選ぶ。
 *  4. **空だと決まった欄** … `(空)` と書く。その欄の比較原子は 1 つも読まない ——
 *     値が無い欄に「この値だった」と書くと、反例が嘘になる(束 ㉒)。
 */

import type { CompareOp } from './ast.js';
import { type Atom, type CompareAtom } from './atoms.js';

/** 片側の境界。inclusive=false は厳密不等号(その値自体は取れない)。 */
interface Bound {
  readonly value: number;
  readonly inclusive: boolean;
}

const NEGATED_OP: Readonly<Record<CompareOp, CompareOp>> = {
  '==': '!=',
  '!=': '==',
  '<': '>=',
  '<=': '>',
  '>': '<=',
  '>=': '<',
};

/** 離散変数の代表値を探すときの走査上限。 */
const MAX_INTEGER_SCAN = 64;

/** 空だと決まった欄の書き方(反例の表に出る字面)。 */
export const EMPTY_WITNESS = '(空)';

/**
 * 真になる割り当てを反例レコードに直す。
 *
 * @param finite finite 変数の割り当て
 * @param atoms 真理値ビットの並び順と一致する原子列
 * @param mask 各原子の真理値(ビット)
 * @param discreteVars 離散(整数)な ordered 変数のキー集合
 * @param emptyVars その割り当てで**空**だと決まった欄のキー集合
 * @returns 変数キー → 値の文字列。1 つも復元できなければ undefined
 */
export function buildWitness(
  finite: ReadonlyMap<string, string>,
  atoms: readonly Atom[],
  mask: number,
  discreteVars: ReadonlySet<string>,
  emptyVars: ReadonlySet<string> = new Set(),
): Readonly<Record<string, string>> | undefined {
  const witness: Record<string, string> = Object.fromEntries(finite);
  for (const key of emptyVars) witness[key] = EMPTY_WITNESS;
  const touchesEmpty = (atom: CompareAtom): boolean =>
    emptyVars.has(atom.varKey) || (atom.rhsVar !== null && emptyVars.has(atom.rhsVar));
  const compares = atoms
    .map((atom, i) => ({ atom, truth: ((mask >> i) & 1) === 1 }))
    .filter((entry): entry is { atom: CompareAtom; truth: boolean } => entry.atom.kind === 'compare')
    .filter((entry) => !touchesEmpty(entry.atom));

  const rhsVars = new Set(
    compares.map((e) => e.atom.rhsVar).filter((key): key is string => key !== null),
  );

  for (const { atom, truth } of compares) {
    const op = truth ? atom.op : NEGATED_OP[atom.op];
    if (op === '==' && atom.rhsVar === null && witness[atom.varKey] === undefined) {
      witness[atom.varKey] = atom.text;
    }
  }

  for (const key of new Set(compares.map((e) => e.atom.varKey))) {
    if (witness[key] !== undefined || rhsVars.has(key)) continue;
    const constraints = compares.filter((e) => e.atom.varKey === key);
    if (constraints.some((e) => e.atom.numeric === null)) continue;
    const value = representativeValue(constraints, discreteVars.has(key));
    if (value !== undefined) witness[key] = String(value);
  }

  return Object.keys(witness).length === 0 ? undefined : witness;
}

/** 数値制約だけで縛られた変数について、区間の代表値を 1 つ選ぶ。 */
function representativeValue(
  constraints: readonly { readonly atom: CompareAtom; readonly truth: boolean }[],
  discrete: boolean,
): number | undefined {
  let lower: Bound | undefined;
  let upper: Bound | undefined;
  const excluded = new Set<number>();

  for (const { atom, truth } of constraints) {
    const value = atom.numeric ?? 0;
    switch (truth ? atom.op : NEGATED_OP[atom.op]) {
      case '==':
        lower = tighter(lower, { value, inclusive: true }, true);
        upper = tighter(upper, { value, inclusive: true }, false);
        break;
      case '!=':
        excluded.add(value);
        break;
      case '>':
        lower = tighter(lower, { value, inclusive: false }, true);
        break;
      case '>=':
        lower = tighter(lower, { value, inclusive: true }, true);
        break;
      case '<':
        upper = tighter(upper, { value, inclusive: false }, false);
        break;
      case '<=':
        upper = tighter(upper, { value, inclusive: true }, false);
        break;
    }
  }

  const fits = (v: number): boolean =>
    (lower === undefined || (lower.inclusive ? v >= lower.value : v > lower.value)) &&
    (upper === undefined || (upper.inclusive ? v <= upper.value : v < upper.value)) &&
    !excluded.has(v);

  return (discrete ? integerCandidates(lower, upper) : denseCandidates(lower, upper)).find(fits);
}

/** 2 つの境界のうち厳しい方を返す(isLower=true なら大きい方が厳しい)。 */
function tighter(current: Bound | undefined, next: Bound, isLower: boolean): Bound {
  if (current === undefined) return next;
  if (current.value === next.value) return current.inclusive ? next : current;
  const nextIsTighter = isLower ? next.value > current.value : next.value < current.value;
  return nextIsTighter ? next : current;
}

/** 整数の候補列(下限から順に）。 */
function integerCandidates(lower: Bound | undefined, upper: Bound | undefined): number[] {
  const low =
    lower === undefined
      ? undefined
      : lower.inclusive
        ? Math.ceil(lower.value)
        : Math.floor(lower.value) + 1;
  const high =
    upper === undefined
      ? undefined
      : upper.inclusive
        ? Math.floor(upper.value)
        : Math.ceil(upper.value) - 1;
  const start = low ?? (high === undefined ? 0 : high - MAX_INTEGER_SCAN + 1);
  const candidates: number[] = [];
  for (let i = 0; i < MAX_INTEGER_SCAN; i += 1) {
    const value = start + i;
    if (high !== undefined && value > high) break;
    candidates.push(value);
  }
  return candidates;
}

/** 連続値の候補列(区間の内点を優先する)。 */
function denseCandidates(lower: Bound | undefined, upper: Bound | undefined): number[] {
  if (lower !== undefined && upper !== undefined) {
    const mid = (lower.value + upper.value) / 2;
    return [mid, (lower.value * 3 + upper.value) / 4, (lower.value + upper.value * 3) / 4];
  }
  if (lower !== undefined) return [lower.inclusive ? lower.value : lower.value + 1, lower.value + 2];
  if (upper !== undefined) return [upper.inclusive ? upper.value : upper.value - 1, upper.value - 2];
  return [0, 1, -1];
}
