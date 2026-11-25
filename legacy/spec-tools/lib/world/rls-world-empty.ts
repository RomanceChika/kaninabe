/**
 * world の行で**空のままにする欄 / 値が要る欄**を、不変条件の宣言から読む写像(束 ㉒ / §14)。
 *
 * `rls-world-values.ts` は「DB に入らなければ話にならない」という理由で、束縛・境界の都合が
 * ある欄には任意でも値を置く。ところが「空かどうか」を問う不変条件(`{集約}.{欄} is null`)が
 * 入ると、その既定が**行を入らなくする**ことがある —— 状態と欄の有無が同値である宣言では、
 * 初期状態の行に値を置いた瞬間に執行点が拒否する。
 *
 * 読むのは `check` の形式定義だけで、読み方は `claimImplications` と同じ深さに留める:
 *
 * 1. 式を `or` で開く(「〜なら〜である」を行内比較で書いたときの形)。
 * 2. 各項を**その行の状態のもとで**評価する。world の行は状態の列に値を置かないので既定は
 *    初期状態であり(`initialStatesOf`)、確定値として使えるのは状態の欄だけである。
 *    **`when` の反例の行だけは状態を明に置く**ので、そのときは置いた状態で評価する(§14)。
 * 3. 真の項があれば、その不変条件は world の行で既に満たされているので何も要求しない。
 * 4. 偽でない項が**ちょうど 1 つ**なら、その項を満たすほかない。その項の連言に現れる
 *    `{自集約}.{欄} is null`(否定の付かないもの)は**空にする欄**、`is not null`
 *    (`not` に包まれた形)は**値が要る欄**である。
 *
 * 初期状態の行では `is not null` を要求として扱う必要が無い —— 任意の欄にも値を置くのが
 * 既定だからである。要るのは反例の行の側で、そこでは「状態を変えたぶん、一緒に埋めなければ
 * 執行点が拒否する欄」を知らなければならない。
 *
 * 形が読めない式(偽でない項が 2 つ以上・状態で決まらない条件だけ)は何も返さない
 * ——**空にする / 埋めるのは、宣言から読めたときだけ**である。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { GuardExpr } from '../guard/ast.js';
import { parseFormalGuard } from '../guard/parser.js';
import type { SpecModel } from '../model/types.js';

/** 状態の割り当てのもとでの真理値。`unknown` = 状態の宣言だけでは決まらない。 */
type Truth = boolean | 'unknown';

/** 自集約の状態の欄 → その行の状態。 */
export type StateAssignment = ReadonlyMap<string, string>;

/** その状態の行に、不変条件が要求する欄の埋め方。 */
export interface FieldPresence {
  /** 空のままにしなければならない欄。 */
  readonly empty: ReadonlySet<string>;
  /** 値を置かなければならない欄(任意の欄でも埋める)。 */
  readonly filled: ReadonlySet<string>;
}

/** その集約の状態の欄 1 つと、その機械が持つ状態の全数。 */
export interface StateField {
  readonly field: string;
  readonly machine: string;
  readonly states: readonly string[];
  readonly initial: string;
}

/**
 * その集約の**状態の欄**の全数(機械の状態も連れてくる)。
 *
 * @param domain ドメイン仕様
 * @param entity 対象の集約
 * @returns 状態の欄(宣言順。状態の欄が無ければ空)
 */
export function stateFieldsOf(domain: SpecModel, entity: string): readonly StateField[] {
  const found: StateField[] = [];
  for (const specs of domain.aggregates.values()) {
    if (specs.entity?.entity !== entity) continue;
    for (const field of specs.entity.fields) {
      const type = field.type;
      if (type.kind !== 'state') continue;
      const machine = specs.stateMachines.find((candidate) => candidate.machine === type.machine);
      if (machine === undefined) continue;
      found.push({
        field: field.name,
        machine: machine.machine,
        states: machine.states,
        initial: machine.initial,
      });
    }
  }
  return found;
}

/**
 * その集約の**状態の欄 → 初期状態**の表。
 *
 * @param domain ドメイン仕様
 * @param entity 対象の集約
 * @returns 欄名 → 初期状態(状態の欄が無ければ空)
 */
export function initialStatesOf(domain: SpecModel, entity: string): StateAssignment {
  return new Map(stateFieldsOf(domain, entity).map((state) => [state.field, state.initial]));
}

/**
 * その集約の行で、**空のままにしなければならない欄**(初期状態の行)。
 *
 * @param domain ドメイン仕様
 * @param entity 対象の集約
 * @returns 空にする欄の名前(宣言から読めなければ空)
 */
export function emptyFieldsOf(domain: SpecModel, entity: string): ReadonlySet<string> {
  return fieldPresenceOf(domain, entity, initialStatesOf(domain, entity)).empty;
}

/**
 * その状態の行で、不変条件が**空を要求する欄と値を要求する欄**。
 *
 * @param domain ドメイン仕様
 * @param entity 対象の集約
 * @param states その行の状態(状態の欄 → 状態)
 * @returns 空にする欄と、値を置く欄
 */
export function fieldPresenceOf(
  domain: SpecModel,
  entity: string,
  states: StateAssignment,
): FieldPresence {
  const empty = new Set<string>();
  const filled = new Set<string>();
  for (const specs of domain.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      if (invariant.formal?.kind !== 'check') continue;
      const parsed = parseFormalGuard(invariant.formal.expr);
      if (!parsed.ok) continue;
      const required = requiredPresence(parsed.expr, entity, states);
      for (const name of required.empty) empty.add(name);
      for (const name of required.filled) filled.add(name);
    }
  }
  return { empty, filled };
}

/** 不変条件 1 本が、その状態の行に要求する「空の欄」と「値が要る欄」。 */
function requiredPresence(
  expr: GuardExpr,
  entity: string,
  states: StateAssignment,
): { readonly empty: readonly string[]; readonly filled: readonly string[] } {
  const terms = disjuncts(expr).map((term) => ({ term, truth: truthUnder(term, entity, states) }));
  if (terms.some((entry) => entry.truth === true)) return { empty: [], filled: [] };
  const live = terms.filter((entry) => entry.truth !== false);
  const only = live.length === 1 ? live[0] : undefined;
  if (only === undefined) return { empty: [], filled: [] };
  const parts = conjuncts(only.term);
  return {
    empty: parts
      .map((term) => (term.kind === 'null' ? fieldName(term.path.segments, entity) : null))
      .filter((name): name is string => name !== null),
    filled: parts
      .map((term) =>
        term.kind === 'not' && term.operand.kind === 'null'
          ? fieldName(term.operand.path.segments, entity)
          : null,
      )
      .filter((name): name is string => name !== null),
  };
}

/** `or` で並んだ項に開く(`or` 以外はそれ自身 1 項)。 */
function disjuncts(expr: GuardExpr): readonly GuardExpr[] {
  return expr.kind === 'or' ? [...disjuncts(expr.left), ...disjuncts(expr.right)] : [expr];
}

/** `and` で並んだ項に開く(`and` 以外はそれ自身 1 項)。 */
function conjuncts(expr: GuardExpr): readonly GuardExpr[] {
  return expr.kind === 'and' ? [...conjuncts(expr.left), ...conjuncts(expr.right)] : [expr];
}

/**
 * その項が、与えた状態の行で真か偽か。
 *
 * 確定値として読めるのは自集約の状態の欄だけである。それ以外(任意の欄の値・別の集約・
 * 「空かどうか」そのもの)は `unknown` に倒す —— 決まらない側に倒しておけば、
 * 「満たすほかない項」を多めに数えることはあっても、取りこぼすことはない。
 *
 * @param term 判定する項
 * @param entity 自集約
 * @param states その行の状態
 * @returns 真理値(決まらなければ `unknown`)
 */
export function truthUnder(term: GuardExpr, entity: string, states: StateAssignment): Truth {
  switch (term.kind) {
    case 'and':
      return both(truthUnder(term.left, entity, states), truthUnder(term.right, entity, states));
    case 'or': {
      const left = truthUnder(term.left, entity, states);
      const right = truthUnder(term.right, entity, states);
      return negate(both(negate(left), negate(right)));
    }
    case 'not':
      return negate(truthUnder(term.operand, entity, states));
    case 'compare':
      return compareUnder(term, entity, states);
    case 'in':
      return memberUnder(term, entity, states);
    default:
      return 'unknown';
  }
}

/** 連言の真理値(偽が 1 つでもあれば偽・両方真なら真・それ以外は不明)。 */
function both(left: Truth, right: Truth): Truth {
  if (left === false || right === false) return false;
  return left === true && right === true ? true : 'unknown';
}

/** 真理値の否定(不明の否定は不明)。 */
function negate(truth: Truth): Truth {
  return truth === 'unknown' ? 'unknown' : !truth;
}

/** `{状態の欄} == / != {リテラル}` をその状態で評価する。 */
function compareUnder(
  term: Extract<GuardExpr, { kind: 'compare' }>,
  entity: string,
  states: StateAssignment,
): Truth {
  if (term.rhs.kind !== 'symbol' || (term.op !== '==' && term.op !== '!=')) return 'unknown';
  const state = stateOf(term.path.segments, entity, states);
  if (state === undefined) return 'unknown';
  return term.op === '==' ? state === term.rhs.value : state !== term.rhs.value;
}

/** `{状態の欄} in [...]` をその状態で評価する。 */
function memberUnder(
  term: Extract<GuardExpr, { kind: 'in' }>,
  entity: string,
  states: StateAssignment,
): Truth {
  const state = stateOf(term.path.segments, entity, states);
  if (state === undefined) return 'unknown';
  return term.values.some((value) => value.kind === 'symbol' && value.value === state);
}

/** そのパスが自集約の状態の欄なら、その行の状態。 */
function stateOf(
  segments: readonly string[],
  entity: string,
  states: StateAssignment,
): string | undefined {
  const name = fieldName(segments, entity);
  return name === null ? undefined : states.get(name);
}

/** `{集約}.{欄}` / 裸の `{欄}` を自集約の欄名に正規化する(別の集約なら `null`)。 */
function fieldName(segments: readonly string[], entity: string): string | null {
  if (segments.length === 1) return segments[0] ?? null;
  if (segments.length !== 2) return null;
  const [head, name] = segments;
  return head === entity && name !== undefined ? name : null;
}
