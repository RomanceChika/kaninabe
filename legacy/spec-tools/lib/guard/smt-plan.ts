/**
 * SMT の写像の**計画づくり**(smt.ts から切り出したもの)。
 *
 * 「何をどの sort で宣言するか」「原子 1 つをどう写すか」を決める規則だけを持つ。
 * 写した項の組み立ては smt.ts が持つ。
 */

import type { CompareOp, DomainEnv, GuardExpr, VariableDomain } from './ast.js';
import { domainInComparison, forEachAtom, type CompareAtom } from './atoms.js';
import { IDENTITY_RENAME, literalSymbol, type SmtRename } from './smt-names.js';
import type { SmtOptions } from './smt-types.js';

/** 等号だけを許す演算子。 */
const EQ_OPS: readonly CompareOp[] = ['==', '!='];

/**
 * 原子 1 つの写し方。
 *  - finite … 値の綴りを整数に符号化した等号
 *  - real   … 数(順序つき)の比較
 *  - free   … 自由な `Bool`(**写さずに緩めた**原子。反例の検算もここは飛ばす)
 */
export type EncodingKind = 'finite' | 'real' | 'free';

/** 写像を組み立てる途中の表。 */
export interface Plan {
  readonly finiteVars: Map<string, readonly string[]>;
  readonly realVars: Set<string>;
  readonly orderedVars: Set<string>;
  readonly discreteVars: Set<string>;
  readonly valueIndex: Map<string, number>;
  readonly literalConsts: Set<string>;
  readonly varLiterals: Map<string, Set<string>>;
  readonly opaqueNodes: Set<string>;
  readonly freeAtoms: Set<string>;
  /** 「空かどうか」を問われた欄のパス(相棒の `Bool` を宣言する)。 */
  readonly nullVars: Set<string>;
  readonly rename: SmtRename;
}

/** 式を走査して、何をどの sort で宣言するかを決める。 */
export function buildPlan(expr: GuardExpr, env: DomainEnv, options: SmtOptions): Plan {
  const plan: Plan = {
    finiteVars: new Map(),
    realVars: new Set(),
    orderedVars: new Set(),
    discreteVars: new Set(),
    valueIndex: options.valueIndex ?? new Map(),
    literalConsts: new Set(),
    varLiterals: new Map(),
    opaqueNodes: new Set(),
    freeAtoms: new Set(),
    nullVars: new Set(),
    rename: options.rename ?? IDENTITY_RENAME,
  };

  forEachAtom(expr, (atom) => {
    if (atom.kind === 'contains') {
      plan.freeAtoms.add(atom.key);
      return;
    }
    if (atom.kind === 'null') {
      plan.nullVars.add(atom.varKey);
      return;
    }
    const encoding = encodingOf(atom, env);
    declareVar(plan, atom.varKey, domainInComparison(env, atom.varKey, atom.op));
    if (atom.rhsVar !== null) {
      declareVar(plan, atom.rhsVar, domainInComparison(env, atom.rhsVar, atom.op));
    }
    if (encoding === 'free') {
      plan.freeAtoms.add(atom.key);
      return;
    }
    if (encoding === 'finite') {
      // 右辺がパスなら符号化は要らない(変数同士の等号になる)。
      if (atom.rhsVar === null) indexOf(plan, atom.text);
      return;
    }
    if (atom.rhsVar === null && atom.numeric === null) {
      plan.literalConsts.add(atom.text);
      const known = plan.varLiterals.get(atom.varKey) ?? new Set<string>();
      known.add(literalSymbol(atom.text));
      plan.varLiterals.set(atom.varKey, known);
    }
    if (atom.rhsVar === null && domainInComparison(env, atom.varKey, atom.op).kind === 'opaque') {
      plan.opaqueNodes.add(rhsTerm(atom));
    }
  });
  return plan;
}

/** 変数 1 つを宣言表に登録する(finite はその値域も)。 */
function declareVar(plan: Plan, path: string, domain: VariableDomain): void {
  if (domain.kind === 'finite') {
    plan.finiteVars.set(path, domain.values);
    for (const value of domain.values) indexOf(plan, value);
    return;
  }
  plan.realVars.add(path);
  if (domain.kind !== 'ordered') return;
  plan.orderedVars.add(path);
  if (domain.discrete === true) plan.discreteVars.add(path);
}

/**
 * 値の綴り → 整数(全変数で共有する 1 表。初出で採番する)。
 *
 * @param plan 組み立て中の表
 * @param value 値の綴り
 * @returns その綴りの整数
 */
export function indexOf(plan: Plan, value: string): number {
  return smtValueCode(plan.valueIndex, value);
}

/**
 * 値の綴りを整数に符号化する(表に無ければ採番して足す)。
 *
 * 写像の外(時間軸への展開)も**同じ表**で `state@0 = draft` を書くため、採番の規則は
 * ここ 1 か所に置く。
 *
 * @param valueIndex 共有する符号化表(追記される)
 * @param value 値の綴り
 * @returns その綴りの整数
 */
export function smtValueCode(valueIndex: Map<string, number>, value: string): number {
  const known = valueIndex.get(value);
  if (known !== undefined) return known;
  const next = valueIndex.size;
  valueIndex.set(value, next);
  return next;
}

/**
 * 原子 1 つの写し方を決める。
 *
 * finite への順序比較・finite と非 finite の比較・opaque への順序比較は、仕様としては
 * V2 が error にする形である。ここでは自由な `Bool` に逃がして**充足可能側に緩める**
 * (不能・恒真と誤って断じない)。
 *
 * @param atom 比較原子
 * @param env パス → ドメインの宣言
 * @returns その原子の写し方
 */
export function encodingOf(atom: CompareAtom, env: DomainEnv): EncodingKind {
  const left = domainInComparison(env, atom.varKey, atom.op);
  const right = atom.rhsVar === null ? undefined : domainInComparison(env, atom.rhsVar, atom.op);
  if (left.kind === 'finite' || right?.kind === 'finite') {
    const bothFinite = left.kind === 'finite' && (right === undefined || right.kind === 'finite');
    return bothFinite && EQ_OPS.includes(atom.op) ? 'finite' : 'free';
  }
  if ((left.kind === 'opaque' || right?.kind === 'opaque') && !EQ_OPS.includes(atom.op)) return 'free';
  return 'real';
}

/**
 * リテラル右辺を SMT の項へ。数値はその値・それ以外は綴りごとの自由定数。
 *
 * @param atom 比較原子
 * @returns 右辺の項
 */
export function rhsTerm(atom: CompareAtom): string {
  if (atom.numeric === null) return literalSymbol(atom.text);
  return atom.numeric < 0 ? `(- ${Math.abs(atom.numeric)})` : String(atom.numeric);
}
