/**
 * ガード式の再帰下降パーサー。
 *
 * 文法の正: domain-spec-writing.md §ガード式の文法。
 *   expr    := clause ( ("and" | "or") clause )*
 *   clause  := [ "not" ] atom
 *   atom    := path op (literal | path)
 *            | path [ "not" ] "in" "[" literal ("," literal)* "]"
 *            | path "contains" path
 *            | path "is" [ "not" ] "null"
 *   優先順位 not > and > or、すべて左結合、括弧なし。
 *
 * `is null` の口は**既定で閉じている**(`GuardParseOptions.allowNullTest`)。開けるのは
 * 不変条件の `formal` を読む口だけであり、ガード・`when`・`binding`・`filters` から呼ぶと
 * 「ここには書けない」とパースの段で断られる(設計: docs/design/null-literal-purchase.md)。
 * `is not null` は `not` に包んで返す —— `not in` と同じ扱いにすることで、2 つの綴りが
 * **同じ原子の否定**になり、原子の同一性を組み立て直さずに済む。
 *
 * 比較の右辺はリテラルとパスの区別が字句だけでは付かない(裸トークンは enum 値にも
 * パスにも見える)。ast.ts の CompareRhs の規定どおり、**ドットを含む** か
 * **予約語 actor / now で始まる** ものをパス、それ以外をリテラルとして解釈する。
 *
 * 失敗は例外ではなく GuardParseResult で返す。内部の制御フローにのみ例外を使い、
 * この関数の外へは漏らさない。
 */

import type {
  CompareOp,
  CompareRhs,
  GuardExpr,
  GuardParseError,
  GuardParseOptions,
  GuardParseResult,
  Literal,
  PathRef,
} from './ast.js';
import { isAnyKeyword, isKeyword, tokenize, type Token } from './lexer.js';
import { NULL_TEST_CLOSED } from './placement.js';

const COMPARE_OPS: readonly string[] = ['==', '!=', '<', '<=', '>', '>='];

/** 比較右辺でパス扱いにする予約語(ドットが無くてもパスとみなす)。 */
const RHS_PATH_ROOTS: readonly string[] = ['actor', 'now'];


/** パース中断用の内部例外(公開 API からは漏らさない)。 */
class ParseAbort extends Error {
  constructor(readonly detail: GuardParseError) {
    super(detail.message);
  }
}

/**
 * ガード式の生文字列をパースして AST を返す。
 *
 * @param source `guard` / `when` / `binding` / `where` に書かれた式
 * @param options 口の開け方(省略すると `is null` を断る)
 * @returns 成功なら AST、失敗なら位置(ソース文字列内のオフセット)付きのエラー
 */
export function parseGuard(source: string, options: GuardParseOptions = {}): GuardParseResult {
  const lexed = tokenize(source);
  if (!lexed.ok) return { ok: false, error: lexed.error };

  try {
    return { ok: true, expr: new Parser(lexed.tokens, options.allowNullTest === true).parseAll() };
  } catch (e) {
    if (e instanceof ParseAbort) return { ok: false, error: e.detail };
    throw e;
  }
}

/**
 * 不変条件の `formal`(`expr` / `where` / `if` / `then`)を読む口。
 *
 * **`is null` を開ける口はこれ 1 つである。** 生の `parseGuard` を `allowNullTest: true` で
 * 呼ぶ場所を散らさないのは、開いている場所の数を 1 つに保つためである。
 *
 * @param source `formal` に書かれた式
 * @returns 成功なら AST、失敗なら位置付きのエラー
 */
export function parseFormalGuard(source: string): GuardParseResult {
  return parseGuard(source, { allowNullTest: true });
}

/** トークン列に対する再帰下降パーサー。 */
class Parser {
  private pos = 0;
  private readonly end: Token;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly allowNullTest: boolean,
  ) {
    this.end = tokens[tokens.length - 1] ?? { kind: 'eof', text: '', offset: 0 };
  }

  /** 式全体をパースし、余りトークンが無いことを確認する。 */
  parseAll(): GuardExpr {
    const expr = this.parseOr();
    const rest = this.peek();
    if (rest.kind !== 'eof') this.abort(rest, `式の後に余分な "${rest.text}" があります`);
    return expr;
  }

  /** or は最も弱く結合する(左結合)。 */
  private parseOr(): GuardExpr {
    let left = this.parseAnd();
    while (isKeyword(this.peek(), 'or')) {
      this.advance();
      left = { kind: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  /** and は or より強く not より弱い(左結合)。 */
  private parseAnd(): GuardExpr {
    let left = this.parseClause();
    while (isKeyword(this.peek(), 'and')) {
      this.advance();
      left = { kind: 'and', left, right: this.parseClause() };
    }
    return left;
  }

  /** clause := [ "not" ] atom。not の多重適用は文法外なので受理しない。 */
  private parseClause(): GuardExpr {
    if (isKeyword(this.peek(), 'not')) {
      this.advance();
      const next = this.peek();
      if (isKeyword(next, 'not')) this.abort(next, 'not を続けて 2 つ書くことはできません');
      return { kind: 'not', operand: this.parseAtom() };
    }
    return this.parseAtom();
  }

  /** atom := path op literal | path in [..] | path not in [..] | path contains path | path is [not] null。 */
  private parseAtom(): GuardExpr {
    const path = this.parsePath();
    const token = this.peek();

    if (token.kind === 'operator') {
      this.advance();
      const op = token.text;
      if (!COMPARE_OPS.includes(op)) this.abort(token, `使えない比較演算子 "${op}" です`);
      return { kind: 'compare', path, op: op as CompareOp, rhs: this.parseCompareRhs() };
    }
    if (isKeyword(token, 'in')) {
      this.advance();
      return { kind: 'in', path, values: this.parseLiteralList() };
    }
    if (isKeyword(token, 'not') && isKeyword(this.peekAt(1), 'in')) {
      this.advance();
      this.advance();
      return { kind: 'not', operand: { kind: 'in', path, values: this.parseLiteralList() } };
    }
    if (isKeyword(token, 'contains')) {
      this.advance();
      return { kind: 'contains', path, ref: this.parsePath() };
    }
    if (isKeyword(token, 'is')) {
      this.advance();
      return this.parseNullTest(path, token);
    }
    return this.abort(
      token,
      `"${this.pathText(path)}" の後に比較演算子・in・contains・is null のいずれかが必要です`,
    );
  }

  /**
   * `is` を読んだあとの `[ "not" ] "null"`。
   *
   * 口が閉じている文脈では**式の意味に踏み込む前に**断る —— 「書けるが誰も見ない」を
   * 作らないためで、断り文は文法の誤りではなく置き場の誤りとして読める形にする。
   */
  private parseNullTest(path: PathRef, at: Token): GuardExpr {
    const negated = isKeyword(this.peek(), 'not');
    if (negated) this.advance();
    const nullToken = this.peek();
    if (!isKeyword(nullToken, 'null')) {
      this.abort(nullToken, `is の後に必要なのは null です("${this.describe(nullToken)}" が来ました)`);
    }
    this.advance();
    if (!this.allowNullTest) this.abort(at, NULL_TEST_CLOSED);
    const test: GuardExpr = { kind: 'null', path };
    return negated ? { kind: 'not', operand: test } : test;
  }

  /** path := name ( "." name )*。予約語は名前として使えない。 */
  private parsePath(): PathRef {
    return { segments: this.parseNameChain() };
  }

  /** name ( "." name )* を読む。 */
  private parseNameChain(): string[] {
    const segments: string[] = [this.expectName()];
    while (this.peek().kind === 'dot') {
      this.advance();
      segments.push(this.expectName());
    }
    return segments;
  }

  /** "[" literal ("," literal)* "]"。空リストは受理しない。 */
  private parseLiteralList(): readonly Literal[] {
    this.expectKind('lbracket', '"[" が必要です');
    const values: Literal[] = [this.parseLiteral()];
    while (this.peek().kind === 'comma') {
      this.advance();
      values.push(this.parseLiteral());
    }
    this.expectKind('rbracket', '"]" が必要です');
    return values;
  }

  /**
   * 比較の右辺を読む。裸トークンは字句だけではリテラルとパスを区別できないため、
   * ドットを含むか予約語(actor / now)で始まるものをパス、それ以外をリテラルとする。
   */
  private parseCompareRhs(): CompareRhs {
    const token = this.peek();
    if (token.kind === 'name' && !isAnyKeyword(token)) {
      const segments = this.parseNameChain();
      const root = segments[0] ?? '';
      if (segments.length > 1 || RHS_PATH_ROOTS.includes(root)) {
        return { kind: 'path', path: { segments } };
      }
      return { kind: 'symbol', value: root };
    }
    return this.parseLiteral();
  }

  /** 数値・日時・裸の識別子(ドット連結可)をリテラルとして読む。 */
  private parseLiteral(): Literal {
    const token = this.peek();
    if (token.kind === 'number') {
      this.advance();
      return { kind: 'number', value: Number(token.text) };
    }
    if (token.kind === 'datetime') {
      this.advance();
      return { kind: 'symbol', value: token.text };
    }
    if (token.kind === 'name' && !isAnyKeyword(token)) {
      return { kind: 'symbol', value: this.parseNameChain().join('.') };
    }
    return this.abort(token, `リテラルが必要ですが "${this.describe(token)}" が来ました`);
  }

  private expectName(): string {
    const token = this.peek();
    if (token.kind !== 'name' || isAnyKeyword(token)) {
      this.abort(token, `名前が必要ですが "${this.describe(token)}" が来ました`);
    }
    this.advance();
    return token.text;
  }

  private expectKind(kind: Token['kind'], message: string): Token {
    const token = this.peek();
    if (token.kind !== kind) this.abort(token, message);
    this.advance();
    return token;
  }

  private peek(): Token {
    return this.peekAt(0);
  }

  private peekAt(lookahead: number): Token {
    return this.tokens[this.pos + lookahead] ?? this.end;
  }

  private advance(): void {
    this.pos += 1;
  }

  private describe(token: Token): string {
    return token.kind === 'eof' ? '式の終わり' : token.text;
  }

  private pathText(path: PathRef): string {
    return path.segments.join('.');
  }

  private abort(token: Token, message: string): never {
    throw new ParseAbort({ message, offset: token.offset, length: token.text.length });
  }
}
