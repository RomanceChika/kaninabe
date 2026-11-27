/**
 * 実装の範囲で外せる検査(印 `absentFor` を付ける場所)の**閉じた一覧**と、enforcement-matrix の C26 行の突合。
 *
 * 印は「仕様が名指しする実装・テストが無い」という**不在の error だけ**に付ける。付ける場所が増えるほど、範囲が本物の誤りを
 * 消しうる面が広がるので、一覧は閉じていて、足すときは文書(C26)とこのテストを一緒に直す。突合は 3 つ。
 *   ① ソースで印を付ける検査 ID(`absentFor(` を呼ぶ、または `checkTestCaseTrace` に `null` でない持ち主を渡す)の集合 = C26 の一覧
 *   ② 一覧にある ID は全部、実在するソースで印を付けている(腐った行を残さない)
 *   ③ 印を付けてよい文面の閉じた表(`helpers/absence-templates.ts`)の検査 ID も、同じ一覧と一致する
 *   ④ 印を付けてはいけない場所(ホストの設定・孤児と重複の検査・仕組み自身の台帳 Z3)には、印も持ち主もいない
 * 検査 ID はファイル名の頭(`a6-…` → A6)から引く。引けないファイルが印を付けていたら、名指しで赤にする(一覧の外へ漏らさない)。
 * 文書は生成物ではないので、ここは `matrix-range-parity.test.ts` と同じ流儀で、文書の本文を読む。
 *
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { walkFiles } from '../../../lib/io/paths.js';
import { ABSENCE_TEMPLATES } from '../../helpers/absence-templates.js';

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
  'targets/vercel/job/j2-schedule-parity.ts', // 登録の食い違い(宣言した口が vercel.json に無い)は「あるが食い違う」
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

/** `kernel/scope-owner` からの import 文(型だけの import も含む。`import { … } from '…'`)。 */
const SCOPE_OWNER_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'[^']*kernel\/scope-owner\.js'\s*;?/gu;

/** コメントを落とす(説明の中の語を数えない。`//` は行頭か空白の次だけ — 文字列の `http://` を巻き込まない)。 */
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/[^\n]*/gu, '$1');

/** `kernel/scope-owner` から `absentFor` を名前つきで取り込んでいるか。 */
function importsAbsentFor(text: string): boolean {
  return [...withoutComments(text).matchAll(SCOPE_OWNER_IMPORT)].some((match) => (match[1] ?? '').split(',').some((item) => item.trim() === 'absentFor'));
}

/**
 * `absentFor` の識別子の出方のうち、許す形(① `kernel/scope-owner` からの名前つき import ② 直接の呼び出し `absentFor(`)でないもの。
 * 許す形でないもの = 別名(`as`)・名前空間 / 既定の import・再エクスポート・キー・短縮形・代入・ブラケット・値としての受け渡し。
 * 例外は 1 つだけ: 印の**読み取り**(`x.absentFor`。代入でない)と、`kernel/finding.ts` の欄の宣言(`absentFor?:`)— 読んでも印は付かない。
 *
 * @param text ソースの本文
 * @param relative `lib` からの相対パス(欄の宣言の例外を決める)
 */
function strayAbsentFor(text: string, relative: string): readonly string[] {
  const code = withoutComments(text);
  const stray: string[] = [];
  // scope-owner の import は、名前つきの形だけを許し、残りの本文から外す。それ以外の取り込み方(別名・名前空間・既定・再エクスポート)は印の入口を迂回する。
  const rest = code.replace(SCOPE_OWNER_IMPORT, (statement, items: string) => {
    for (const item of items.split(',').map((part) => part.trim())) if (/\babsentFor\b/u.test(item) && item !== 'absentFor') stray.push(`import: ${item}`);
    return statement.replace(/\babsentFor\b/gu, '');
  });
  for (const match of rest.matchAll(/[^\n]*kernel\/scope-owner\.js[^\n]*/gu)) {
    if (/^\s*(?:import\s+(?:type\s+)?\{|\})/u.test(match[0]) || /\bimport\s+(?:type\s+)?\{[^}]*\}\s*from/u.test(match[0])) continue;
    if (/\bimport\b[^{]*\*\s*as\b|\bimport\s+\w|\bexport\b/u.test(match[0])) stray.push(`import/export: ${match[0].trim()}`);
  }
  for (const match of rest.matchAll(/\babsentFor\b/gu)) {
    const index = match.index ?? 0;
    const before = rest.slice(0, index);
    const after = rest.slice(index + match[0].length);
    const isCall = /^\(/u.test(after) && !/(?:function\s+|\.\s*)$/u.test(before);
    const isRead = /\.\s*$/u.test(before.replace(/\?$/u, '.')) && !/^\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?!=)/u.test(after) && !/^\s*[,}\]]?\s*(?:\]|\})\s*=(?!=)/u.test(after);
    const isDeclaration = relative === 'kernel/finding.ts' && /^\?\s*:/u.test(after) && /(?<!-)readonly\s*$/u.test(before);
    if (!isCall && !isRead && !isDeclaration) stray.push(rest.slice(Math.max(0, index - 20), index + 30).replace(/\s+/gu, ' '));
  }
  return stray;
}

/** ファイル名の頭から引く検査 ID(`a6-test-trace.ts` → `A6`)。引けなければ null。 */
function checkIdOf(relative: string): string | null {
  const match = /^([a-z]\d+)-/u.exec(path.posix.basename(relative));
  return match === null ? null : (match[1] ?? '').toUpperCase();
}

/** このファイルが印を付けるか(`kernel/scope-owner` から `absentFor` を取り込む、`absentFor(` を呼ぶ、または `checkTestCaseTrace` に `null` でない持ち主を渡す)。 */
function tags(relative: string): boolean {
  const text = read(relative);
  return importsAbsentFor(text) || callsOf(text, 'absentFor').length > 0 || callsOf(text, 'checkTestCaseTrace').some((args) => args[4] !== 'null');
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

  it('許す文面の表(absence-templates)の検査 ID が、C26 の閉じた一覧と一致する(両方向)', () => {
    expect(Object.keys(ABSENCE_TEMPLATES).sort()).toEqual([...new Set(documentedList())].sort());
  });

  it('`absentFor` の識別子は、lib の下で kernel/scope-owner.ts の外に、名前つき import と直接の呼び出し(と印の読み取り)としてしか出ない(別名・名前空間・再エクスポート・キー・短縮形・代入・ブラケット・値の受け渡しで印の入口をすり抜けない)', () => {
    const bypass = libSources()
      .filter((relative) => relative !== 'kernel/scope-owner.ts')
      .flatMap((relative) => strayAbsentFor(read(relative), relative).map((snippet) => `${relative}: ${snippet}`));

    expect(bypass).toEqual([]);
  });

  describe('上の見張り自身(許す形と許さない形を、今のソースに頼らず見る)', () => {
    const imported = "import { absentFor } from '../kernel/scope-owner.js';\n";
    const allowed: readonly string[] = [
      `${imported}const tagged = absentFor(owner, finding);`,
      `${imported}return [...items.map((item) => absentFor(owner, item))];`,
      "import { absentFor, type ScopeOwner } from '../kernel/scope-owner.js';\nabsentFor(o, f);",
      'const owner = finding.absentFor?.id;',
      'const same = finding.absentFor === other.absentFor;',
      '// absentFor の説明だけ\n/* absentFor */',
    ];
    const forbidden: readonly (readonly [string, string])[] = [
      ['別名', "import { absentFor as tag } from '../kernel/scope-owner.js';"],
      ['名前空間', "import * as owner from '../kernel/scope-owner.js';"],
      ['既定の import', "import owner from '../kernel/scope-owner.js';"],
      ['再エクスポート(名前つき)', "export { absentFor } from '../kernel/scope-owner.js';"],
      ['再エクスポート(全部)', "export * from '../kernel/scope-owner.js';"],
      ['キー', `${imported}const f = { ...finding, absentFor: owner };`],
      ['短縮形', 'const f = { ...finding, absentFor };'],
      ['代入', 'finding.absentFor = owner;'],
      ['ブラケット', "finding['absentFor'] = owner;"],
      ['値の受け渡し', `${imported}items.map(absentFor);`],
      ['別の値に束ねる', `${imported}const tag = absentFor;`],
      ['分割代入', 'const { absentFor } = scopeOwner;'],
      ['代入(??=)', 'finding.absentFor ??= owner;'],
      ['代入(||=)', 'finding.absentFor ||= owner;'],
      ['代入(&&=)', 'finding.absentFor &&= owner;'],
      ['代入(+=)', 'finding.absentFor += owner;'],
      ['分割代入の宛先(メンバー)', '({ a: finding.absentFor } = source);'],
      ['配列の分割代入の宛先', '[finding.absentFor] = [owner];'],
      ['readonly を外す写像(kernel/finding.ts でも)', 'type Writable = { -readonly [K in keyof Finding]: Finding[K] } & { -readonly absentFor?: ScopeOwner };'],
    ];

    it.each(allowed.map((text, index) => [index, text] as const))('許す形 %s', (_index, text) => {
      expect(strayAbsentFor(text, 'x/y.ts')).toEqual([]);
    });

    it.each(forbidden)('許さない形: %s', (_what, text) => {
      expect(strayAbsentFor(text, 'x/y.ts')).not.toEqual([]);
    });

    it('欄の宣言(`readonly absentFor?:`)は kernel/finding.ts でだけ許す', () => {
      const declaration = 'readonly absentFor?: ScopeOwner;';

      expect(strayAbsentFor(declaration, 'kernel/finding.ts')).toEqual([]);
      expect(strayAbsentFor(declaration, 'x/y.ts')).not.toEqual([]);
    });
  });

  it('kernel/scope-owner.ts の値の export は `absentFor` だけ(型は自由)。印を書く 2 つ目の入口がそこに生えない', () => {
    const exported = [...withoutComments(read('kernel/scope-owner.ts')).matchAll(/^export\s+(?!type\b|interface\b)(?:async\s+)?(?:const|let|var|function\*?|class|enum)\s+(\w+)/gmu)].map((match) => match[1]);
    const lists = [...withoutComments(read('kernel/scope-owner.ts')).matchAll(/^export\s+(?!type\b)\{([^}]*)\}/gmu)].flatMap((match) => (match[1] ?? '').split(',').map((item) => item.trim()).filter((item) => item !== '' && !item.startsWith('type ')));

    expect([...exported, ...lists]).toEqual(['absentFor']);
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
