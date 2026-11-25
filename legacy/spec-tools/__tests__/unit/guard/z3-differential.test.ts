/**
 * 充足性判定の**差分テスト**: 既製品(Z3)⇔ 自作の列挙器。
 *
 * 仕様: docs/rules/decisions/common/ADR-0012-db-as-authority.md ⑤(束 ⑳-5c)
 *       BACKLOG「形式手法の導入」(b) Z3 を前倒し
 *       写像: legacy/spec-tools/lib/guard/smt.ts / 判定: legacy/spec-tools/lib/guard/z3.ts
 *
 * **判定の正は Z3** である(V9 / V10 は Z3 の答えを使う)。自作の列挙器
 * (`lib/guard/satisfiability.ts`)は**先読み**として残る —— 同期で呼べる場所(V8・UX・画面・
 * SQL の畳み込み)がまだ列挙器を使うので、2 つの判定が食い違ったままになると、同じ 1 つの
 * 宣言に対して**場所によって違う答え**が出る。だから「食い違わない」は気持ちではなく実測で
 * なければならない —— fast-check が式と `DomainEnv` を振り、両者の verdict を突き合わせる。
 *
 * 振るもの: 文法の全構成要素(比較 6 種・`in` / `not in` / `contains` / `and` / `or` / `not`・
 * 予約語 `now`・リテラル右辺とパス右辺・綴り違いのリテラル)と、**宣言の無いパス**
 * (`DomainEnv` に値域が無い = 値が分からない欄)。列挙器が `unknown` を返した式は
 * 食い違いに数えず、「**Z3 だけが答えた**」として件数を記録する(= 前倒しの実測)。
 *
 * 反例(witness)は、両者の答えをこのファイルの評価器にかけて「式が真になる」ことを見る。
 * 自由な `Bool` に逃がした原子(写像が緩めた部分)は値を持たないので `partial` として飛ばす。
 */

import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import type { DomainEnv, GuardExpr, Satisfiability, VariableDomain } from '../../../lib/guard/ast.js';
import { compareAtom, domainInComparison, literalText, pathKey } from '../../../lib/guard/atoms.js';
import { parseFormalGuard } from '../../../lib/guard/parser.js';
import { satisfiability } from '../../../lib/guard/satisfiability.js';
import { encodingOf } from '../../../lib/guard/smt.js';
import { EMPTY_WITNESS } from '../../../lib/guard/witness.js';
import { satisfiabilityByZ3, shutdownZ3 } from '../../../lib/guard/z3.js';

/** 実測値(報告に載せる)。 */
const stats = {
  compared: 0,
  agreed: 0,
  z3Only: 0,
  z3Unknown: 0,
  witnessTrue: 0,
  witnessPartial: 0,
};

afterAll(async () => {
  await shutdownZ3();
  console.log(
    `[Z3 差分テスト 実測] 突合 ${stats.compared} 件 / 一致 ${stats.agreed} 件 / ` +
      `列挙器が unknown で Z3 が答えた ${stats.z3Only} 件 / Z3 も unknown ${stats.z3Unknown} 件 / ` +
      `反例の検算 真 ${stats.witnessTrue} 件・判定不能(緩めた原子) ${stats.witnessPartial} 件`,
  );
});

// ---------------------------------------------------------------- 環境と式を振る

const STATES = ['draft', 'published', 'closed'] as const;
const OTHER_STATES = ['draft', 'closed'] as const;
const KINDS = ['alpha', 'beta'] as const;
const TIME_LITERALS = ['2020-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2030-01-01T00:00:00Z'] as const;
// uuid の字面はガード式の語彙(識別子・数・日時)に無いので、参照値は記号で置く。
const OPAQUE_LITERALS = ['owner_a', 'owner_b'] as const;
const EQ_OPS = ['==', '!='] as const;
const ORDER_OPS = ['<', '<=', '>', '>='] as const;
const ALL_OPS = [...EQ_OPS, ...ORDER_OPS] as const;

/** `DomainEnv` を振る(同じパスの値域の宣言をいくつか取り替える)。 */
const envArb: fc.Arbitrary<DomainEnv> = fc
  .record({
    kindDomain: fc.constantFrom<VariableDomain>(
      { kind: 'finite', values: [...KINDS] },
      { kind: 'opaque' },
    ),
    cntDomain: fc.constantFrom<VariableDomain>(
      { kind: 'ordered', discrete: true },
      { kind: 'ordered' },
    ),
    otherCntDomain: fc.constantFrom<VariableDomain>(
      { kind: 'ordered', discrete: true },
      { kind: 'ordered' },
    ),
  })
  .map(
    ({ kindDomain, cntDomain, otherCntDomain }) =>
      new Map<string, VariableDomain>([
        ['doc.state', { kind: 'finite', values: [...STATES] }],
        ['other.state', { kind: 'finite', values: [...OTHER_STATES] }],
        ['doc.kind', kindDomain],
        ['doc.cnt', cntDomain],
        ['other.cnt', otherCntDomain],
        ['doc.fee', { kind: 'ordered' }],
        ['doc.opens_at', { kind: 'ordered' }],
        ['other.opens_at', { kind: 'ordered' }],
        ['doc.owner_id', { kind: 'opaque' }],
        ['doc.venue_id', { kind: 'opaque' }],
        ['actor.id', { kind: 'opaque' }],
        // `doc.undeclared` と `now` は**宣言を置かない**(用法から決まる側を振るため)。
      ]),
  );

/** 原子 1 つの字面(文法の全構成要素をここで尽くす)。 */
const atomArb: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(fc.constantFrom(...EQ_OPS), fc.constantFrom(...STATES)).map(([op, v]) => `doc.state ${op} ${v}`),
  // 綴り違い(値域に無いリテラル)も振る。値域の外の整数に写るので等号は成立し得ない。
  fc.constantFrom(...EQ_OPS).map((op) => `doc.state ${op} publik`),
  fc.constantFrom(...ORDER_OPS).map((op) => `doc.state ${op} draft`),
  fc.uniqueArray(fc.constantFrom(...STATES), { minLength: 1, maxLength: 3 }).map((vs) => `doc.state in [${vs.join(', ')}]`),
  fc.uniqueArray(fc.constantFrom(...STATES), { minLength: 1, maxLength: 2 }).map((vs) => `doc.state not in [${vs.join(', ')}]`),
  fc.constantFrom(...EQ_OPS).map((op) => `doc.state ${op} other.state`),
  fc.tuple(fc.constantFrom(...ALL_OPS), fc.constantFrom(...KINDS)).map(([op, v]) => `doc.kind ${op} ${v}`),
  fc.tuple(fc.constantFrom(...ALL_OPS), fc.integer({ min: -2, max: 3 })).map(([op, v]) => `doc.cnt ${op} ${v}`),
  fc.constantFrom(...ALL_OPS).map((op) => `doc.cnt ${op} other.cnt`),
  fc.tuple(fc.constantFrom(...ALL_OPS), fc.constantFrom('0.5', '2.5')).map(([op, v]) => `doc.fee ${op} ${v}`),
  fc.constantFrom(...ALL_OPS).map((op) => `now ${op} doc.opens_at`),
  fc.constantFrom(...ALL_OPS).map((op) => `doc.opens_at ${op} other.opens_at`),
  fc.tuple(fc.constantFrom(...ALL_OPS), fc.constantFrom(...TIME_LITERALS)).map(([op, v]) => `doc.opens_at ${op} ${v}`),
  fc.constantFrom(...EQ_OPS).map((op) => `doc.owner_id ${op} actor.id`),
  fc.tuple(fc.constantFrom(...EQ_OPS), fc.constantFrom(...OPAQUE_LITERALS)).map(([op, v]) => `doc.owner_id ${op} ${v}`),
  fc.constant('doc.tags contains actor.id'),
  // 「空かどうか」(束 ㉒)。`formal` だけに書ける語なので `parseFormalGuard` で開ける。
  fc.constantFrom('doc.venue_id is null', 'doc.venue_id is not null'),
  fc.constantFrom(...EQ_OPS).map((op) => `doc.venue_id ${op} owner_a`),
  // 宣言の無いパス(値域が分からない欄)。等号なら opaque・順序なら ordered として扱われる。
  fc.tuple(fc.constantFrom(...EQ_OPS), fc.constantFrom('foo', 'bar')).map(([op, v]) => `doc.undeclared ${op} ${v}`),
  fc.tuple(fc.constantFrom(...ORDER_OPS), fc.integer({ min: 0, max: 2 })).map(([op, v]) => `doc.undeclared ${op} ${v}`),
);

/** clause := [ not ] atom。 */
const clauseArb: fc.Arbitrary<string> = fc
  .tuple(fc.boolean(), atomArb)
  .map(([negated, atom]) => (negated ? `not ${atom}` : atom));

/** expr := clause ( ("and" | "or") clause )*。 */
const exprArb: fc.Arbitrary<string> = fc
  .tuple(clauseArb, fc.array(fc.tuple(fc.constantFrom('and', 'or'), clauseArb), { maxLength: 3 }))
  .map(([head, rest]) => rest.reduce((acc, [op, clause]) => `${acc} ${op} ${clause}`, head));

// ---------------------------------------------------------------- 反例の検算

/** 3 値。`partial` は「この反例からは決まらない」(写像が自由な Bool に緩めた原子)。 */
type Truth = boolean | 'partial';

/** 反例(パス → 値)のもとで式を評価する。決まらない部分は partial として畳む。 */
function evaluateWitness(expr: GuardExpr, witness: Readonly<Record<string, string>>, env: DomainEnv): Truth {
  switch (expr.kind) {
    case 'and':
      return and(evaluateWitness(expr.left, witness, env), evaluateWitness(expr.right, witness, env));
    case 'or':
      return or(evaluateWitness(expr.left, witness, env), evaluateWitness(expr.right, witness, env));
    case 'not': {
      const inner = evaluateWitness(expr.operand, witness, env);
      return inner === 'partial' ? 'partial' : !inner;
    }
    case 'compare':
      return compareValue(expr.path.segments.join('.'), expr.op, expr.rhs, witness, env);
    case 'in':
      return expr.values
        .map((value) => compareValue(pathKey(expr.path), '==', value, witness, env))
        .reduce<Truth>((acc, next) => or(acc, next), false);
    case 'contains':
      return 'partial';
    case 'null':
      return witness[pathKey(expr.path)] === EMPTY_WITNESS ? true : 'partial';
  }
}

/** Kleene の and。 */
function and(left: Truth, right: Truth): Truth {
  if (left === false || right === false) return false;
  return left === 'partial' || right === 'partial' ? 'partial' : true;
}

/** Kleene の or。 */
function or(left: Truth, right: Truth): Truth {
  if (left === true || right === true) return true;
  return left === 'partial' || right === 'partial' ? 'partial' : false;
}

/** 比較 1 つを反例のもとで評価する。 */
function compareValue(
  path: string,
  op: '==' | '!=' | '<' | '<=' | '>' | '>=',
  rhs: Parameters<typeof compareAtom>[2],
  witness: Readonly<Record<string, string>>,
  env: DomainEnv,
): Truth {
  const atom = compareAtom({ segments: path.split('.') }, op, rhs);
  // 空の欄に触れる比較は、どちらの写像でも偽に閉じている(束 ㉒)。
  const rhsKey = rhs.kind === 'path' ? pathKey(rhs.path) : null;
  if (witness[path] === EMPTY_WITNESS) return false;
  if (rhsKey !== null && witness[rhsKey] === EMPTY_WITNESS) return false;
  // 写像が自由な Bool に緩めた原子は、反例が値を持っていても「決まらない」で正しい。
  if (encodingOf(atom, env) === 'free') return 'partial';
  const left = witness[path];
  const right = rhs.kind === 'path' ? witness[pathKey(rhs.path)] : literalText(rhs);
  if (left === undefined || right === undefined) return 'partial';
  if (op === '==' || op === '!=') {
    // 順序付きの値を数でない綴り(日時リテラル)と比べる形は、写像も列挙器も
    // 「その 2 つの並びは未知」と緩めている。だから反例からは決まらない。
    const numeric = Number.isFinite(Number(left)) && Number.isFinite(Number(right));
    if (!numeric && domainInComparison(env, path, op).kind === 'ordered') return 'partial';
    const same = equalValues(left, right);
    return op === '==' ? same : !same;
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return 'partial';
  if (op === '<') return leftNumber < rightNumber;
  if (op === '<=') return leftNumber <= rightNumber;
  if (op === '>') return leftNumber > rightNumber;
  return leftNumber >= rightNumber;
}

/** 値の一致(数に読めるものは数として比べる)。 */
function equalValues(left: string, right: string): boolean {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber === rightNumber;
  return left === right;
}

/** 反例を検算して統計に足す(false になったら反例が嘘)。 */
function checkWitness(expr: GuardExpr, witness: Readonly<Record<string, string>> | undefined, env: DomainEnv): void {
  if (witness === undefined) return;
  const truth = evaluateWitness(expr, witness, env);
  if (truth === 'partial') stats.witnessPartial += 1;
  else stats.witnessTrue += 1;
  expect(truth, `反例 ${JSON.stringify(witness)} で式が偽になりました`).not.toBe(false);
}

// ---------------------------------------------------------------- 差分テスト

describe('Z3 ⇔ 自作の列挙器', () => {
  it('verdict が一致する(列挙器が unknown の式は Z3 の答えだけを記録する)', async () => {
    await fc.assert(
      fc.asyncProperty(exprArb, envArb, async (source, env) => {
        const parsed = parseFormalGuard(source);
        expect(parsed.ok, `パースできません: ${source}`).toBe(true);
        if (!parsed.ok) return;
        const byEnumeration = satisfiability(parsed.expr, env);
        const byZ3 = await satisfiabilityByZ3(parsed.expr, env);

        if (byZ3.verdict === 'unknown') {
          stats.z3Unknown += 1;
        } else if (byEnumeration.verdict === 'unknown') {
          stats.z3Only += 1;
        } else {
          stats.compared += 1;
          expect(byZ3.verdict, `式: ${source}`).toBe(byEnumeration.verdict);
          stats.agreed += 1;
        }
        checkWitness(parsed.expr, byZ3.witness, env);
        checkWitness(parsed.expr, byEnumeration.witness, env);
      }),
      { numRuns: 300 },
    );

    expect(stats.compared).toBeGreaterThan(200);
    expect(stats.agreed).toBe(stats.compared);
  });

  it('列挙器の上限を超える式に Z3 が答える(前倒しの実測)', async () => {
    // ① 自由な原子が 12 個を超える(MAX_FREE_ATOMS)。
    const manyAtoms = Array.from({ length: 14 }, (_, i) => `doc.cnt > ${i}`).join(' and ');
    // ② finite 変数の直積が 100 万を超える(MAX_FINITE_PRODUCT)。
    const wideEnv = new Map<string, VariableDomain>(
      Array.from({ length: 7 }, (_, i) => [
        `doc.f${i}`,
        { kind: 'finite', values: Array.from({ length: 10 }, (_, v) => `v${v}`) },
      ]),
    );
    const wide = Array.from({ length: 7 }, (_, i) => `doc.f${i} == v0`).join(' and ');
    const env: DomainEnv = new Map<string, VariableDomain>([
      ['doc.cnt', { kind: 'ordered', discrete: true }],
    ]);

    const cases: readonly { readonly source: string; readonly env: DomainEnv; readonly verdict: Satisfiability }[] = [
      { source: manyAtoms, env, verdict: 'satisfiable' },
      { source: `${manyAtoms} and doc.cnt < 0`, env, verdict: 'unsatisfiable' },
      { source: wide, env: wideEnv, verdict: 'satisfiable' },
    ];

    for (const testCase of cases) {
      const parsed = parseFormalGuard(testCase.source);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(satisfiability(parsed.expr, testCase.env).verdict).toBe('unknown');
      const byZ3 = await satisfiabilityByZ3(parsed.expr, testCase.env);
      expect(byZ3.verdict, `式: ${testCase.source}`).toBe(testCase.verdict);
      stats.z3Only += 1;
    }
  });
});
