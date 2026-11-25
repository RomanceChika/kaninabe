/**
 * ガード式の充足性判定(**先読み**)。SMT ソルバーを使わず列挙で決める。
 *
 * **判定の正はここではない。** V9 / V10 の充足性は既製品(Z3)が判定する(`z3.ts` / `smt.ts`。
 * 束 ⑳-5c。規約: scripts-code-quality.md「推論・探索は既製品に任せ、写像だけを自作する」)。
 * ここが残るのは、**同期で呼べる場所**があるからである —— V8 の共存判定・UX の照合・画面の
 * 入場判定・SQL の畳み込みは同期の純関数の中にいて、非同期の判定器を待てない。そこでは
 * この列挙器が答え、答えられない式は `unknown`(= 報告しない側)に寄る。
 * Z3 と食い違わないことは fast-check の差分テスト(`__tests__/unit/guard/z3-differential.test.ts`)
 * が実測する —— 同じ宣言に場所ごとに違う答えが出るのが、いちばん不味い壊れ方である。
 *
 * アルゴリズム:
 *  1. 式に現れる原子を集める(`in` は等号原子に展開する。atoms.ts)。
 *  2. finite ドメイン(enum/state/boolean)の変数は取り得る値を**全列挙**する。
 *     比較の両辺が finite 変数でも、双方を列挙すればそのまま扱える。
 *  3. 残る原子(ordered / opaque / contains)は真理値の割り当てを全列挙し、
 *     各割り当ての連言が「順序 + 非等号」として整合するかを order-consistency で見る。
 *     比較の右辺がパスの場合(`now >= workshop.open_at`)は、右辺も順序グラフの
 *     ノードにするだけでよい。これにより区間の矛盾を検出できる。
 *  4. 真になる充足解と偽になる充足解の有無から satisfiable / unsatisfiable / tautology を決める。
 *     最初に見つけた真の充足解は witness(反例)として返す。
 *
 * 保守的な近似(いずれも「充足可能」側に倒す。誤って不能・恒真と断じない):
 *  - ordered 変数は既定で稠密。`discrete: true` が宣言された変数だけ整数として扱う。
 *  - 数値以外の定数(日時リテラル等)同士の順序は未知として自由に動かす。
 *  - `contains` の真偽は他の原子から独立に動く。
 *
 * **「空かどうか」(`is null`)は変数のドメインの値ではなく、欄ごとの別軸である**(束 ㉒)。
 * 真理値の割り当てとして自由に動くが、**その欄が空である割り当てでは、その欄の比較原子は
 * すべて偽**になる(値が無ければ比較は不明 → 不成立)。この 1 本の縛りだけを張るので
 * `x is null and x == v` は矛盾として読め、`x is null or x is not null` は恒真として読める。
 * SMT の写像(smt.ts)も**同じ縛りを相棒の `Bool` で張る** —— 2 つの判定器が同じ宣言に
 * 違う答えを出さないことは fast-check の差分テストが実測する。
 */

import type { CoexistResult, DomainEnv, GuardExpr, SatResult, Satisfiability } from './ast.js';
import { forEachAtom, type Atom } from './atoms.js';
import {
  buildPlan,
  consistentMasks,
  emptyVars,
  touchesEmpty,
  type FiniteVar,

} from './satisfiability-plan.js';
import { buildWitness } from './witness.js';

/**
 * finite 変数の直積の上限。これを超える式は列挙せず unknown を返す(計算量の暴走防止)。
 */
const MAX_FINITE_PRODUCT = 1_000_000;

/** (finite 直積) × (2^原子数) の上限。超える式は unknown を返す。 */
const MAX_WORK = 1_000_000;

/** 評価時の割り当て。finite は値、それ以外は mask のビットで真理値を与える。 */
interface Assignment {
  readonly finite: ReadonlyMap<string, string>;
  readonly mask: number;
  readonly freeIndex: ReadonlyMap<string, number>;
  /** 「空かどうか」を問われた欄 → その `is null` 原子のビット位置。 */
  readonly nullBits: ReadonlyMap<string, number>;
}

/**
 * 式の充足可能性を判定する。
 *
 * @param expr 判定対象の式
 * @param env パス → ドメインの宣言。env に無いパスは opaque(予約語 `now` だけは ordered)として扱う
 * @returns verdict と、真にできる場合はそれを実証する witness
 */
export function satisfiability(expr: GuardExpr, env: DomainEnv): SatResult {
  const plan = buildPlan(expr, env);
  if (plan.unsupported) return { verdict: 'unknown' };

  const product = plan.finiteVars.reduce((acc, v) => acc * v.values.length, 1);
  if (product === 0 || product > MAX_FINITE_PRODUCT) return { verdict: 'unknown' };
  const maskCount = 2 ** plan.freeAtoms.length;
  if (product * maskCount > MAX_WORK) return { verdict: 'unknown' };

  const masks = consistentMasks(plan, maskCount);
  const atoms = plan.freeAtoms.map((entry) => entry.atom);
  let witness: Readonly<Record<string, string>> | undefined;
  let sawTrue = false;
  let sawFalse = false;

  for (const finite of finiteAssignments(plan.finiteVars)) {
    for (const mask of masks) {
      if (evaluate(expr, { finite, mask, freeIndex: plan.freeIndex, nullBits: plan.nullBits })) {
        if (!sawTrue) {
          witness = buildWitness(finite, atoms, mask, plan.discreteVars, emptyVars(plan, mask));
        }
        sawTrue = true;
      } else {
        sawFalse = true;
      }
      if (sawTrue && sawFalse) return satResult('satisfiable', witness);
    }
  }

  if (!sawTrue) return { verdict: 'unsatisfiable' };
  return satResult(sawFalse ? 'satisfiable' : 'tautology', witness);
}

/** witness を持つときだけ載せた SatResult を作る(exactOptionalPropertyTypes 対応)。 */
function satResult(
  verdict: Satisfiability,
  witness: Readonly<Record<string, string>> | undefined,
): SatResult {
  return witness === undefined ? { verdict } : { verdict, witness };
}

/**
 * 2 つの式が同時に成立し得るか(V8 決定性チェック用)。
 *
 * @param a 片方のガード。undefined は「常に真」
 * @param b もう片方のガード。undefined は「常に真」
 * @param env パス → ドメインの宣言
 * @returns coexists と、同時に真にできる場合はその割当(witness)。判定不能でも coexists=true
 */
export function canCoexist(
  a: GuardExpr | undefined,
  b: GuardExpr | undefined,
  env: DomainEnv,
): CoexistResult {
  const combined: GuardExpr | undefined =
    a !== undefined && b !== undefined ? { kind: 'and', left: a, right: b } : (a ?? b);
  if (combined === undefined) return { coexists: true };

  const result = satisfiability(combined, env);
  if (result.verdict === 'unsatisfiable') return { coexists: false };
  return result.witness === undefined ? { coexists: true } : { coexists: true, witness: result.witness };
}

/** finite 変数の全組み合わせを列挙する(変数が無ければ空の割り当てを 1 つ)。 */
function* finiteAssignments(vars: readonly FiniteVar[]): Generator<ReadonlyMap<string, string>> {
  const counters = new Array<number>(vars.length).fill(0);
  for (;;) {
    const assignment = new Map<string, string>();
    vars.forEach((v, i) => assignment.set(v.key, v.values[counters[i] ?? 0] ?? ''));
    yield assignment;

    let digit = vars.length - 1;
    for (; digit >= 0; digit -= 1) {
      const next = (counters[digit] ?? 0) + 1;
      counters[digit] = next;
      if (next < (vars[digit]?.values.length ?? 0)) break;
      counters[digit] = 0;
    }
    if (digit < 0) return;
  }
}

/** 割り当てのもとで式を評価する。 */
function evaluate(expr: GuardExpr, assignment: Assignment): boolean {
  let result = false;
  switch (expr.kind) {
    case 'and':
      return evaluate(expr.left, assignment) && evaluate(expr.right, assignment);
    case 'or':
      return evaluate(expr.left, assignment) || evaluate(expr.right, assignment);
    case 'not':
      return !evaluate(expr.operand, assignment);
    default:
      forEachAtom(expr, (atom) => {
        result = result || atomValue(atom, assignment);
      });
      return result;
  }
}

/**
 * 原子 1 つの真理値。finite 変数の比較は値から直接、それ以外は mask のビットから読む。
 *
 * その欄が空である割り当てでは、**その欄の比較はすべて偽**である(値が無ければ比較は不明で
 * あり、最後に「不明 → 不成立」で畳まれる)。`is null` 原子そのものはビットから読む。
 */
function atomValue(atom: Atom, assignment: Assignment): boolean {
  if (atom.kind === 'compare') {
    if (touchesEmpty(atom, assignment.nullBits, assignment.mask)) return false;
    const left = assignment.finite.get(atom.varKey);
    if (left !== undefined) {
      const right = atom.rhsVar === null ? atom.text : assignment.finite.get(atom.rhsVar);
      const matches = left === right;
      return atom.op === '==' ? matches : !matches;
    }
  }
  const index = assignment.freeIndex.get(atom.key);
  if (index === undefined) return false;
  return ((assignment.mask >> index) & 1) === 1;
}
