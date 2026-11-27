/**
 * 実装の範囲で外せる検査(印 `absentFor` を付ける場所)の**閉じた一覧**と、enforcement-matrix の C26 行の突合。
 *
 * 印は「仕様が名指しする実装・テストが無い」という**不在の error だけ**に付ける。付ける場所が増えるほど、範囲が本物の誤りを
 * 消しうる面が広がるので、一覧は閉じていて、足すときは文書(C26)とこのテストを一緒に直す。突合は 3 つ。
 *   ① ソースで印を付ける検査 ID(`absentFor(` を呼ぶ、または `checkTestCaseTrace` に `null` でない持ち主を渡す)の集合 = C26 の一覧
 *   ② 一覧にある ID は全部、実在するソースで印を付けている(腐った行を残さない)
 *   ③ 印を付けてはいけない場所(ホストの設定・孤児と重複の検査・仕組み自身の台帳 Z3)には、印も持ち主もいない
 * 検査 ID はファイル名の頭(`a6-…` → A6)から引く。引けないファイルが印を付けていたら、名指しで赤にする(一覧の外へ漏らさない)。
 * 文書は生成物ではないので、ここは `matrix-range-parity.test.ts` と同じ流儀で、文書の本文を読む。
 *
 * 計画: step 3b の section 1(閉じた一覧)・section 3(test 6)。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { walkFiles } from '../../../lib/io/paths.js';

/** リポジトリルート(このファイルは legacy/spec-tools/__tests__/unit/gates/ にある)。 */
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

/** 検証器・生成器の置き場(道具の木の lib)。 */
const LIB = path.join(REPO_ROOT, 'legacy/spec-tools/lib');

/** 対応表(C26 行がある)。 */
const MATRIX = 'docs/rules/process/backend/system/standards/conventions/enforcement/enforcement-matrix.md';

/** 印の定義と、その共有の入口(検査 ID を持たないので、ここだけは数えない)。 */
const SHARED_FILES: readonly string[] = ['kernel/scope-owner.ts', 'testcase/test-trace-match.ts'];

/** 印を付けてはいけない場所(`lib` からの相対パス)。 */
const NEVER_TAGGED: readonly string[] = [
  'targets/vercel/job/j2-host-config.ts', // ホストの設定(next.config / vercel.json)は、不在も常に error
  'targets/vercel/job/j2-host.ts',
  'trace/verifiers/a6-orphans.ts', // 孤児と @tc の重複は「不在」ではない
  'guarantee/verifiers/z3-framework-scan.ts', // 仕組み自身の台帳(持ち主 null)
];

/** `lib` の下の `.ts` の全部(`lib` からの相対パス)。 */
function libSources(): readonly string[] {
  return walkFiles(LIB, (name) => name.endsWith('.ts')).map((file) => path.relative(LIB, file).split(path.sep).join('/'));
}

/** ソースの本文。 */
const read = (relative: string): string => readFileSync(path.join(LIB, relative), 'utf-8');

/** 呼び出しの引数(`open` は開き括弧の次の位置)。括弧・括り・文字列の中のカンマでは割らない。 */
function callArguments(text: string, open: number): readonly string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = open;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (quote !== null) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) {
      if (depth === 0) {
        args.push(text.slice(start, index).trim());
        return args.filter((arg, position) => arg !== '' || position < args.length - 1);
      }
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      args.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  throw new Error('呼び出しの閉じ括弧が見つかりません');
}

/** `name(` の呼び出しの引数の並び(定義 `function name(` は除く)。 */
function callsOf(text: string, name: string): readonly (readonly string[])[] {
  const calls: (readonly string[])[] = [];
  // 定義(`function name(`)と、別の値のメソッド呼び出し(`x.name(`)は数えない。`...name(`(展開)は呼び出しである。
  const pattern = new RegExp(`(?<!function )(?<!\\w)(?<!\\w\\.)${name}\\(`, 'gu');
  for (const match of text.matchAll(pattern)) calls.push(callArguments(text, (match.index ?? 0) + match[0].length));
  return calls;
}

/** ファイル名の頭から引く検査 ID(`a6-test-trace.ts` → `A6`)。引けなければ null。 */
function checkIdOf(relative: string): string | null {
  const match = /^([a-z]\d+)-/u.exec(path.posix.basename(relative));
  return match === null ? null : (match[1] ?? '').toUpperCase();
}

/** このファイルが印を付けるか(`absentFor(` を呼ぶ、または `checkTestCaseTrace` に `null` でない持ち主を渡す)。 */
function tags(relative: string): boolean {
  const text = read(relative);
  return callsOf(text, 'absentFor').length > 0 || callsOf(text, 'checkTestCaseTrace').some((args) => args[4] !== 'null');
}

/** 印を付けるファイル(共有の入口を除く)。 */
function taggingFiles(): readonly string[] {
  return libSources().filter((relative) => !SHARED_FILES.includes(relative) && tags(relative));
}

/** C26 行の「外せる検査の閉じた一覧」(`A2・A6・…`)。 */
function documentedList(): readonly string[] {
  const row = readFileSync(path.join(REPO_ROOT, MATRIX), 'utf-8')
    .split('\n')
    .find((line) => line.startsWith('| C26 |'));
  if (row === undefined) throw new Error('enforcement-matrix に C26 の行がありません(表の形が変わった)');
  const match = /外せる検査の閉じた一覧[:：]\s*([A-Z][A-Z0-9・]*)/u.exec(row);
  if (match === null) throw new Error('C26 の行に「外せる検査の閉じた一覧: A2・A6・…」がありません');
  return (match[1] ?? '').split('・').filter((id) => id !== '');
}

describe('実装の範囲で外せる検査の閉じた一覧 ⇔ ソースで印を付ける場所', () => {
  it('空振りしない: 文書の一覧を読めて、ソースの走査も何かを見ている', () => {
    expect(documentedList().length).toBeGreaterThan(10);
    expect(libSources().length).toBeGreaterThan(200);
  });

  it('印を付けるファイルは全部、検査 ID をファイル名の頭から引ける(一覧の外へ漏らさない)', () => {
    expect(taggingFiles().filter((relative) => checkIdOf(relative) === null)).toEqual([]);
  });

  it('ソースで印を付ける検査 ID の集合が、C26 の閉じた一覧と一致する(両方向)', () => {
    const inSource = [...new Set(taggingFiles().flatMap((relative) => checkIdOf(relative) ?? []))].sort();

    expect(inSource).toEqual([...new Set(documentedList())].sort());
  });

  it('文書の一覧に同じ ID が 2 回出ない', () => {
    expect(new Set(documentedList()).size).toBe(documentedList().length);
  });

  it('`checkTestCaseTrace` の呼び出しは全部、持ち主を明示する(5 つ目の引数が必須。省略して印を外さない)', () => {
    const short = libSources()
      .filter((relative) => relative !== 'testcase/test-trace-match.ts')
      .flatMap((relative) => callsOf(read(relative), 'checkTestCaseTrace').filter((args) => args.length !== 5).map(() => relative));

    expect(short).toEqual([]);
  });
});

describe('印を付けてはいけない場所', () => {
  it.each(NEVER_TAGGED)('%s は印を付けない', (relative) => {
    expect(libSources()).toContain(relative);
    expect(tags(relative)).toBe(false);
  });

  it('仕組み自身の台帳(Z3)は `checkTestCaseTrace` に `null` を渡す', () => {
    const calls = callsOf(read('guarantee/verifiers/z3-framework-scan.ts'), 'checkTestCaseTrace');

    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args[4]).toBe('null');
    expect(documentedList()).not.toContain('Z3');
  });
});
