/**
 * 生成テストの**値の世界**(lib/usecase/plan-scenario-values.ts)のテスト。
 *
 * ここは**ガード式の意味論の 2 つ目の実装**である(1 つ目は実行時の `domain/engine/guard.ts`)。
 * 2 つ持つのは意図で、生成テストが確かめるのは「計画の判定 = エンジンの判定」だから ——
 * 同じ関数を呼んで比べても何も確かめたことにならない。だが**独立した 2 つ目である以上、
 * 2 つが同じ答えを出すこと自体は誰も確かめていなかった**(独立レビュー 9-A)。
 *
 * このファイルは 2 つを見る。
 *   1. 規約網羅 —— domain-spec-writing.md §ガード式の文法 の演算子・型・評価不能を 1 つずつ
 *   2. **差分テスト** —— 無作為な式と割当について `evaluate` と `evaluateGuard` が一致する
 *
 * 2 の対象から `contains` は外す。エンジンは「集合の所属は実行器が真偽値として解決して env に
 * 載せる」契約(`containsKey`)で評価するが、計画の `guardFacts` に `contains` の鍵は現れない
 * ので、場面側は評価不能として扱う —— **契約が違うのであって、実装が食い違っているのではない**。
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseGuard } from '../../../lib/guard/parser.js';
import type { GuardExpr } from '../../../lib/guard/ast.js';
import { guardExprData } from '../../../lib/guard/expr-data.js';
import type { Assignment, GuardVerdict } from '../../../lib/usecase/plan-scenario-values.js';
import {
  SCENARIO_FUTURE,
  SCENARIO_NOW,
  SCENARIO_PAST,
  candidatesOf,
  evaluate,
  placeholderOf,
  searchAssignment,
  seedsOf,
  variablesOf,
} from '../../../lib/usecase/plan-scenario-values.js';
import { evaluateGuard } from '@kaninabe/runtime/engine';
import type { GuardEnv, GuardExprData } from '@kaninabe/runtime/engine';
import type { FieldDef } from '../../../lib/model/types.js';

/** 式を 1 本パースする(テストの式が壊れていたら、そこで落とす)。 */
function parse(source: string): GuardExpr {
  const parsed = parseGuard(source);
  if (!parsed.ok) throw new Error(`テストの式がパースできません: ${source}`);
  return parsed.expr;
}

/** 場面側の評価器。 */
function scenario(source: string, env: Assignment): GuardVerdict {
  return evaluate(parse(source), env);
}

/** 実行時の評価器(同じ式を同じ割当で)。 */
function engine(source: string, env: Assignment): GuardVerdict {
  return evaluateGuard(guardExprData(parse(source)) as unknown as GuardExprData, env as GuardEnv);
}

describe('ガード式の評価(規約網羅)', () => {
  it('等値・不等値は型が合えば比べ、合わなければ評価できない', () => {
    expect(scenario('a.x == draft', { 'a.x': 'draft' })).toBe(true);
    expect(scenario('a.x == draft', { 'a.x': 'ready' })).toBe(false);
    expect(scenario('a.x != draft', { 'a.x': 'ready' })).toBe(true);
    expect(scenario('a.x == 3', { 'a.x': 'draft' })).toBe('unknown');
  });

  it('順序比較は数値・日時に効く', () => {
    expect(scenario('a.n > 3', { 'a.n': 4 })).toBe(true);
    expect(scenario('a.n <= 3', { 'a.n': 3 })).toBe(true);
    expect(scenario('a.t < now', { 'a.t': SCENARIO_PAST, now: SCENARIO_FUTURE })).toBe(true);
    expect(scenario('a.t >= now', { 'a.t': SCENARIO_PAST, now: SCENARIO_FUTURE })).toBe(false);
  });

  it('真偽値は等値でだけ比べられる', () => {
    expect(scenario('a.b == true', { 'a.b': true })).toBe(true);
    expect(scenario('a.b == false', { 'a.b': true })).toBe(false);
  });

  it('in は候補に含まれるかを見る(型が全部違えば評価できない)', () => {
    expect(scenario('a.x in [draft, ready]', { 'a.x': 'ready' })).toBe(true);
    expect(scenario('a.x in [draft, ready]', { 'a.x': 'done' })).toBe(false);
    expect(scenario('a.x in [1, 2]', { 'a.x': 'done' })).toBe('unknown');
  });

  it('and / or / not は 3 値論理(確定する側があれば確定する)', () => {
    expect(scenario('a.x == draft and a.y == 1', { 'a.x': 'ready' })).toBe(false);
    expect(scenario('a.x == draft or a.y == 1', { 'a.x': 'draft' })).toBe(true);
    expect(scenario('a.x == draft and a.y == 1', { 'a.x': 'draft' })).toBe('unknown');
    expect(scenario('not a.x == draft', { 'a.x': 'draft' })).toBe(false);
    expect(scenario('not a.x == draft', {})).toBe('unknown');
    expect(scenario('a.x not in [draft, ready]', { 'a.x': 'done' })).toBe(true);
  });

  it('値が env に無ければ評価できない(偽に潰さない)', () => {
    expect(scenario('a.x == draft', {})).toBe('unknown');
    expect(scenario('a.x == draft', { 'a.x': null })).toBe('unknown');
  });

  it('contains は場面側では評価できない(実行器が真偽値として解決する契約)', () => {
    expect(scenario('a.ids contains actor.id', { 'a.ids contains actor.id': true })).toBe('unknown');
  });
});

/** 差分テストで振るパス(2 つの評価器が同じ env の鍵で引くことも同時に確かめる)。 */
const PATHS = ['a.x', 'a.n', 'a.b'] as const;

/** 差分テストで振る値(文字列・数値・真偽値・空。鍵ごと欠けている場合も混ぜる)。 */
const VALUES = ['draft', 'ready', 0, 1, 2, true, false, null] as const;

/**
 * 無作為なガード式の字面(`contains` を除く文法の全域)。
 *
 * 文法の正は domain-spec-writing.md §ガード式の文法 ——
 * `expr := clause (("and" | "or") clause)*` / `clause := ["not"] atom` / 括弧は無い。
 */
function guardSource(): fc.Arbitrary<string> {
  const atom = fc.oneof(
    fc
      .tuple(
        fc.constantFrom(...PATHS),
        fc.constantFrom('==', '!=', '<', '<=', '>', '>='),
        fc.constantFrom('draft', 'ready', '0', '1', '2'),
      )
      .map(([path, op, rhs]) => `${path} ${op} ${rhs}`),
    fc.tuple(fc.constantFrom(...PATHS), fc.constantFrom(...PATHS)).map(([left, right]) => `${left} == ${right}`),
    fc
      .tuple(fc.constantFrom(...PATHS), fc.constantFrom('in', 'not in'), fc.constantFrom('[draft, ready]', '[0, 1]'))
      .map(([path, op, values]) => `${path} ${op} ${values}`),
  );
  const clause = fc.tuple(fc.boolean(), atom).map(([negated, text]) => (negated ? `not ${text}` : text));
  return fc
    .array(fc.tuple(fc.constantFrom('and', 'or'), clause), { minLength: 0, maxLength: 3 })
    .chain((rest) => clause.map((head) => rest.reduce((text, [op, next]) => `${text} ${op} ${next}`, head)));
}

/** 無作為な割当(鍵が無い = 値が届いていない場合も作る)。 */
function assignment(): fc.Arbitrary<Assignment> {
  return fc.dictionary(fc.constantFrom(...PATHS), fc.constantFrom(...VALUES), { maxKeys: PATHS.length });
}

describe('場面の評価器と実行時の評価器は同じ答えを出す(差分)', () => {
  it('無作為な式と割当で一致する', () => {
    fc.assert(
      fc.property(guardSource(), assignment(), (source, env) => {
        expect(engine(source, env)).toBe(scenario(source, env));
      }),
      { numRuns: 500 },
    );
  });

  it('場面が「成立する」と解いた割当は、実行時の評価器でも成立する', () => {
    fc.assert(
      fc.property(guardSource(), (source) => {
        const expr = parse(source);
        const variables = [...variablesOf(expr)].map((key) => ({
          key,
          candidates: [...VALUES],
        }));
        for (const want of [true, false]) {
          const solved = searchAssignment(variables, expr, want);
          if (solved === null) continue;
          expect(engine(source, solved)).toBe(want);
        }
      }),
      { numRuns: 200 },
    );
  });
});

/** 欄 1 つの宣言(既定値の判定に使う最小限)。 */
function field(type: FieldDef['type'], extra: Partial<FieldDef> = {}): FieldDef {
  return {
    name: 'f',
    type,
    label: 'f',
    description: 'f',
    location: { file: 'x.md', path: 'f' },
    ...extra,
  } as FieldDef;
}

describe('型から決まる候補と既定値', () => {
  it('状態は全状態、enum は宣言された値、真偽値は 2 値が候補になる', () => {
    expect(candidatesOf({ kind: 'state', machine: 'm' }, ['draft', 'ready'], [])).toEqual(['draft', 'ready']);
    expect(candidatesOf({ kind: 'enum', values: ['a', 'b'] }, [], [])).toEqual(['a', 'b']);
    expect(candidatesOf({ kind: 'boolean' }, [], [])).toEqual([true, false]);
  });

  it('数値は式に現れたリテラルとその前後が候補になる', () => {
    expect(candidatesOf({ kind: 'integer' }, [], seedsOf(parse('a.n > 3')))).toEqual(
      expect.arrayContaining([2, 3, 4]),
    );
  });

  it('数値の候補は欄が宣言した範囲で切られる(min: 0 の欄に -1 は出ない)', () => {
    // 種 = 0(`> 0` のリテラル)から作る `{0, -1, 1}` のうち、`-1` は entity_spec から導出した
    // CHECK(`{表}_{列}_range`)に当たる —— engine は許可するのに DB が 23514 で落ちるので、
    // 一致の証明が「判定の食い違い」として赤になる(束 ③-2 で fixture expenses が実測)。
    expect(candidatesOf({ kind: 'integer' }, [], seedsOf(parse('a.n > 0')), { min: 0 })).toEqual([0, 1]);
  });

  it('範囲の宣言が無い欄は従来どおり切られない', () => {
    expect(candidatesOf({ kind: 'integer' }, [], seedsOf(parse('a.n > 0')))).toEqual([0, -1, 1]);
  });

  it('上限も切る。切って空になったら辺の値 1 つに倒す(軸そのものが消えないように)', () => {
    expect(candidatesOf({ kind: 'integer' }, [], seedsOf(parse('a.n > 3')), { max: 3 })).toEqual([0, 2, 3]);
    expect(candidatesOf({ kind: 'integer' }, [], seedsOf(parse('a.n > 9')), { min: 20 })).toEqual([20]);
  });

  it('日時は現在時刻の前後 2 点、型が分からない欄も同じ 2 点になる', () => {
    expect(candidatesOf({ kind: 'datetime' }, [], [])).toEqual([SCENARIO_PAST, SCENARIO_FUTURE]);
    expect(candidatesOf(null, [], [])).toEqual([SCENARIO_PAST, SCENARIO_FUTURE]);
  });

  it('既定値は型が決める(真偽値は偽・enum は先頭・日時は未来・必須の文字列は空でない)', () => {
    expect(placeholderOf(field({ kind: 'boolean' }))).toBe(false);
    expect(placeholderOf(field({ kind: 'enum', values: ['a', 'b'] }))).toBe('a');
    expect(placeholderOf(field({ kind: 'datetime' }))).toBe(SCENARIO_FUTURE);
    expect(placeholderOf(field({ kind: 'string' }, { required: true }))).toBe('x');
    expect(placeholderOf(field({ kind: 'string' }))).toBeNull();
    expect(placeholderOf(null)).toBeNull();
  });
});

describe('シミュレーション上の現在時刻と実時計', () => {
  /**
   * **`SCENARIO_NOW` と実時計が、境界値のあいだで同じ側に居ること。**
   *
   * 同じ 1 つの締切の軸を、2 つの「今」が読む —— 一致の証明(実 DB)は実行する瞬間の時刻
   * (`now()` / `new Date()`)を、ハンドブックの結果表は `SCENARIO_NOW` を使う。前者は DB が
   * 同じ時計を読むので正しく、後者は生成物を決定的にするために要る(実時計を混ぜると
   * `generate:check` が日ごとに揺れる)。
   *
   * 2 つが**別の答えを出すのは、実時計が境界値を跨いだとき**である。そうなると結果表だけが
   * 「まだ締切前」と言い続ける —— 依存を宣言だけにせず、ここで機械に見させる(束 ⑳-5b-b)。
   * 赤くなったら直すのは時計ではなく **`SCENARIO_PAST` / `SCENARIO_FUTURE` の値**である。
   */
  it('締切の境界値は実時計を挟む(過ぎている値 < 実時刻 < まだの値)', () => {
    const now = Date.now();

    expect(Date.parse(SCENARIO_PAST)).toBeLessThan(now);
    expect(Date.parse(SCENARIO_FUTURE)).toBeGreaterThan(now);
  });

  it('シミュレーション上の現在時刻も同じ側に居る(結果表と証明が同じ境界を読む)', () => {
    expect(Date.parse(SCENARIO_PAST)).toBeLessThan(Date.parse(SCENARIO_NOW));
    expect(Date.parse(SCENARIO_FUTURE)).toBeGreaterThan(Date.parse(SCENARIO_NOW));
  });
});
