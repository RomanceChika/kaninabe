/**
 * 充足性の列挙計画(satisfiability.ts の**計画づくり**だけを切り出したもの)。
 *
 * 判定の規則そのものは satisfiability.ts が正であり、ここは「式を 1 回走査して、
 * 何を全列挙し・何を真理値のビットに割り当てるか」を決める写像だけを持つ。
 */

import type { CompareOp, DomainEnv, GuardExpr, VariableDomain } from './ast.js';
import { domainInComparison, forEachAtom, type Atom } from './atoms.js';
import { constraintsOf, isOrderConsistent, type OrderConstraint } from './order-consistency.js';

/** finite 以外の原子の個数の上限。真理値割り当てが 2^n 通りになるため制限する。 */
export const MAX_FREE_ATOMS = 12;

const EQUALITY_ONLY_OPS: readonly CompareOp[] = ['==', '!='];

/** finite 変数 1 つ分の列挙対象。 */
export interface FiniteVar {
  readonly key: string;
  readonly values: readonly string[];
}

/** finite 以外の原子と、その真偽それぞれに対応する順序制約。 */
export interface FreeAtom {
  readonly atom: Atom;
  readonly positive: readonly OrderConstraint[];
  readonly negative: readonly OrderConstraint[];
}

/** 列挙計画。unsupported なら判定を諦めて unknown を返す。 */
export interface Plan {
  readonly finiteVars: readonly FiniteVar[];
  readonly freeAtoms: readonly FreeAtom[];
  readonly freeIndex: ReadonlyMap<string, number>;
  readonly numericNodes: ReadonlyMap<string, number>;
  readonly constantDisequalities: readonly OrderConstraint[];
  readonly discreteVars: ReadonlySet<string>;
  /** 「空かどうか」を問われた欄 → その `is null` 原子のビット位置(束 ㉒)。 */
  readonly nullBits: ReadonlyMap<string, number>;
  readonly unsupported: boolean;
}

/** その割り当てでその欄が空か(空を問われていない欄は常に false)。 */
function isEmptyIn(nullBits: ReadonlyMap<string, number>, mask: number, varKey: string): boolean {
  const bit = nullBits.get(varKey);
  return bit !== undefined && ((mask >> bit) & 1) === 1;
}

/** その割り当てで空だと決まった欄の集合(反例に「(空)」と書くため)。 */
export function emptyVars(plan: Plan, mask: number): ReadonlySet<string> {
  const found = new Set<string>();
  for (const [varKey, bit] of plan.nullBits) {
    if (((mask >> bit) & 1) === 1) found.add(varKey);
  }
  return found;
}

/** その比較が**空の欄に触れている**か(どちらの辺でも、触れていれば比較は成立しない)。 */
export function touchesEmpty(atom: Atom, nullBits: ReadonlyMap<string, number>, mask: number): boolean {
  if (atom.kind !== 'compare') return false;
  if (isEmptyIn(nullBits, mask, atom.varKey)) return true;
  return atom.rhsVar !== null && isEmptyIn(nullBits, mask, atom.rhsVar);
}

/**
 * 整合する真理値割り当て(ビットマスク)だけを列挙する。finite 割り当てには依存しない。
 *
 * **空の欄の比較原子には順序の制約を 1 本も置かない。** その欄に値が無い割り当てでは比較は
 * 真でも偽でもなく「成立しない」だけなので、否定側の制約(`x < 5` が偽 → `x >= 5`)を張ると
 * 在りもしない値の位置を縛り、**本当は充足できる割り当てを取り落とす**。
 *
 * @param plan 列挙計画
 * @param maskCount 真理値割り当ての総数(2^原子数)
 * @returns 順序として整合する割り当て(ビットマスク)の並び
 */
export function consistentMasks(plan: Plan, maskCount: number): readonly number[] {
  const masks: number[] = [];
  for (let mask = 0; mask < maskCount; mask += 1) {
    const constraints: OrderConstraint[] = [...plan.constantDisequalities];
    plan.freeAtoms.forEach((entry, i) => {
      if (touchesEmpty(entry.atom, plan.nullBits, mask)) return;
      constraints.push(...(((mask >> i) & 1) === 1 ? entry.positive : entry.negative));
    });
    if (isOrderConsistent(constraints, plan.numericNodes)) masks.push(mask);
  }
  return masks;
}

/**
 * 式を走査して列挙計画を組み立てる。
 *
 * @param expr 対象の式
 * @param env パス → ドメインの宣言
 * @returns 列挙計画(判定を諦めるなら `unsupported`)
 */
export function buildPlan(expr: GuardExpr, env: DomainEnv): Plan {
  const finiteVars = new Map<string, readonly string[]>();
  const freeAtoms = new Map<string, FreeAtom>();
  const numericNodes = new Map<string, number>();
  const opaqueConstants = new Set<string>();
  const discreteVars = new Set<string>();
  let unsupported = false;

  forEachAtom(expr, (atom) => {
    if (atom.kind === 'contains' || atom.kind === 'null') {
      freeAtoms.set(atom.key, { atom, positive: [], negative: [] });
      return;
    }
    const left = domainInComparison(env, atom.varKey, atom.op);
    const right =
      atom.rhsVar === null ? undefined : domainInComparison(env, atom.rhsVar, atom.op);

    if (left.kind === 'finite' || right?.kind === 'finite') {
      if (left.kind !== 'finite') {
        unsupported = true;
        return;
      }
      if (right !== undefined && right.kind !== 'finite') {
        unsupported = true;
        return;
      }
      if (!EQUALITY_ONLY_OPS.includes(atom.op)) unsupported = true;
      finiteVars.set(atom.varKey, left.values);
      if (right !== undefined && atom.rhsVar !== null) finiteVars.set(atom.rhsVar, right.values);
      return;
    }

    if (isOpaqueComparison(left, right) && !EQUALITY_ONLY_OPS.includes(atom.op)) unsupported = true;
    if (left.kind === 'opaque' && atom.rhsVar === null) opaqueConstants.add(atom.node);
    if (atom.numeric !== null) numericNodes.set(atom.node, atom.numeric);
    if (left.kind === 'ordered' && left.discrete === true) discreteVars.add(atom.varKey);

    const discrete = left.kind === 'ordered' && left.discrete === true;
    freeAtoms.set(atom.key, {
      atom,
      positive: constraintsOf(atom, true, discrete, numericNodes),
      negative: constraintsOf(atom, false, discrete, numericNodes),
    });
  });

  const entries = [...freeAtoms.values()];
  const nullBits = new Map<string, number>();
  entries.forEach((entry, i) => {
    if (entry.atom.kind === 'null') nullBits.set(entry.atom.varKey, i);
  });
  return {
    finiteVars: [...finiteVars].map(([key, values]) => ({ key, values })),
    freeAtoms: entries,
    freeIndex: new Map(entries.map((entry, i) => [entry.atom.key, i])),
    numericNodes,
    constantDisequalities: pairwiseDisequalities([...opaqueConstants]),
    discreteVars,
    nullBits,
    unsupported: unsupported || entries.length > MAX_FREE_ATOMS,
  };
}

/** どちらかの辺が opaque(等号比較しかできない不透明値)か。 */
function isOpaqueComparison(left: VariableDomain, right: VariableDomain | undefined): boolean {
  return left.kind === 'opaque' || right?.kind === 'opaque';
}

/** opaque ドメインでは相異なるリテラルは相異なる値を指す、という事実を制約にする。 */
function pairwiseDisequalities(constants: readonly string[]): readonly OrderConstraint[] {
  const constraints: OrderConstraint[] = [];
  for (let i = 0; i < constants.length; i += 1) {
    for (let j = i + 1; j < constants.length; j += 1) {
      const left = constants[i];
      const right = constants[j];
      if (left !== undefined && right !== undefined) constraints.push({ kind: 'ne', left, right });
    }
  }
  return constraints;
}
