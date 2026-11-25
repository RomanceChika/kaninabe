/**
 * ガード式を「原子(真理値を持つ最小単位)」に分解する共通部品。
 *
 * 充足性判定は、式の構造そのものではなく原子の集合と真理値割り当てで動く。
 * ここでは原子の同一性(key)の決め方と、パス・リテラルの正規化だけを定める。
 * `in` は等号原子の集まりに展開して数える(意味は同じで、原子が単純になる)。
 *
 * 比較の右辺はリテラルとパスの両方を取り得る(CompareRhs)。パス右辺は充足性判定では
 * 「順序グラフ上のもう 1 つのノード」として扱えばよいので、原子は右辺を
 * ノード名(node)・文字列表現(text)・パスかどうか(rhsVar)に正規化して保持する。
 */

import type {
  CompareOp,
  CompareRhs,
  DomainEnv,
  GuardExpr,
  Literal,
  PathRef,
  VariableDomain,
} from './ast.js';

/** 原子。key が等しい原子は式中のどこに現れても同じ真理値を持つ。 */
export type Atom =
  | {
      readonly kind: 'compare';
      readonly key: string;
      /** 左辺パスの正規化キー。 */
      readonly varKey: string;
      readonly op: CompareOp;
      /** 順序グラフ上の右辺ノード名。 */
      readonly node: string;
      /** finite ドメインの比較で突き合わせる右辺の文字列表現。 */
      readonly text: string;
      /** 右辺がパスならその正規化キー、リテラルなら null。 */
      readonly rhsVar: string | null;
      /** 右辺が数値リテラルならその値、それ以外は null。 */
      readonly numeric: number | null;
    }
  | { readonly kind: 'contains'; readonly key: string; readonly varKey: string }
  /**
   * `{path} is null`。`is not null` はパーサーが `not` に包むので**ここには現れない** ——
   * 2 つの綴りが同じ key の原子になり、`x is null and x is not null` が矛盾として読める。
   */
  | { readonly kind: 'null'; readonly key: string; readonly varKey: string };

/** 比較原子。 */
export type CompareAtom = Extract<Atom, { kind: 'compare' }>;

/**
 * パス参照の正規化キー。
 *
 * @param path 対象のパス
 * @returns "workshop.state" のようなドット表記
 */
export function pathKey(path: PathRef): string {
  return path.segments.join('.');
}

/**
 * 式に現れる原子を出現順に訪問する。
 *
 * @param expr 対象の式
 * @param visit 原子ごとに呼ばれるコールバック(同じ原子が複数回来ることがある)
 */
export function forEachAtom(expr: GuardExpr, visit: (atom: Atom) => void): void {
  switch (expr.kind) {
    case 'and':
    case 'or':
      forEachAtom(expr.left, visit);
      forEachAtom(expr.right, visit);
      return;
    case 'not':
      forEachAtom(expr.operand, visit);
      return;
    case 'compare':
      visit(compareAtom(expr.path, expr.op, expr.rhs));
      return;
    case 'in':
      for (const value of expr.values) visit(compareAtom(expr.path, '==', value));
      return;
    case 'contains':
      visit(containsAtom(expr.path, expr.ref));
      return;
    case 'null':
      visit(nullAtom(expr.path));
      return;
  }
}

/**
 * 比較原子を作る。
 *
 * @param path 左辺のパス
 * @param op 比較演算子
 * @param rhs 右辺(リテラルまたはパス)
 * @returns 正規化キー付きの原子
 */
export function compareAtom(path: PathRef, op: CompareOp, rhs: CompareRhs): CompareAtom {
  const varKey = pathKey(path);
  const node = rhsNode(rhs);
  return {
    kind: 'compare',
    key: `${varKey} ${op} ${node}`,
    varKey,
    op,
    node,
    text: rhsText(rhs),
    rhsVar: rhs.kind === 'path' ? pathKey(rhs.path) : null,
    numeric: rhs.kind === 'number' ? rhs.value : null,
  };
}

/**
 * contains 原子を作る。コレクションの中身は v1 では模型化せず自由な真偽値として扱う。
 *
 * @param path 左辺(コレクション)のパス
 * @param ref 右辺の参照パス
 * @returns 正規化キー付きの原子
 */
export function containsAtom(path: PathRef, ref: PathRef): Atom {
  const varKey = pathKey(path);
  return { kind: 'contains', key: `${varKey} contains ${pathKey(ref)}`, varKey };
}

/**
 * `is null` 原子を作る。
 *
 * 「値が無い」は変数のドメインの値ではなく**欄ごとの別軸**なので、key は比較原子の
 * 名前空間と重ならない綴りにする(`{path} is null`)。同じ欄への比較原子とは別の原子であり、
 * 両者の関係(空なら比較は成立しない)を張るかどうかは写す先ごとの判断である
 * (列挙器は張らず、SMT は相棒の `Bool` で張る)。
 *
 * @param path 左辺(空かどうかを問う欄)のパス
 * @returns 正規化キー付きの原子
 */
export function nullAtom(path: PathRef): Atom {
  const varKey = pathKey(path);
  return { kind: 'null', key: `${varKey} is null`, varKey };
}

/**
 * パスのドメインを引く。env に無いパスは opaque として扱う。
 * ただし予約語 `now` は domain-spec-writing.md が順序付き値と規定するため ordered を既定とする。
 *
 * @param env パス → ドメインの宣言
 * @param key パスの正規化キー
 * @returns そのパスのドメイン
 */
export function domainOf(env: DomainEnv, key: string): VariableDomain {
  return env.get(key) ?? (key === 'now' ? { kind: 'ordered' } : { kind: 'opaque' });
}

/**
 * 順序グラフ上の右辺ノード名。数値だけは値に基づく固定順序を持つので接頭辞で区別する。
 * パス右辺は変数ノード(左辺パスと同じ名前空間)になる。
 *
 * @param rhs 比較の右辺
 * @returns ノード名
 */
export function rhsNode(rhs: CompareRhs): string {
  if (rhs.kind === 'path') return pathKey(rhs.path);
  return rhs.kind === 'number' ? numericNode(rhs.value) : rhs.value;
}

/**
 * 数値定数のノード名。
 *
 * @param value 数値
 * @returns ノード名
 */
export function numericNode(value: number): string {
  return `#${value}`;
}

/**
 * finite ドメインの値(文字列)と突き合わせるための右辺の文字列表現。
 *
 * @param rhs 比較の右辺
 * @returns 比較用の文字列表現(パス右辺はその正規化キー)
 */
export function rhsText(rhs: CompareRhs): string {
  return rhs.kind === 'path' ? pathKey(rhs.path) : literalText(rhs);
}

/**
 * リテラルの文字列表現。
 *
 * @param literal 対象のリテラル
 * @returns 比較・反例表示用の文字列
 */
export function literalText(literal: Literal): string {
  return literal.kind === 'number' ? String(literal.value) : literal.value;
}

/**
 * 比較 1 つの文脈でのドメインを引く。
 *
 * env に宣言のあるパスはその宣言に従う。宣言が無いパスは**用法から決める**: 順序比較
 * (`< <= > >=`)に使われていれば ordered、そうでなければ opaque とする(`now >= workshop.open_at`
 * の右辺のように、宣言漏れで判定不能を量産しないため)。列挙器(satisfiability.ts)と
 * SMT の写像(smt.ts)が**同じ規則で**ドメインを引くように、ここ 1 か所に置く。
 *
 * @param env パス → ドメインの宣言
 * @param key パスの正規化キー
 * @param op その比較で使われている演算子
 * @returns そのパスのドメイン
 */
export function domainInComparison(env: DomainEnv, key: string, op: CompareOp): VariableDomain {
  if (env.has(key) || op === '==' || op === '!=') return domainOf(env, key);
  return { kind: 'ordered' };
}
