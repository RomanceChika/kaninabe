import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Linter } from 'eslint';
import type { Rule } from 'eslint';
import { describe, expect, it } from 'vitest';
import { FRAMEWORK_LINT_CONFIG_DIR, detectRepoRoot } from '../../../lib/io/paths.js';
import { loadOversizeRule } from '../../../lib/io/oversize-rule.js';

/**
 * **300 行を超えるファイルの宣言**(自作規則 `layer/declared-oversize` と、その判定の純関数
 * `oversize.mjs` の `judgeOversize`)の単体テスト。
 *
 * 300 行は信号であって上限ではない。超えるファイルは冒頭の JSDoc に `@oversize`(1 つの責務の
 * まま超える理由)と `@split-review`(責務で割れるかの検討の結果)を持てば通る。違反は 6 つ:
 * ① 宣言なしの超過 ② 片方のタグだけ ③ 本文が 10 文字未満 ④ 行数を理由に書く(行数・300 行・
 * 制限・上限)⑤ 300 行以下に宣言が残る ⑥(通る形)正しい宣言。
 * 規則は判定の純関数を呼ぶだけなので、**同じ本文に対して規則と純関数が同じ答えを返す**ことも
 * 見る(verify が宣言の本数を数えるのも同じ純関数である)。
 */

const toolRoot = detectRepoRoot(import.meta.dirname);
const load = createRequire(join(toolRoot, 'package.json'));
const rule: Rule.RuleModule = load(join(toolRoot, FRAMEWORK_LINT_CONFIG_DIR, 'src', 'rules', 'declared-oversize.mjs')).declaredOversize;
const { judgeOversize } = loadOversizeRule();

/** 規則を実際の ESLint(フラット config)に載せて本文を検査し、メッセージを返す。 */
function lint(source: string, options: { readonly max?: number } = {}): readonly string[] {
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    source,
    [
      {
        files: ['**/*.ts'],
        plugins: { layer: { rules: { 'declared-oversize': rule } } },
        rules: { 'layer/declared-oversize': ['error', { max: 300, ...options }] },
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      },
    ],
    'sample.ts',
  );
  return messages.map((message) => message.message);
}

/** `count` 行ちょうどになるよう、本文(1 行 1 文)で埋めた JS を返す。 */
function body(count: number): string {
  return Array.from({ length: count }, (_, i) => `export const v${i} = ${i};`).join('\n');
}

/** 冒頭の JSDoc つきの本文(冒頭の JSDoc の行を含めて `total` 行ちょうど)。 */
function withHeader(tags: readonly string[], total: number): string {
  const header = ['/**', ' * 見出し。', ...tags.map((tag) => ` * ${tag}`), ' */'];
  return `${header.join('\n')}\n${body(total - header.length)}\n`;
}

const OVERSIZE = '@oversize 超える理由: 1 つの表の全規則を 1 か所で読み通せるようにするため。';
const REVIEW = '@split-review 割る案と結果: 規則ごとに割る案は、互いの参照が増えて読みにくくなるので採らない。';

describe('layer/declared-oversize(ESLint に載せた実測)', () => {
  it('① 宣言なしの超過は違反(301 行)', () => {
    const messages = lint(`${body(301)}\n`);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('301 行');
  });

  it('ちょうど 300 行は通る(末尾の改行が作る空の最終行は数えない。max-lines と同じ数え方)', () => {
    expect(lint(`${body(300)}\n`)).toEqual([]);
    expect(lint(body(300))).toEqual([]);
  });

  it('② 片方のタグだけは違反(@oversize だけ・@split-review だけ)', () => {
    expect(lint(withHeader([OVERSIZE], 320)).join('\n')).toContain('@split-review が無い');
    expect(lint(withHeader([REVIEW], 320)).join('\n')).toContain('@oversize が無い');
  });

  it('③ 本文が 10 文字に満たないのは違反(ラベルだけ・短すぎる)', () => {
    expect(lint(withHeader(['@oversize 超える理由:', REVIEW], 320)).join('\n')).toContain('@oversize の本文が短い');
    expect(lint(withHeader([OVERSIZE, '@split-review 割れない'], 320)).join('\n')).toContain('@split-review の本文が短い');
  });

  it('④ 行数を理由に書くのは違反(行数・300 行・制限・上限。どちらのタグでも)', () => {
    for (const reason of ['行数が多いので分けずに置く(理由はそれだけ)', '300 行を少し超えただけなので分けない', '1 ファイルの制限に当たったが割らない', '上限に近いが割らずに置いておく']) {
      expect(lint(withHeader([`@oversize ${reason}`, REVIEW], 320)).join('\n'), reason).toContain('@oversize の本文に');
      expect(lint(withHeader([OVERSIZE, `@split-review ${reason}`], 320)).join('\n'), reason).toContain('@split-review の本文に');
    }
  });

  it('⑤ 300 行以下のファイルに宣言が残っていたら違反(腐った宣言。片方だけ残っていても)', () => {
    expect(lint(withHeader([OVERSIZE, REVIEW], 300)).join('\n')).toContain('腐った宣言');
    expect(lint(withHeader([OVERSIZE], 50)).join('\n')).toContain('腐った宣言');
    expect(lint(withHeader([REVIEW], 50)).join('\n')).toContain('腐った宣言');
  });

  it('⑥ 正しい宣言は通る(2 つのタグ・本文 10 文字以上・行数を理由にしない)', () => {
    expect(lint(withHeader([OVERSIZE, REVIEW], 400))).toEqual([]);
  });

  it('複数行にまたがる本文・ラベルなしの本文も通る(ラベルは本文の長さに数えない)', () => {
    const source = withHeader(['@oversize 状態機械の全遷移を 1 か所に並べて、', '  抜けを一目で見られるようにする。', '@split-review 状態ごとに割ると、遷移の全域性が読めなくなる。割らない。'], 350);
    expect(lint(source)).toEqual([]);
  });

  it('宣言は**冒頭の JSDoc** にだけ置ける(コードの後ろのコメント・JSDoc でないブロックコメントは数えない)', () => {
    const late = `export const first = 1;\n/**\n * ${OVERSIZE}\n * ${REVIEW}\n */\n${body(320)}\n`;
    expect(lint(late)).not.toEqual([]);
    const plain = `/*\n * ${OVERSIZE}\n * ${REVIEW}\n */\n${body(320)}\n`;
    expect(lint(plain)).not.toEqual([]);
  });

  it('import の後ろに置いた見出しの JSDoc も冒頭として読む(製品の木の書き方)', () => {
    const header = `import 'server-only';\nimport { A } from './a';\nexport { B } from './b';\n\n/**\n * 見出し。\n * ${OVERSIZE}\n * ${REVIEW}\n */\n`;
    expect(lint(`${header}${body(320)}\n`)).toEqual([]);
    const afterCode = `import { A } from './a';\nexport const x = 'y';\n/**\n * ${OVERSIZE}\n * ${REVIEW}\n */\n`;
    expect(lint(`${afterCode}${body(320)}\n`)).not.toEqual([]);
  });

  it('shebang・行コメント・ディレクティブのあとの JSDoc も冒頭として読む', () => {
    const header = `// 注記\n'use client';\n/**\n * 見出し。\n * ${OVERSIZE}\n * ${REVIEW}\n */\n`;
    expect(lint(`${header}${body(320)}\n`)).toEqual([]);
  });

  it('max を変えられる(テスト用。既定は 300)', () => {
    expect(lint(`${body(11)}\n`, { max: 10 })).toHaveLength(1);
    expect(lint(`${body(10)}\n`, { max: 10 })).toEqual([]);
  });
});

describe('judgeOversize(純関数。verify の宣言の本数と同じ判定)', () => {
  it('規則と同じ答えを返す(違反があれば declared は false・無ければ true)', () => {
    const cases: readonly string[] = [`${body(301)}\n`, withHeader([OVERSIZE], 320), withHeader([OVERSIZE, REVIEW], 320), withHeader([OVERSIZE, REVIEW], 100), `${body(10)}\n`];
    for (const source of cases) {
      const judged = judgeOversize(source);
      expect(judged.problems.map((problem) => problem.message), source.slice(0, 40)).toEqual(lint(source));
      expect(judged.declared).toBe(judged.exceeds && judged.problems.length === 0);
    }
  });

  it('宣言つき(declared)は 300 行を超えて、正しい宣言が揃ったものだけ', () => {
    expect(judgeOversize(withHeader([OVERSIZE, REVIEW], 320)).declared).toBe(true);
    expect(judgeOversize(withHeader([OVERSIZE, REVIEW], 300)).declared).toBe(false);
    expect(judgeOversize(withHeader([OVERSIZE], 320)).declared).toBe(false);
    expect(judgeOversize(`${body(301)}\n`).declared).toBe(false);
  });

  it('CRLF の本文も同じ行数に数える', () => {
    expect(judgeOversize(`${body(301).replaceAll('\n', '\r\n')}\r\n`).lines).toBe(301);
  });
});
