/**
 * ガード式(`GuardExpr` + `DomainEnv`)→ **SMT-LIB の写像**。判定はしない。
 *
 * 充足性の判定そのものは既製品(Z3)に任せる(2026-09-11 ユーザー原則:
 * 「推論・探索の道具は既製品を採り、写像だけを自作する」)。このモジュールが持つのは
 * **仕様の語を SMT の語へ写す規則だけ**であり、探索も推論も書かない。
 *
 * 写像表(左が仕様のドメイン、右が SMT):
 *  - finite(state / enum / boolean)… `Int`。値は **値の綴り → 整数**の 1 表(全変数で共有)で
 *    符号化し、変数には `(or (= v i1) (= v i2) …)` で値域を張る。宣言に無い綴り(綴り違い)は
 *    値域の外の整数になるので、その等号は自動的に不能になる。
 *  - ordered(integer / decimal / 日付 / `now`)… `Real`。`discrete: true`(整数)の変数だけ
 *    `(is_int v)` を張る —— `n > 1 and n < 2` の空区間はこれで不能になる。
 *  - opaque(uuid / ref)… 同じく `Real`。等号しか使えないので値の並びは意味を持たず、
 *    **相異なるリテラルが相異なる値を指す**という事実だけを `distinct` で張る。
 *  - 数値でないリテラル(日時の綴り等)… 自由な `Real` 定数。同じ綴りは同じ定数。
 *  - 上のどれにも素直に乗らない原子(finite への順序比較・opaque への順序比較・
 *    finite と非 finite の比較・`contains`)… **自由な `Bool`**(原子のキーで同一視)。
 *    式を「充足可能」側へ緩めるだけなので、不能・恒真を誤って断じることはない。
 *  - `x is null`(束 ㉒)… 欄ごとの**相棒の `Bool`**(`null!{パス}`)。値の変数のドメインには
 *    手を入れない —— 「空」はドメインの値ではなく別の軸である。相棒が真のとき**その欄に
 *    触れる比較原子は偽**になるよう、比較の項を `(and (not {相棒}) φ)` で包む。包むのは
 *    **同じ式に `is null` が現れた欄だけ**であり、現れない欄の写し方は 1 文字も変わらない。
 *    **写像は `required` を見ない** —— 相棒を立てるのは「同じ式に `is null` が現れた欄」だけで
 *    ある。空になりうる欄にしか書けないことを見るのは仕様の側の検査(**V10 が error**)であり、
 *    その検査を無視した式では相棒が「空になりうる」と読む側に緩む(= 充足側。判定は壊れない)。
 *
 * `not` の下では SMT が TS より緩む(TS は不明 → 不成立、SMT は `(not (and …))` = 真)ので、
 * 外れる向きは**常に充足側**である。自作の列挙器(satisfiability.ts)も同じ縛りを張る。
 *
 * 出力は文字列であり、同じ (式, 環境) は同じ文字列になる(結果の使い回しの鍵にできる)。
 */

import type { DomainEnv, GuardExpr } from './ast.js';
import {
  compareAtom,
  containsAtom,

  nullAtom,
  type CompareAtom,
} from './atoms.js';
import { atomSymbol, literalSymbol, nullSymbol, symbol } from './smt-names.js';
import { buildPlan, encodingOf, indexOf, rhsTerm, type Plan } from './smt-plan.js';
import type { SmtOptions, SmtTranslation, SmtVariable } from './smt-types.js';

export { encodingOf, smtValueCode, type EncodingKind } from './smt-plan.js';

export type {
  SmtLiteralConst,
  SmtNullVar,
  SmtOptions,
  SmtTranslation,
  SmtVariable,
} from './smt-types.js';

/** 比較演算子 → SMT の関数名(等号は否定で包むので別扱い)。 */
const ORDER_FN: Readonly<Record<string, string>> = { '<': '<', '<=': '<=', '>': '>', '>=': '>=' };

/**
 * ガード式を SMT-LIB へ写す。
 *
 * @param expr 対象の式
 * @param env パス → ドメインの宣言(無いパスは用法から決める。等号なら opaque・順序なら ordered)
 * @param options 名前の付け替えと、共有する値の符号化表(既定は付け替え無し)
 * @returns 宣言・項・反例を読み直すための表
 */
export function translateToSmt(expr: GuardExpr, env: DomainEnv, options: SmtOptions = {}): SmtTranslation {
  const plan = buildPlan(expr, env, options);
  const lines: string[] = [];
  const variables: SmtVariable[] = [];

  for (const [path, values] of plan.finiteVars) {
    const smtName = symbol(plan.rename(path));
    lines.push(`(declare-const ${smtName} Int)`);
    lines.push(`(assert ${domainTerm(smtName, values, plan)})`);
    variables.push({
      smtName,
      path,
      valueByIndex: new Map(values.map((value) => [indexOf(plan, value), value])),
    });
  }
  for (const path of plan.realVars) {
    const smtName = symbol(plan.rename(path));
    lines.push(`(declare-const ${smtName} Real)`);
    if (plan.discreteVars.has(path)) lines.push(`(assert (is_int ${smtName}))`);
    const literals = [...(plan.varLiterals.get(path) ?? [])];
    variables.push({
      smtName,
      path,
      ...(literals.length === 0 ? {} : { literals }),
      ...(plan.orderedVars.has(path) ? { ordered: true } : {}),
    });
  }
  const literals = [...plan.literalConsts].map((text) => ({ smtName: literalSymbol(text), text }));
  for (const literal of literals) lines.push(`(declare-const ${literal.smtName} Real)`);
  for (const key of plan.freeAtoms) lines.push(`(declare-const ${atomSymbol(key, plan.rename)} Bool)`);
  const nullVars = [...plan.nullVars].map((path) => ({ smtName: nullSymbol(path, plan.rename), path }));
  for (const nullVar of nullVars) lines.push(`(declare-const ${nullVar.smtName} Bool)`);

  const distinct = [...plan.opaqueNodes];
  if (distinct.length > 1) lines.push(`(assert (distinct ${distinct.join(' ')}))`);

  return {
    declarations: lines.join('\n'),
    formula: render(expr, env, plan),
    variables,
    literals,
    nullVars,
  };
}

/** finite 変数の値域(取り得る整数の並び)。値が無ければ矛盾(`false`)。 */
function domainTerm(smtName: string, values: readonly string[], plan: Plan): string {
  if (values.length === 0) return 'false';
  const equalities = values.map((value) => `(= ${smtName} ${indexOf(plan, value)})`);
  return equalities.length === 1 ? (equalities[0] ?? 'false') : `(or ${equalities.join(' ')})`;
}

/** 式を SMT の項へ写す。 */
function render(expr: GuardExpr, env: DomainEnv, plan: Plan): string {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return `(${expr.kind} ${render(expr.left, env, plan)} ${render(expr.right, env, plan)})`;
    case 'not':
      return `(not ${render(expr.operand, env, plan)})`;
    case 'compare':
      return renderAtom(compareAtom(expr.path, expr.op, expr.rhs), env, plan);
    case 'in': {
      const terms = expr.values.map((value) => renderAtom(compareAtom(expr.path, '==', value), env, plan));
      if (terms.length === 0) return 'false';
      return terms.length === 1 ? (terms[0] ?? 'false') : `(or ${terms.join(' ')})`;
    }
    case 'contains':
      return atomSymbol(containsAtom(expr.path, expr.ref).key, plan.rename);
    case 'null':
      return nullSymbol(nullAtom(expr.path).varKey, plan.rename);
  }
}

/** 比較原子 1 つを SMT の項へ写す(空の欄に触れる比較は相棒の `Bool` で偽に閉じる)。 */
function renderAtom(atom: CompareAtom, env: DomainEnv, plan: Plan): string {
  return notEmpty(atom, plan, comparisonTerm(atom, env, plan));
}

/**
 * 比較の項を「その欄が空でないこと」で包む。
 *
 * 包むのは**同じ式に `is null` が現れた欄に触れる比較だけ**である。現れない欄は相棒を
 * 持たないので、写し方はこの拡張の前と 1 文字も変わらない。
 */
function notEmpty(atom: CompareAtom, plan: Plan, term: string): string {
  const guards = [atom.varKey, atom.rhsVar]
    .filter((path): path is string => path !== null && plan.nullVars.has(path))
    .map((path) => `(not ${nullSymbol(path, plan.rename)})`);
  return guards.length === 0 ? term : `(and ${guards.join(' ')} ${term})`;
}

/** 比較原子 1 つの素の項(空かどうかは見ない)。 */
function comparisonTerm(atom: CompareAtom, env: DomainEnv, plan: Plan): string {
  const encoding = encodingOf(atom, env);
  if (encoding === 'free') return atomSymbol(atom.key, plan.rename);
  const left = symbol(plan.rename(atom.varKey));
  const right =
    atom.rhsVar !== null
      ? symbol(plan.rename(atom.rhsVar))
      : encoding === 'finite'
        ? String(indexOf(plan, atom.text))
        : rhsTerm(atom);
  if (atom.op === '==') return `(= ${left} ${right})`;
  if (atom.op === '!=') return `(not (= ${left} ${right}))`;
  return `(${ORDER_FN[atom.op] ?? '='} ${left} ${right})`;
}
