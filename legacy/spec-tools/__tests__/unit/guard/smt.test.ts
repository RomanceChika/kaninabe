/**
 * ガード式 → SMT-LIB の**写像**の単体テスト(判定器は呼ばない)。
 *
 * 規約: docs/rules/process/common/specification/standards/domain-spec-writing.md §ガード式の文法
 *       写像表: legacy/spec-tools/lib/guard/smt.ts の冒頭
 *
 * 見るのは「仕様のドメインが SMT のどの sort・どの表明になるか」だけである
 * (判定が正しいかは Z3 と列挙器の差分テスト `z3-differential.test.ts` が実測する)。
 */

import { describe, expect, it } from 'vitest';
import type { DomainEnv, GuardExpr, VariableDomain } from '../../../lib/guard/ast.js';
import { parseGuard } from '../../../lib/guard/parser.js';
import { compareAtom } from '../../../lib/guard/atoms.js';
import { encodingOf, translateToSmt } from '../../../lib/guard/smt.js';

/** テスト用の環境。 */
const ENV: DomainEnv = new Map<string, VariableDomain>([
  ['doc.state', { kind: 'finite', values: ['draft', 'published'] }],
  ['other.state', { kind: 'finite', values: ['published', 'closed'] }],
  ['doc.cnt', { kind: 'ordered', discrete: true }],
  ['doc.fee', { kind: 'ordered' }],
  ['doc.opens_at', { kind: 'ordered' }],
  ['doc.owner_id', { kind: 'opaque' }],
]);

/** 式を写す(パースできない式はテストの書き間違い)。 */
function translate(source: string): { declarations: string; formula: string } {
  const parsed = parseGuard(source);
  expect(parsed.ok, source).toBe(true);
  if (!parsed.ok) return { declarations: '', formula: '' };
  const result = translateToSmt(parsed.expr, ENV);
  return { declarations: result.declarations, formula: result.formula };
}

/** 式を写して反例の読み直し表を得る。 */
function tables(source: string): ReturnType<typeof translateToSmt> {
  const parsed = parseGuard(source);
  expect(parsed.ok, source).toBe(true);
  const expr: GuardExpr = parsed.ok ? parsed.expr : { kind: 'in', path: { segments: ['x'] }, values: [] };
  return translateToSmt(expr, ENV);
}

describe('translateToSmt', () => {
  it('finite(state / enum / boolean)は Int と値域の表明になる', () => {
    const { declarations, formula } = translate('doc.state == published');
    expect(declarations).toContain('(declare-const |doc.state| Int)');
    expect(declarations).toContain('(assert (or (= |doc.state| 0) (= |doc.state| 1)))');
    expect(formula).toBe('(= |doc.state| 1)');
  });

  it('値域に無い綴りは値域の外の整数になる(等号が成立し得ない)', () => {
    const { declarations, formula } = translate('doc.state == publik');
    const index = /\(= \|doc\.state\| (\d+)\)$/u.exec(formula)?.[1];
    expect(index).toBeDefined();
    expect(declarations).not.toContain(`(= |doc.state| ${index ?? '?'})))`);
    expect(Number(index)).toBeGreaterThan(1);
  });

  it('finite 同士の等号は変数同士の等号になる(値の符号化を挟まない)', () => {
    const { formula } = translate('doc.state == other.state');
    expect(formula).toBe('(= |doc.state| |other.state|)');
  });

  it('ordered は Real、discrete: true なら整数の表明が付く', () => {
    const { declarations, formula } = translate('doc.cnt >= 3 and doc.fee < 2.5');
    expect(declarations).toContain('(declare-const |doc.cnt| Real)');
    expect(declarations).toContain('(assert (is_int |doc.cnt|))');
    expect(declarations).toContain('(declare-const |doc.fee| Real)');
    expect(declarations).not.toContain('(assert (is_int |doc.fee|))');
    expect(formula).toBe('(and (>= |doc.cnt| 3) (< |doc.fee| 2.5))');
  });

  it('負の数は SMT-LIB の単項マイナスになる', () => {
    expect(translate('doc.cnt > -2').formula).toBe('(> |doc.cnt| (- 2))');
  });

  it('数でないリテラル(日時)は自由な Real 定数になり、同じ綴りは同じ定数を指す', () => {
    const { declarations, formula } = translate(
      'doc.opens_at >= 2026-01-01T00:00:00Z or doc.opens_at == 2026-01-01T00:00:00Z',
    );
    expect(declarations.match(/declare-const \|lit!2026-01-01T00:00:00Z\| Real/gu)).toHaveLength(1);
    expect(formula).toContain('(>= |doc.opens_at| |lit!2026-01-01T00:00:00Z|)');
  });

  it('opaque は相異なるリテラルが相異なる値を指すことを distinct で張る', () => {
    const { declarations } = translate('doc.owner_id == owner_a or doc.owner_id == owner_b');
    expect(declarations).toContain('(assert (distinct |lit!owner_a| |lit!owner_b|))');
  });

  it('`in` は等号の or、`not in` はその否定になる', () => {
    expect(translate('doc.state in [draft, published]').formula).toBe(
      '(or (= |doc.state| 0) (= |doc.state| 1))',
    );
    expect(translate('doc.state not in [draft]').formula).toBe('(not (= |doc.state| 0))');
  });

  it('`contains` と、素直に写せない比較は自由な Bool になる', () => {
    const contains = translate('doc.tags contains actor.id');
    expect(contains.declarations).toContain('(declare-const |atom!doc.tags contains actor.id| Bool)');
    expect(contains.formula).toBe('|atom!doc.tags contains actor.id|');

    // finite への順序比較・opaque への順序比較は V2 が error にする形。写像は緩めるだけ。
    expect(translate('doc.state < published').formula).toBe('|atom!doc.state < published|');
    expect(translate('doc.owner_id > owner_a').formula).toBe('|atom!doc.owner_id > owner_a|');
  });

  it('同じ原子が 2 回現れても同じ Bool / 同じ変数を指す(真理値が割れない)', () => {
    const { declarations, formula } = translate('doc.tags contains actor.id and doc.tags contains actor.id');
    expect(declarations.match(/declare-const \|atom!doc\.tags contains actor\.id\| Bool/gu)).toHaveLength(1);
    expect(formula).toBe(
      '(and |atom!doc.tags contains actor.id| |atom!doc.tags contains actor.id|)',
    );
  });

  it('反例の読み直し表に finite の逆写像と、その変数と比べた定数が載る', () => {
    const finite = tables('doc.state == draft');
    const state = finite.variables.find((variable) => variable.path === 'doc.state');
    expect(state?.valueByIndex?.get(0)).toBe('draft');

    const opaque = tables('doc.owner_id == owner_a and doc.opens_at >= 2026-01-01T00:00:00Z');
    expect(opaque.variables.find((variable) => variable.path === 'doc.owner_id')?.literals).toEqual([
      '|lit!owner_a|',
    ]);
    expect(opaque.variables.find((variable) => variable.path === 'doc.opens_at')?.ordered).toBe(true);
    expect(opaque.literals.map((literal) => literal.text)).toEqual([
      'owner_a',
      '2026-01-01T00:00:00Z',
    ]);
  });

  it('宣言の無いパスは用法から決まる(等号は opaque・順序は ordered)', () => {
    const { declarations } = translate('doc.missing == foo and doc.missing < 3');
    expect(declarations).toContain('(declare-const |doc.missing| Real)');
    expect(declarations).not.toContain('(assert (is_int |doc.missing|))');
  });
});

describe('encodingOf', () => {
  it('写し方(finite / real / free)を原子ごとに決める', () => {
    const finite = compareAtom({ segments: ['doc', 'state'] }, '==', { kind: 'symbol', value: 'draft' });
    const real = compareAtom({ segments: ['doc', 'cnt'] }, '>', { kind: 'number', value: 1 });
    const mixed = compareAtom({ segments: ['doc', 'state'] }, '==', {
      kind: 'path',
      path: { segments: ['doc', 'cnt'] },
    });
    expect(encodingOf(finite, ENV)).toBe('finite');
    expect(encodingOf(real, ENV)).toBe('real');
    expect(encodingOf(mixed, ENV)).toBe('free');
  });
});

describe('translateToSmt の options(名前の付け替えと共有の値の表)', () => {
  /** 手 t の名前にする(時間軸への展開が渡すもの)。 */
  const at = (step: number) => (name: string): string => `${name}@${step}`;

  it('rename は変数のパスに効く(手ごとに別の変数になる)', () => {
    const parsed = parseGuard('doc.state == draft');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = translateToSmt(parsed.expr, ENV, { rename: at(3) });

    expect(result.declarations).toContain('(declare-const |doc.state@3| Int)');
    expect(result.formula).toContain('|doc.state@3|');
  });

  it('rename は自由な Bool に逃がした原子にも効く(同じ原子が手をまたいで縛られない)', () => {
    const parsed = parseGuard('doc.tags contains doc.owner_id');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const first = translateToSmt(parsed.expr, ENV, { rename: at(0) });
    const second = translateToSmt(parsed.expr, ENV, { rename: at(1) });

    expect(first.formula).not.toBe(second.formula);
    expect(second.formula).toContain('@1');
  });

  it('リテラル定数には効かない(同じ綴りはどの手でも同じ定数)', () => {
    const parsed = parseGuard('doc.opens_at >= 2026-01-01T00:00:00Z');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = translateToSmt(parsed.expr, ENV, { rename: at(7) });

    expect(result.declarations).toContain('(declare-const |lit!2026-01-01T00:00:00Z| Real)');
  });

  it('valueIndex を共有すると、別々の写像でも同じ綴りが同じ整数になる', () => {
    const left = parseGuard('doc.state == published');
    const right = parseGuard('other.state == published');
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    const valueIndex = new Map<string, number>();

    const a = translateToSmt(left.expr, ENV, { valueIndex });
    const b = translateToSmt(right.expr, ENV, { valueIndex });
    const code = valueIndex.get('published');

    expect(code).toBeDefined();
    expect(a.formula).toBe(`(= |doc.state| ${code})`);
    expect(b.formula).toBe(`(= |other.state| ${code})`);
  });

  it('valueIndex を共有しなければ、同じ綴りが別の整数になりうる(世界が壊れる形)', () => {
    const left = parseGuard('doc.state == published');
    const right = parseGuard('other.state == published');
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;

    const a = translateToSmt(left.expr, ENV);
    const b = translateToSmt(right.expr, ENV);

    expect(a.formula).toBe('(= |doc.state| 1)');
    expect(b.formula).toBe('(= |other.state| 0)');
  });
});
