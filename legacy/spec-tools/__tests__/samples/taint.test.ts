/**
 * **敵対的な自由文字列を仕様の全ての日本語の欄に入れて**題材を通し、生成物の構造が変わらないことを見る(出口の無害化の実測)。
 *
 * 仕様の自由な文字列(ラベル・要約・目的・理由など)は、生成物のコメント・文字列リテラル・SQL のコメント・CSS のコメント・
 * ハンドブックの見出しや表に置かれる。監査(F-03 / F-04)が実測した破り方 —— コメントを閉じて実行文を置く・文字列を閉じる・`$$` の本文を閉じる・
 * Vue の式・生の HTML —— を載せた文字列を、**日本語を含む全ての文字列欄**の末尾に足す。足した題材の生成物と、足さない題材の生成物を比べて、
 *   - TypeScript / SQL / CSS は**骨格(コメントと文字列の中身を除いた構造)が同じ**であること(位置を破って文や宣言が増えていない)
 *   - 本の HTML は全ページが閉じた検査(`book-page-check.ts`)を通ること
 * を確かめる。改行・制御文字は読み込みが落とす(`safe-frontmatter.test.ts`)ので、ここでは載せない。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { dump, load } from 'js-yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import { SLOW } from '../helpers/book-entry-fixture.js';
import { bookPageProblems } from '../helpers/book-page-check.js';
import { cssSkeleton, sqlSkeleton, typeScriptSkeleton } from '../helpers/output-skeleton.js';
import { runSampleSystem } from './harness.js';
import type { SampleRun } from './harness.js';

/** 足す文字列。ブロックコメントの閉じ・実行文・単引用符・`$$`・Vue の式・生の HTML・Mermaid の記号・CSS の閉じ括弧。 */
const PAYLOAD = ` */ globalThis.TAINT_TS = 1; /* ' $$ ; drop table t; {{ 1 + 1 }} <img src=x onerror=alert(1)> <script>alert(1)</script> "] ; click A call alert(1) } @import url(//evil/x.css)`;

/** 日本語を含む文字列か(識別子・式・パスは日本語を含まない)。 */
const HAS_JAPANESE = /[぀-ヿ㐀-鿿]/;

/** 自由文字列を置く欄の名前(日本語でない文章も同じ欄に入る)。 */
const FREE_TEXT_KEYS: ReadonlySet<string> = new Set(['label', 'summary', 'goal', 'description', 'reason', 'note', 'purpose', 'title', 'statement', 'name_label']);

/** 足す文字列の選び方: 日本語を含む文字列、または自由文字列の欄の文字列。 */
type Selector = (value: string, key: string) => boolean;

const JAPANESE: Selector = (value) => HAS_JAPANESE.test(value);
const JAPANESE_OR_FREE_TEXT_KEY: Selector = (value, key) => HAS_JAPANESE.test(value) || FREE_TEXT_KEYS.has(key);

/** 値を辿って、選んだ文字列の末尾に足す。 */
function taint(value: unknown, select: Selector, key = ''): unknown {
  if (typeof value === 'string') return select(value, key) ? `${value}${PAYLOAD}` : value;
  if (Array.isArray(value)) return value.map((item) => taint(item, select, key));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, taint(item, select, name)]));
  return value;
}

/** 仕様ファイル 1 枚のフロントマターを書き換える(本文はそのまま)。 */
function taintSpec(select: Selector): (text: string) => string {
  return (text) => {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (match === null) return text;
    const data = load(match[1] ?? '');
    return `---\n${dump(taint(data, select))}---\n${text.slice(match[0].length)}`;
  };
}

/** `.md` を集める。 */
function specFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const target = path.join(dir, entry);
    if (statSync(target).isDirectory()) specFiles(target, found);
    else if (target.endsWith('.md')) found.push(target);
  }
  return found;
}

/** 題材の仕様の木。 */
const specsOf = (sample: string): string => path.resolve(import.meta.dirname, '../fixtures/samples', sample, 'docs/specs');

/** 題材を足さずに通した生成物と、足して通した生成物の骨格を比べる。 */
function describeTaint(sample: string, select: Selector, title: string): void {
  describe(`${sample} ${title}`, () => {
    let clean: SampleRun;
    let tainted: SampleRun;

    beforeAll(async () => {
      const specs = specsOf(sample);
      const rewrite: Record<string, (text: string) => string> = {};
      const transform = taintSpec(select);
      for (const file of specFiles(specs)) {
        const relative = path.join('docs/specs', path.relative(specs, file));
        if (transform(readFileSync(file, 'utf-8')) !== readFileSync(file, 'utf-8')) rewrite[relative] = transform;
      }
      clean = await runSampleSystem(sample);
      tainted = await runSampleSystem(sample, { rewrite });
    }, SLOW);

    /** 手で書いた仕様ファイル(生成は標識の間だけを書く。フロントマターはこのテストが書き換えたもの)。 */
    const isSpecFile = (file: string): boolean => file.startsWith('docs/specs/');
    const generatedOnly = (run: SampleRun): readonly string[] => [...run.generatedFiles.keys()].filter((file) => !isSpecFile(file)).sort();

    it('生成したファイルの集合は同じ(仕様ファイルの標識の間を除く)', () => {
      expect(generatedOnly(tainted)).toEqual(generatedOnly(clean));
    });

    it('敵対的な文字列が実際に生成物へ届いている(何も試さないまま緑にならない)', () => {
      const reached = [...tainted.generatedFiles.values()].filter((text) => text.includes('TAINT_TS')).length;

      expect(reached).toBeGreaterThan(10);
    });

    it('TypeScript の骨格が同じ(コメント・文字列を破って文が増えていない)', () => {
      const differing = [...clean.generatedFiles]
        .filter(([file]) => /\.tsx?$/.test(file))
        .filter(([file, text]) => JSON.stringify(typeScriptSkeleton(text, file)) !== JSON.stringify(typeScriptSkeleton(tainted.generatedFiles.get(file) ?? '', file)))
        .map(([file]) => file);

      expect(differing).toEqual([]);
    });

    it('SQL の骨格が同じ(`--` のコメント・文字列・`$$` の本文を破って文が増えていない)', () => {
      const differing = [...clean.generatedFiles]
        .filter(([file]) => file.endsWith('.sql'))
        .filter(([file, text]) => JSON.stringify(sqlSkeleton(text)) !== JSON.stringify(sqlSkeleton(tainted.generatedFiles.get(file) ?? '')))
        .map(([file]) => file);

      expect(differing).toEqual([]);
    });

    it('CSS の骨格が同じ(コメントの外にルールが増えていない)', () => {
      const differing = [...clean.generatedFiles]
        .filter(([file]) => file.endsWith('.css'))
        .filter(([file, text]) => cssSkeleton(text) !== cssSkeleton(tainted.generatedFiles.get(file) ?? ''))
        .map(([file]) => file);

      expect(differing).toEqual([]);
    });

    it('本の全ページが閉じた検査を通る(本の出力は HTML で、`.md` は無い。実行の道・危険な属性・生の文字列のページが無い)', () => {
      const pages = [...tainted.generatedFiles].filter(([file]) => file.startsWith('docs/book/'));
      expect(pages.filter(([file]) => file.endsWith('.md')).map(([file]) => file)).toEqual([]);
      const html = pages.filter(([file]) => file.endsWith('.html'));
      expect(html.length).toBeGreaterThan(0);
      expect(html.flatMap(([file, text]) => bookPageProblems(text, file, 'docs/book').map((problem) => `${file}: ${problem}`))).toEqual([]);
    });
  });
}

describeTaint('rooms', JAPANESE, 'の日本語の欄に敵対的な文字列を入れた生成物');
describeTaint('library', JAPANESE_OR_FREE_TEXT_KEY, 'の日本語の欄と自由文字列の欄(日本語でない文章を含む)に敵対的な文字列を入れた生成物');
