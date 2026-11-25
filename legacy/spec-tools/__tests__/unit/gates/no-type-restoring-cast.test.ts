import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { renderLiteral } from '../../../lib/gen-kit/code-emit.js';
import { readTsTree } from '../../../lib/io/read-ts-tree.js';

/**
 * **生成するデータは型つきのまま運び、二段の型アサーションと `as any` で型を戻さない**
 * (scripts-code-quality.md「生成するデータは型つきのまま運ぶ」)。
 *
 * かつて表を組む関数は汎用の値型(`LiteralValue`)を返し、結果表が `as unknown as MachineTable`
 * で戻していた。エンジンの型の欄を変えても組み立ての箇所で型エラーにならず、発見が
 * 生成後の型検査やテストまで遅れた。いまは組み立てがエンジンの型を返し、文字列にする直前の
 * `renderLiteral` だけが「リテラルにできる形か」を型で見る。
 *
 * この検査は `lib/**` に残る**型を戻す形**を AST で数えて固定する。数えるのは 2 つ ——
 *
 * - **二段の型アサーション** … `x as A as B` / `(x as A) as B` / `<A><B>x`(間に `unknown` を
 *   挟む形も、そうでない形も、改行を挟んでも同じ)。前の版は文字列 `as unknown as` を行ごとに
 *   数えたので、`as object as X` や括弧で包んだ形・改行で割った形が通り抜けた
 * - **`as any`**(`<any>x`・`as any[]` を含む) … 型検査を切る最短の道
 *
 * 免除の一覧ではなく**その場の理由**(`型を戻す理由:` の行コメントが直前 8 行以内に要る)と、
 * ファイルごとの件数である。増やすと赤になる —— 増やす前に「型つきのまま運べないか」を考える
 * 口にする。コメントと文字列に書かれた綴りは AST の外なので数えない。
 */

const LIB_DIR = fileURLToPath(new URL('../../../lib/', import.meta.url));

/** 残してよい型を戻す形(`lib/` 相対のパス → 件数)。いまは 0 件(全部、型つきのまま運べた)。 */
const ALLOWED: Readonly<Record<string, number>> = {};

/** 理由の行コメントの目印。 */
const REASON_MARK = '型を戻す理由:';

/** 理由を探す範囲(キャストの行から上へ)。 */
const REASON_WINDOW = 8;

/** 型を戻す形 1 か所。 */
interface CastSite {
  readonly line: number;
  readonly shape: 'two-step' | 'as-any';
}

/** 型アサーション(`x as T` / `<T>x`)か。 */
function isAssertion(node: ts.Node): node is ts.AsExpression | ts.TypeAssertion {
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);
}

/** 括弧を外した中身。 */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/** `any` か `any[]`(入れ子の配列を含む)か。 */
function isAnyType(type: ts.TypeNode): boolean {
  if (type.kind === ts.SyntaxKind.AnyKeyword) return true;
  return ts.isArrayTypeNode(type) && isAnyType(type.elementType);
}

/**
 * 本文から型を戻す形を全部拾う。
 *
 * @param source ファイルの本文
 * @returns 出現順の `{ 行(1 始まり), 形 }`
 */
function castSites(source: string): readonly CastSite[] {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.ES2022, true);
  const found: CastSite[] = [];
  const lineOf = (node: ts.Node): number => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const visit = (node: ts.Node): void => {
    if (isAssertion(node)) {
      if (isAssertion(unwrap(node.expression))) found.push({ line: lineOf(node), shape: 'two-step' });
      if (isAnyType(node.type)) found.push({ line: lineOf(node), shape: 'as-any' });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('二段の型アサーションと as any で型を戻す形を増やさない', () => {
  const sources = readTsTree(LIB_DIR, 'lib/');

  it('走査の母集合が空でない(組み立てが壊れても緑にしない)', () => {
    expect(sources.size).toBeGreaterThan(500);
  });

  it('コード上の型を戻す形はファイルごとの宣言と一致する', () => {
    const counts: Record<string, number> = {};
    for (const [file, source] of sources) {
      const n = castSites(source).length;
      if (n > 0) counts[file.replace(/^lib\//, '')] = n;
    }
    expect(counts).toEqual(ALLOWED);
  });

  it('残る各箇所は直前に「型を戻す理由:」を持つ', () => {
    const missing: string[] = [];
    for (const file of Object.keys(ALLOWED)) {
      const source = sources.get(`lib/${file}`) ?? '';
      const lines = source.split('\n');
      for (const site of castSites(source)) {
        const window = lines.slice(Math.max(0, site.line - 1 - REASON_WINDOW), site.line - 1);
        if (!window.some((line) => line.includes(REASON_MARK))) missing.push(`${file}:${site.line}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('検出器のわざと壊す確認(迂回口を塞いでいる)', () => {
  it('as unknown as は数える(従来の形)', () => {
    expect(castSites('const a = x as unknown as Foo;')).toEqual([{ line: 1, shape: 'two-step' }]);
  });

  it('unknown 以外を挟む二段(as object as X)も数える', () => {
    expect(castSites('const a = x as object as Foo;')).toHaveLength(1);
  });

  it('括弧で包んだ二段((x as A) as B)も数える', () => {
    expect(castSites('const a = (x as unknown) as Foo;')).toHaveLength(1);
    expect(castSites('const a = ((x as A)) as Foo;')).toHaveLength(1);
  });

  it('改行を挟んだ二段も数える(`as` の直前は改行できないが、直後・括弧の中では割れる)', () => {
    expect(castSites('const a = x as\n  unknown as\n  Foo;')).toEqual([{ line: 1, shape: 'two-step' }]);
    expect(castSites('const a = (\n  x as unknown\n) as Foo;')).toEqual([{ line: 1, shape: 'two-step' }]);
  });

  it('山括弧の二段(<A><B>x)も数える', () => {
    expect(castSites('const a = <Foo><unknown>x;')).toHaveLength(1);
  });

  it('三段は 2 か所に数える', () => {
    expect(castSites('const a = x as A as B as C;')).toHaveLength(2);
  });

  it('as any・<any>x・as any[] を数える', () => {
    expect(castSites('const a = x as any;')).toEqual([{ line: 1, shape: 'as-any' }]);
    expect(castSites('const a = <any>x;')).toEqual([{ line: 1, shape: 'as-any' }]);
    expect(castSites('const a = x as any[][];')).toEqual([{ line: 1, shape: 'as-any' }]);
  });

  it('一段のアサーション・as const・satisfies は数えない', () => {
    expect(castSites("const a = x as Foo;\nconst b = [1] as const;\nconst c = { k: 1 } satisfies Foo;")).toEqual([]);
  });

  it('コメントと文字列の中の綴りは数えない', () => {
    const source = "// x as unknown as Foo\nconst t = 'x as unknown as Foo';\n/* y as any */";
    expect(castSites(source)).toEqual([]);
  });
});

describe('renderLiteral は型つきのデータをそのまま受ける', () => {
  /** エンジンの型と同じ形(interface。欄が任意のもの・入れ子を含む)。 */
  interface Rule {
    readonly by: string;
    readonly guard?: { readonly kind: string };
    readonly fields: readonly string[];
  }

  it('interface の値を渡せ、任意の欄が無ければ鍵も出ない', () => {
    const rule: Rule = { by: 'organizer', fields: ['a', 'b'] };
    expect(renderLiteral(rule)).toBe("{\n  by: 'organizer',\n  fields: ['a', 'b'],\n}");
    const withGuard: Rule = { by: 'organizer', guard: { kind: 'and' }, fields: [] };
    expect(renderLiteral(withGuard)).toBe("{\n  by: 'organizer',\n  guard: {\n    kind: 'and',\n  },\n  fields: [],\n}");
  });

  it('リテラルにできない型(関数の欄)は型で弾く', () => {
    // 主に確かめるのは型の検査(下の `@ts-expect-error` が `tsc` で赤になる)。実行時は入口が型の検査だけで済ませ、例外を投げないことを見る(15 回目 C15-2)。
    // @ts-expect-error 関数はリテラルにできない(`Literalizable` が never に落とす)
    const rendered = renderLiteral({ run: () => 1 });
    expect(typeof rendered).toBe('string');
  });
});
