/**
 * テストコードから `// @spec ... @tc ...` アノテーションを取り出す純粋関数。
 *
 * 書式(app/src/**\/*.test.ts の実物):
 *
 * ```ts
 *   // @spec entry.submit @tc TC-ENTRY-SUBMIT-001
 *   it('下書きから提出できる', async () => {
 * ```
 *
 * アノテーションは直後のテスト宣言(`it` / `test`、`.only` / `.each` 等の修飾つきを含む)を
 * 飾る。テスト名は第 1 引数の文字列リテラルとし、見つからなければ null を返して
 * 検証器(A6)に判断を委ねる。ファイル I/O は行わない(I/O は lib/trace/scan.ts)。
 *
 * **注釈の位置は「テスト宣言の直前の行」に固定する**(独立レビュー 束 ㉑ の 2-B)。注釈を
 * `it(...)` の**中**に書いても A6 / Z1 は受理するが、A16(注釈の中身)はその形のブロックを
 * 切り出せず何も言わなかった —— **注釈を 1 行下げるだけで A16 を外せた**。位置を規約で
 * 固定し、外れた位置は A12 が error にする(黙らせない)。間に挟めるのは例示の印
 * (`// #region example:…` / `// #endregion`。code-examples.md の抜き出し印)だけである。
 */

import type { EachTagRef, HalfTagRef, TestAnnotation } from '../testcase/types.js';

/** `@tc {ID}` を拾う。ID は英数字・ハイフン・アンダースコアのみ。 */
const TC_PATTERN = /@tc\s+([A-Za-z0-9_-]+)/;

/**
 * `@tc-each {テスト名のひな形}` を拾う(**期待表の全数ループの注釈**)。
 *
 * 表ごとの `it` を手で並べると、そのテストファイルは**アプリの表名の一覧**になる ——
 * 別題材の通し実行はそのファイルを実行できず、仕組みの側の突合が題材で 1 本も回らなくなる。
 * ループに寄せると `it` の名前が実行時にしか定まらないので、`@tc` の 1 対 1 の注釈が付かない。
 *
 * そこでひな形だけを静的に示す。`{…}` はループの変数が入る穴であり、台帳(`test_cases` の
 * `implementation`)の側に書かれたテスト名がこのひな形に当てはまれば、その ID は
 * **このループが実行している**と読む。ひな形とループの `it` の名前が食い違えば A12 が止める
 * (ひな形だけを書き換えて突合を空にできないようにするため)。
 */
const EACH_PATTERN = /@tc-each\s+(\S.*?)\s*$/;

/** ひな形の穴(`{table}` / `${table}`)。比べる前に同じ形へ寄せる。 */
const HOLE = /\$?\{[^}]*\}/g;

/**
 * `@spec` から次の `@` か行末までを拾う(空白区切りで複数の ID を書ける)。
 *
 * **`@spec` を同じ行に繰り返してもよい**(`@spec A @spec B @tc X` は `A` と `B` の両方)。生成されるテストの
 * 書式(`code-operation-tests.ts`)がこの形を書くので、最初の 1 つだけを読むと 2 つ目以降の仕様 ID が
 * 黙って落ちる(A 群の突合の母集合から外れる)。全部の出現を集める。
 */
const SPEC_PATTERN = /@spec\s+([^@\r\n]*)/g;

/** `it('...')` / `test.only("...")` / `it(`...`)` の第 1 引数を拾う。 */
const TEST_NAME_PATTERN = /^\s*(?:it|test)(?:\.[A-Za-z]+)*\s*(?:`[^`]*`)?\s*\(\s*(['"`])([\s\S]*?)\1/;

/** アノテーション行からテスト宣言を探す最大行数。空行やコメント数行を挟んでも拾えるだけの余裕。 */
const LOOKAHEAD_LINES = 5;

/** テスト宣言の頭(行の先頭に来る形。注釈の位置の判定に使う)。 */
const TEST_HEAD_LINE = /^\s*(?:it|test)(?:\s*\.\s*[A-Za-z]+(?:\s*\([^)]*\))?)*\s*\(/;

/** 注釈とテスト宣言の間に挟めるただ 1 つの行(コード例の抜き出し印)。 */
const EXAMPLE_REGION = /^\s*\/\/\s*#(?:region|endregion)\b/;

/** extractAnnotations の結果。 */
export interface ExtractedAnnotations {
  /** `@tc` を含む行から作った注釈。 */
  readonly annotations: readonly TestAnnotation[];
  /** `@spec` はあるが `@tc` が無い行(片方だけの注釈。A12 が直接エラーにする)。 */
  readonly halfTags: readonly HalfTagRef[];
  /** `@tc-each` を含む行から作ったひな形の注釈(台帳と突き合わせて展開する)。 */
  readonly eachTags: readonly EachTagRef[];
}

/**
 * ひな形の穴を同じ形に寄せる(`{table}` も `${table}` も `{}` にする)。
 *
 * @param name テスト名またはひな形
 * @returns 穴を `{}` に寄せた字面
 */
export function normalizeTemplate(name: string): string {
  return name.replace(HOLE, '{}');
}

/**
 * 1 ファイル分のソースからアノテーションを取り出す。
 *
 * `@tc` を含む行は注釈として、`@spec` はあるが `@tc` が無い行は片方だけの注釈として、それぞれ
 * 出現順に集める(1 行は必ずどちらか一方——`@tc` が有れば `@spec` の有無に関わらず注釈側)。
 *
 * @param source テストファイルの中身
 * @param file リポジトリルートからの相対パス(結果の file にそのまま入る)
 * @returns 出現順のアノテーションと片方だけの注釈
 */
export function extractAnnotations(source: string, file: string): ExtractedAnnotations {
  const lines = source.split(/\r?\n/);
  const annotations: TestAnnotation[] = [];
  const halfTags: HalfTagRef[] = [];

  const eachTags: EachTagRef[] = [];

  lines.forEach((line, index) => {
    if (!isComment(line)) return;
    const each = EACH_PATTERN.exec(line);
    if (each !== null) {
      const template = each[1];
      if (template === undefined) return;
      const found = findTestName(lines, index + 1);
      eachTags.push({
        file,
        line: index + 1,
        template,
        loopName: found === null ? null : normalizeTemplate(found),
      });
      return;
    }
    const tc = TC_PATTERN.exec(line);
    if (tc !== null) {
      const tcId = tc[1];
      if (tcId === undefined) return;
      annotations.push({
        tcId,
        specIds: extractSpecIds(line),
        testName: findTestName(lines, index + 1),
        decorates: decoratesTestHead(lines, index + 1),
        file,
        line: index + 1,
      });
      return;
    }
    if (specBodies(line).length === 0) return;
    halfTags.push({ file, line: index + 1, specIds: extractSpecIds(line) });
  });
  return { annotations, halfTags, eachTags };
}

/** 行コメント(`//`)・ブロックコメント本文(`*`)だけをアノテーションとして扱う。 */
function isComment(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/**
 * 注釈が**テスト宣言の直前の行**にあるか(挟めるのは例示の印の行だけ)。
 *
 * この 1 つの事実が A12 の error の材料であり、A16 がブロックを切り出せることの前提でもある。
 *
 * @param lines ファイルの全行
 * @param from 注釈の次の行の index(0 始まり)
 * @returns 直後(例示の印を除く)がテスト宣言なら true
 */
function decoratesTestHead(lines: readonly string[], from: number): boolean {
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) return false;
    if (EXAMPLE_REGION.test(line)) continue;
    return TEST_HEAD_LINE.test(line);
  }
  return false;
}

/** 行にある `@spec` の本体(次の `@` か行末まで)を、出現順に全部返す。 */
function specBodies(line: string): readonly string[] {
  return [...line.matchAll(SPEC_PATTERN)].map((match) => match[1] ?? '');
}

/** `@spec` の値を空白区切りで取り出す(`@spec` が複数あれば出現順に連ねる)。書かれていなければ空配列。 */
function extractSpecIds(line: string): readonly string[] {
  return specBodies(line).flatMap((body) => body.trim().split(/\s+/).filter((token) => token !== ''));
}

/**
 * アノテーションの次行から先を見て、最初のテスト宣言のテスト名を返す。
 * 別のアノテーション行に当たったら打ち切る(1 アノテーション 1 テストのため)。
 */
function findTestName(lines: readonly string[], from: number): string | null {
  const limit = Math.min(lines.length, from + LOOKAHEAD_LINES);
  for (let i = from; i < limit; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    if (isComment(line) && TC_PATTERN.test(line)) return null;
    const match = TEST_NAME_PATTERN.exec(line);
    const name = match?.[2];
    if (name !== undefined) return name;
  }
  return null;
}
