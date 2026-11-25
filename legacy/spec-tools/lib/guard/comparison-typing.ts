/**
 * ガード式の**比較の型一致**を見る純粋モジュール。
 *
 * リテラルの接地(literal-grounding.ts)は「値域が閉じた欄に実在しない値を書いた」を落とすが、
 * **値域が開いた欄**(数値・日時・uuid)と**演算子の選び方**は誰も見ていなかった。次の 3 つは
 * 式としても文法としても妥当なので、検査が無ければ緑のまま通る:
 *
 * | 書けてしまう式 | TS の評価器 | SQL |
 * |---|---|---|
 * | `doc.flag in [true]` | **常に不明 → 不成立**(`evaluateIn` が boolean を弾く) | `g.flag in ('true')` = 真になり得る |
 * | `doc.flag > false` | **常に不明 → 不成立**(`compareValues` が boolean の順序を弾く) | `false < true` で真になり得る |
 * | `entry.count == draft` | 型が食い違うので**常に不明 → 不成立** | `entry.count = 'draft'` が **22P02 で落ちる** |
 *
 * どれも「書けるが、書いた条件が永久に成立しない」= 仕様の誤りである。意味の正は TS の評価器
 * (`app/src/domain/engine/guard.ts`)であり、ここが直すのはその意味を**書けなくする**側である ——
 * 評価器を DB に合わせる(boolean に順序を入れる)道も選べたが、それは「不明 → 不成立」という
 * 3 値論理の骨格に例外を足すことになる(束 ⑳-1b の裁定)。
 *
 * SQL 翻訳器(lib/sql/guard-to-sql.ts)も同じ入力を失敗として返す。どちらが先に止めるかではなく、
 * **どちらも止める**のが 2 つの実行系を持つことの作法である。
 */

import type { CompareOp, CompareRhs, GuardExpr, Literal } from './ast.js';
import type { ValueKind } from './value-kind.js';
import { pathKey } from './atoms.js';

/** パス文字列 → 値の種別。ここに無いパスは種別が分からないので何も言わない。 */
export type ValueKindEnv = ReadonlyMap<string, ValueKind>;

/** 等値以外の比較演算子(順序比較)。 */
const ORDER_OPS: ReadonlySet<CompareOp> = new Set<CompareOp>(['<', '<=', '>', '>=']);

/**
 * ISO 8601 の日付・日時として読める字面。
 *
 * 日時リテラルは裸トークンなので、パーサーからは識別子(`draft`)と区別が付かない。
 * 日時の欄と比べてよいのはこの形だけである(正規形への畳み方は datetime.md と
 * `app/src/domain/engine/guard.ts` の `compareValues` が持つ)。
 */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** 型が食い違う比較 1 件(3 点セットの材料)。 */
export interface MistypedComparison {
  /** 左辺のパス(正規化キー)。 */
  readonly path: string;
  /** 左辺の値の種別。 */
  readonly kind: ValueKind;
  /** 演算子(`in` / `not in` はどちらも `in`)。 */
  readonly op: string;
  /** 右辺の字面(リテラルの値・パスの正規化キー)。 */
  readonly rhs: string;
  /** なぜ書けないか(そのまま Finding の message に載る)。 */
  readonly reason: string;
  /** どう直すか(そのまま Finding の suggestion に載る)。 */
  readonly suggestion: string;
}

/**
 * 式に現れる比較のうち、**TS の評価器が常に不明にする**(= 書いた条件が永久に成立しない)
 * ものを集める。
 *
 * @param expr 検査対象の式(パース済み)
 * @param kinds パス → 値の種別の宣言。ここに無いパスは種別が分からないので対象外
 * @returns 型が食い違う比較の一覧(同じ左辺・同じ演算子・同じ右辺は 1 件にまとめる)
 */
export function mistypedComparisons(
  expr: GuardExpr,
  kinds: ValueKindEnv,
): readonly MistypedComparison[] {
  const found = new Map<string, MistypedComparison>();
  walk(expr, kinds, (finding) => found.set(`${finding.path} ${finding.op} ${finding.rhs}`, finding));
  return [...found.values()];
}

/** 式を辿って原子ごとに判定する(左辺の種別が分からなければ何も言わない)。 */
function walk(
  node: GuardExpr,
  kinds: ValueKindEnv,
  emit: (finding: MistypedComparison) => void,
): void {
  switch (node.kind) {
    case 'and':
    case 'or':
      walk(node.left, kinds, emit);
      walk(node.right, kinds, emit);
      return;
    case 'not':
      walk(node.operand, kinds, emit);
      return;
    case 'compare': {
      const path = pathKey(node.path);
      const kind = kinds.get(path);
      if (kind === undefined) return;
      const finding = compareFinding(path, kind, node.op, node.rhs, kinds);
      if (finding !== null) emit(finding);
      return;
    }
    case 'in': {
      const path = pathKey(node.path);
      const kind = kinds.get(path);
      if (kind === undefined) return;
      for (const finding of inFindings(path, kind, node.values)) emit(finding);
      return;
    }
    case 'contains':
      return;
  }
}

/** `path op (literal | path)` 1 つの判定。 */
function compareFinding(
  path: string,
  kind: ValueKind,
  op: CompareOp,
  rhs: CompareRhs,
  kinds: ValueKindEnv,
): MistypedComparison | null {
  const text = rhsText(rhs);
  if (ORDER_OPS.has(op)) {
    const reason = orderReason(kind);
    if (reason !== null) {
      return { path, kind, op, rhs: text, reason, suggestion: orderSuggestion(kind, path) };
    }
  }
  if (rhs.kind === 'path') {
    const other = kinds.get(pathKey(rhs.path));
    if (other === undefined || other === kind) return null;
    return {
      path,
      kind,
      op,
      rhs: text,
      reason: `${path}(${kind})と ${text}(${other})は種別が違うので、この比較は決して成立しません`,
      suggestion:
        `同じ種別の欄どうしで比べてください(型が食い違う比較は TS の評価器が「不明」= 不成立にし、` +
        'SQL では実行時に型変換で落ちます)。',
    };
  }
  return literalFinding(path, kind, op, rhs);
}

/** `path in [...]` の判定(値の並びは等値比較の集まりとして数える)。 */
function inFindings(
  path: string,
  kind: ValueKind,
  values: readonly Literal[],
): readonly MistypedComparison[] {
  if (kind === 'boolean') {
    return [
      {
        path,
        kind,
        op: 'in',
        rhs: `[${values.map(literalText).join(', ')}]`,
        reason: `boolean の欄 ${path} は in で比べられません(この節は決して成立しません)`,
        suggestion: `${path} == true / ${path} == false のように等値で書いてください。`,
      },
    ];
  }
  const findings: MistypedComparison[] = [];
  for (const value of values) {
    const finding = literalFinding(path, kind, 'in', value);
    if (finding !== null) findings.push(finding);
  }
  return findings;
}

/** リテラルとの比較で、左辺の種別に対して書けない字面か。 */
function literalFinding(
  path: string,
  kind: ValueKind,
  op: string,
  literal: Literal,
): MistypedComparison | null {
  const text = literalText(literal);
  const expected = expectedLiteral(kind);
  if (expected === null || matchesKind(kind, literal)) return null;
  return {
    path,
    kind,
    op,
    rhs: text,
    reason: `${path} は ${kind} の欄ですが ${text} と比べています(この比較は決して成立しません)`,
    suggestion: `${path} と比べられるのは ${expected} だけです。綴りを直すか、比べる相手を変えてください。`,
  };
}

/** その種別の欄が順序で比べられないなら理由を返す。 */
function orderReason(kind: ValueKind): string | null {
  if (kind === 'boolean') {
    return 'boolean の欄は順序で比べられません(TS の評価器は boolean の順序比較を「不明」= 不成立にします)';
  }
  if (kind === 'opaque') {
    return 'uuid / ref の欄は順序で比べられません(同一性しか持たない値であり、SQL にも照合順序がありません)';
  }
  return null;
}

/** 順序比較を断ったときの直し方。 */
function orderSuggestion(kind: ValueKind, path: string): string {
  return kind === 'boolean'
    ? `${path} == true / ${path} == false のように等値で書いてください。`
    : `${path} は == / != / in でだけ比べてください(大小に意味を持たせたいなら、順序を持つ欄を別に宣言します)。`;
}

/** その種別の欄と比べられるリテラルの説明(比べる相手が決まらない種別は null)。 */
function expectedLiteral(kind: ValueKind): string | null {
  switch (kind) {
    case 'boolean':
      return 'true / false';
    case 'number':
      return '数値リテラル';
    case 'datetime':
      return 'ISO 8601 の日付・日時リテラル(例: 2026-01-01T00:00:00Z)';
    case 'text':
      return '記号・文字列のリテラル';
    case 'opaque':
      return 'uuid のリテラルか、同じ種別の欄';
  }
}

/** リテラルがその種別の欄に書ける字面か。 */
function matchesKind(kind: ValueKind, literal: Literal): boolean {
  switch (kind) {
    case 'number':
      return literal.kind === 'number';
    case 'datetime':
      return literal.kind === 'symbol' && ISO_DATETIME.test(literal.value);
    case 'boolean':
    case 'text':
    case 'opaque':
      return literal.kind === 'symbol';
  }
}

/** 比較の右辺の字面。 */
function rhsText(rhs: CompareRhs): string {
  return rhs.kind === 'path' ? pathKey(rhs.path) : literalText(rhs);
}

/** リテラルの字面。 */
function literalText(literal: Literal): string {
  return literal.kind === 'number' ? String(literal.value) : literal.value;
}
