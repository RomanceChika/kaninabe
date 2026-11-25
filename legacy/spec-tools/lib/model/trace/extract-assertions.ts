/**
 * 注釈付きのテストブロックの**中身**を構文で切り出す純粋関数。
 *
 * **なぜ中身まで見るのか。** 「注釈 + テスト名 + ファイル」の 3 点は Z1 / A6 / A12 が完全に
 * 閉じているが、`it` の中身は誰も見ていなかった —— 検査の漏れ探し 2026-09-12 §5 の実測では、
 * 注釈付きのテストから `expect(` を**全部消しても全検査が緑**のまま、仕様側は「見張りテストあり」と
 * 数え続けた。テストの存在を数える仕組みは、テストが何も確かめていない状態と区別が付かない。
 *
 * 見るのは 2 つだけである(どちらも構文の下限であり、意味は見ない)。
 *   1. そのブロックに assert が 1 つでもあるか(**matcher の呼び出しで終わる** `expect(...)` の
 *      連鎖、または assert を含むヘルパへの呼び出し。`expect(x);` のように matcher を呼ばない
 *      ものは数えない —— 網の穴探し 2026-10-06 の M31。数え方は `matcher-asserts.ts`)
 *   2. assert が**ループの中にしか無い**か —— 母集合が空になった日に黙って緑になる形である
 *      (実測で注釈付き 10 件。全て「宣言と状態機械の交差だけがボタンになる」型)
 *
 * ヘルパ呼び出しも 2 の対象である(独立レビュー 束 ㉑ の 2-C)。「ループの中で
 * `expectCalls(...)` を呼ぶだけ」のブロックは、直接 assert が無いので error 段はヘルパ免除で
 * 抜け、warning 段は「直接 assert がある」が偽で成立しない —— **2 段のどちらにも掛からない
 * 空白**になっていた。呼び出しの位置(ループの中か外か)をここで事実として記録し、
 * ヘルパかどうかの判定(ファイル横断の集合が要る)は A16 に委ねる。
 *
 * ファイル I/O は行わない(I/O は lib/trace/scan.ts)。判定は A16 が行う。
 */

import { maskCode } from '../../io/mask-code.js';
import { matcherAssertionOffsets } from './matcher-asserts.js';
import type { CallSite } from '../../testcase/types.js';

/**
 * `expect(` の字面の有無(構文木で数える前の**安い前置きの絞り込み**。これが偽なら assert は
 * 無いので、パーサを呼ばない)。数えるのは `matcher-asserts.ts` が構文木で行う。
 */
const HAS_EXPECT = /\bexpect\s*\(/;

/** ループの構文(`for` / `while` / `forEach` / `map` / `flatMap`)。 */
const LOOP_HEAD = /\bfor\s*\(|\bwhile\s*\(|\.\s*(?:forEach|map|flatMap)\s*\(/g;

/** 呼び出しの識別子(`someHelper(` の `someHelper`)。 */
const CALLED_NAME = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;

/** 関数・定数の宣言の頭(ヘルパの候補。**本体が関数であることは別途確かめる**)。 */
const HELPER_DECL = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)|(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]/g;

/** テスト宣言(`it(` / `test.only(` …)の頭。 */
const TEST_HEAD = /\b(?:it|test)(?:\s*\.\s*[A-Za-z]+(?:\s*\([^)]*\))?)*\s*\(/g;

/** 注釈からテスト宣言を探す最大行数(extract-annotations.ts の LOOKAHEAD_LINES と揃える)。 */
const LOOKAHEAD_LINES = 5;

/** 1 ブロック分の事実(判定はしない)。 */
export interface TestBlockFacts {
  /** 注釈の `@tc`。 */
  readonly tcId: string;
  /** 注釈の行(1 始まり)。 */
  readonly line: number;
  /** ブロックを切り出せたか(構文が読めなかった場合は false。判定は保守側に倒す)。 */
  readonly readable: boolean;
  /** matcher で終わる `expect(...)` の数。 */
  readonly directAssertions: number;
  /** matcher で終わる `expect(...)` のうち、**ループの外**にあるものの数。 */
  readonly directAssertionsOutsideLoop: number;
  /** ブロック内で呼ばれている識別子(出現ごと。ヘルパ判定の材料)。 */
  readonly calls: readonly CallSite[];
}

/** `from` の位置から始まる `{ … }` の終端 index を返す(見つからなければ -1)。 */
function matchBrace(code: string, from: number): number {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `index` の位置(0 始まり)を 1 始まりの行番号にする。 */
function lineOf(code: string, index: number): number {
  return code.slice(0, index).split('\n').length;
}

/**
 * テスト宣言の頭から、**コールバック本体**の `{` を探す。
 *
 * 単に「最初の `{`」を取ると `test('…', async ({ page }) => {` の**分割代入の波括弧**を
 * 掴んでしまい、ブロックが `{ page }` の 1 行になる(実測で E2E の 1 本を取りこぼした)。
 * 矢印(`=>`)か `function` の引数の閉じ括弧から先を探す。
 */
function callbackBody(code: string, at: number): number {
  const arrow = code.indexOf('=>', at);
  const fn = code.indexOf('function', at);
  if (arrow !== -1 && (fn === -1 || arrow < fn)) return code.indexOf('{', arrow + 2);
  if (fn !== -1) {
    const params = code.indexOf(')', fn);
    return code.indexOf('{', params === -1 ? fn : params);
  }
  return code.indexOf('{', at);
}

/** 注釈の行の直後にあるテスト宣言のブロック範囲(`[開始, 終了]`)。 */
function blockRange(code: string, tagLine: number): readonly [number, number] | null {
  for (const match of code.matchAll(TEST_HEAD)) {
    const at = match.index ?? 0;
    const line = lineOf(code, at);
    if (line <= tagLine) continue;
    if (line > tagLine + LOOKAHEAD_LINES) return null;
    const open = callbackBody(code, at);
    if (open === -1) return null;
    const close = matchBrace(code, open);
    if (close === -1) return null;
    return [open, close];
  }
  return null;
}

/** ブロックの中のループの本体範囲(入れ子は外側だけで足りる)。 */
function loopRanges(block: string): ReadonlyArray<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  for (const match of block.matchAll(LOOP_HEAD)) {
    const at = match.index ?? 0;
    if (ranges.some(([from, to]) => at >= from && at <= to)) continue;
    const open = block.indexOf('{', at);
    if (open === -1) continue;
    const close = matchBrace(block, open);
    if (close === -1) continue;
    ranges.push([open, close]);
  }
  return ranges;
}

/** 読めなかったブロックの事実(何も数えない)。 */
function unreadable(tag: { readonly tcId: string; readonly line: number }): TestBlockFacts {
  return {
    tcId: tag.tcId,
    line: tag.line,
    readable: false,
    directAssertions: 0,
    directAssertionsOutsideLoop: 0,
    calls: [],
  };
}

/**
 * 1 ファイル分のソースから、注釈付きブロックの事実を集める。
 *
 * @param source テストファイルの中身(masked する前の生テキスト)
 * @param tags 注釈(`@tc` の ID と 1 始まりの行番号)
 * @returns ブロックごとの事実(注釈と同じ順)
 */
export function extractTestBlocks(
  source: string,
  tags: readonly { readonly tcId: string; readonly line: number }[],
): readonly TestBlockFacts[] {
  const code = maskCode(source);
  return tags.map((tag) => {
    const range = blockRange(code, tag.line);
    if (range === null) return unreadable(tag);
    const block = code.slice(range[0], range[1] + 1);
    const loops = loopRanges(block);
    const inLoop = (at: number): boolean => loops.some(([from, to]) => at >= from && at <= to);
    // 位置は `code`(マスクしたもの)と `source`(生)で一致する(`maskCode` は長さを変えない)。
    // 構文木はコメントの中の `expect(` を数えないので、生のほうを読ませる。
    const expects = matcherAssertionOffsets(source.slice(range[0], range[1] + 1));
    const calls: CallSite[] = [];
    for (const match of block.matchAll(CALLED_NAME)) {
      const name = match[1];
      if (name !== undefined) calls.push({ name, inLoop: inLoop(match.index ?? 0) });
    }
    return {
      tcId: tag.tcId,
      line: tag.line,
      readable: true,
      directAssertions: expects.length,
      directAssertionsOutsideLoop: expects.filter((at) => !inLoop(at)).length,
      calls,
    };
  });
}

/**
 * 宣言の頭から**関数の本体**の `{` を探す(見つからなければ -1)。
 *
 * ここが 2-A(独立レビュー 束 ㉑)の直しどころである。以前は「宣言より後の最初の `{`」を
 * 本体とみなしていたため、`const LIMIT = 3;` のような**値の定数**が、直後の別ブロック
 * (`describe(... => {`)を自分の本体として読み、そこに `expect(` があれば assert ヘルパとして
 * 登録された(実測 180 語。大半はただのローカル定数名で、`UNRELATED_LIMIT();` を呼ぶだけの
 * 空のテストが A16 を通った)。
 *
 * 見るのは構文の下限 2 つである。
 *   - 宣言の終わり(`;`)より**手前**に `=>` か `function` があること(値の定数を弾く)
 *   - その直後に本体の `{` が来ること(矢印なら空白だけ、`function` なら引数の `)` と
 *     戻り値の型注釈だけを挟む)—— `[1,2].map(x => x)` のような**式の中の矢印**が
 *     遠くの波括弧を本体と呼ぶのを防ぐ
 */
function helperBody(code: string, at: number): number {
  const semicolon = code.indexOf(';', at);
  const limit = semicolon === -1 ? code.length : semicolon;
  const arrow = code.indexOf('=>', at);
  const fn = code.indexOf('function', at);
  if (arrow !== -1 && arrow < limit && (fn === -1 || arrow < fn)) return braceAfter(code, arrow + 2, /^\s*$/);
  if (fn !== -1 && fn < limit) {
    const params = matchParen(code, code.indexOf('(', fn));
    if (params === -1) return -1;
    return braceAfter(code, params + 1, /^[\s:A-Za-z0-9_$<>,.[\]|&?]*$/);
  }
  return -1;
}

/** `from` の位置から始まる `( … )` の終端 index(見つからなければ -1)。 */
function matchParen(code: string, from: number): number {
  if (from === -1) return -1;
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `from` から次の `{` を返す。ただし間に挟まる字が `allowed` に合うときだけ(でなければ -1)。 */
function braceAfter(code: string, from: number, allowed: RegExp): number {
  const open = code.indexOf('{', from);
  if (open === -1) return -1;
  return allowed.test(code.slice(from, open)) ? open : -1;
}

/**
 * そのファイルが宣言している「assert を含むヘルパ」の名前を集める。
 *
 * 注釈付きブロックが `expect(` を直接持たなくても、`expectRejected(result)` のような
 * ヘルパを呼んでいれば assert はある。許容しないと A16 は「ヘルパを使うな」という
 * 別の規則に化ける。
 *
 * 判定は下限である —— **関数の宣言**(`function 名(…) {` / `const 名 = (…) => {`)であり、
 * かつその**本体に matcher で終わる `expect(...)` がある**ものだけを数える(ヘルパがさらに別のヘルパを呼ぶ
 * 2 段は数えない。実測でその形は無い)。値の定数は本体を持たないので候補から落ちる。
 *
 * @param source テスト・テスト支援コードの中身
 * @returns assert を含む関数の名前
 */
export function collectAssertionHelpers(source: string): readonly string[] {
  const code = maskCode(source);
  const names: string[] = [];
  for (const match of code.matchAll(HELPER_DECL)) {
    const name = match[1] ?? match[2];
    if (name === undefined) continue;
    const open = helperBody(code, match.index ?? 0);
    if (open === -1) continue;
    const close = matchBrace(code, open);
    if (close === -1) continue;
    const body = code.slice(open, close + 1);
    // 本体に matcher で終わる `expect(...)` があるものだけがヘルパである(`expect(x);` だけの
    // 関数は何も主張しないので、呼んでも assert にならない)。字面が無ければ構文木を読まない。
    if (HAS_EXPECT.test(body) && matcherAssertionOffsets(source.slice(open, close + 1)).length > 0) {
      names.push(name);
    }
  }
  return names;
}
