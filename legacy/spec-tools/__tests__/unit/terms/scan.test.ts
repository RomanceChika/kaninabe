/**
 * 用語の台帳の走査(I/O 境界)のテスト。
 *
 * 木の `*.md` だけを読むこと・名指しした歴史の記録は読まないこと・コードはコメントと日本語を含むリテラルを読むこと・
 * シェルと YAML の `#` コメントを読むこと・木が無くても壊れないこと・初出のファイルは範囲の外でも読むこと。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WHOLE_FILE_GENERATED_NOTICE } from '../../../lib/generality/scan.js';
import { scanCodeText, scanHashComments, scanProseFiles, scanSpecText, scanSummaries, scanTermCorpus } from '../../../lib/terms/scan.js';
import type { TermScanScope } from '../../../lib/model/terms/types.js';
import { ledger, term } from '../../helpers/terms-builder.js';

let root = '';
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'terms-scan-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 一時ツリーにファイルを書く。 */
function write(relative: string, source: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
}

/** 走査範囲を組む(省略した木は空)。 */
function scope(parts: Partial<TermScanScope> = {}): TermScanScope {
  return {
    proseTrees: [],
    proseOutOfScope: [],
    specTrees: [],
    proseFiles: [],
    codeTrees: [],
    literalOutOfScope: [],
    hashCommentTrees: [],
    summaryTrees: [],
    ...parts,
  };
}

describe('scanProseFiles', () => {
  it('木の中の .md だけを、木の順・名前順に読む(フロントマターは本文に入らない)', () => {
    write('docs/rules/b.md', '---\nid: x\n---\n本文 B\n');
    write('docs/rules/a.md', '本文 A\n');
    write('docs/rules/notes.txt', '読まない');
    write('docs/book/c.md', '本文 C\n');

    const files = scanProseFiles(root, ['docs/rules', 'docs/book']);

    expect(files.map((file) => file.file)).toEqual(['docs/rules/a.md', 'docs/rules/b.md', 'docs/book/c.md']);
    expect(files[1]?.lines.map((line) => line.text)).toEqual(['本文 B', '']);
  });

  it('全体が生成物であると宣言する文書(ブックの生成物)は読まない。生成物の側で違反が 2 件目になるのを防ぐ', () => {
    write('docs/book/chapter.md', `${WHOLE_FILE_GENERATED_NOTICE}\n\n旧綴りを引用した本文\n`);
    write('docs/book/hand.md', '手で書いた本文\n');

    expect(scanProseFiles(root, ['docs/book']).map((file) => file.file)).toEqual(['docs/book/hand.md']);
  });

  it('木が無ければ何も読まない(壊れない)', () => {
    expect(scanProseFiles(root, ['docs/rules', 'docs/book'])).toEqual([]);
  });

  it('末尾が / の除外は木ごと読まない(外部との連絡口。手元にだけある未追跡の文書で生成物が CI と食い違わないように)', () => {
    write('journal/guide.md', '生きた読み物');
    write('journal/external/README.md', '相手が書いた手順書');
    write('journal/external/inbox/note.md', '相手が書いた文');

    const files = scanProseFiles(root, ['journal'], {}, ['journal/external/']);

    expect(files.map((file) => file.file)).toEqual(['journal/guide.md']);
  });

  it('名指しした歴史の記録だけを読まない(同じ木の生きた読み物は読む)', () => {
    write('journal/guide.md', '生きた読み物');
    write('journal/queue.md', '歴史の記録');
    write('journal/plan.md', '歴史の記録');

    const files = scanProseFiles(root, ['journal'], {}, ['journal/queue.md', 'journal/plan.md']);

    expect(files.map((file) => file.file)).toEqual(['journal/guide.md']);
  });
});

describe('scanTermCorpus', () => {
  it('台帳の first を読み、読めないものは null、同じ first は 1 回だけ持つ', () => {
    write('docs/rules/a.md', '注釈の話');
    const spec = ledger([
      term('注釈', { id: 'tag', first: 'docs/rules/a.md' }),
      term('印', { id: 'marker', first: 'docs/rules/a.md' }),
      term('窓', { id: 'window', first: 'docs/rules/gone.md' }),
    ]);

    const corpus = scanTermCorpus(root, scope({ proseTrees: ['docs/rules'] }), spec);

    expect([...corpus.firstTexts]).toEqual([
      ['docs/rules/a.md', '注釈の話'],
      ['docs/rules/gone.md', null],
    ]);
    expect(corpus.files.map((file) => file.file)).toEqual(['docs/rules/a.md']);
  });

  it('first は走査範囲の外のファイルも指せる', () => {
    write('elsewhere/x.md', '範囲の外の初出');

    const corpus = scanTermCorpus(root, scope({ proseTrees: ['docs/rules'] }), ledger([term('語', { first: 'elsewhere/x.md' })]));

    expect(corpus.firstTexts.get('elsewhere/x.md')).toBe('範囲の外の初出');
    expect(corpus.files).toEqual([]);
  });
});

describe('scanProseFiles: 生成ブロックを落とす木', () => {
  it('skipGeneratedBlocks を渡した木は、生成ブロックの行を落とす', () => {
    write('docs/specs/a.md', '手書き\n<!-- AUTO-GENERATED:t -->\n生成\n<!-- /AUTO-GENERATED:t -->\n');

    const files = scanProseFiles(root, ['docs/specs'], { skipGeneratedBlocks: true });

    expect(files[0]?.lines.map((line) => line.text)).toEqual(['手書き', '']);
  });
});

describe('scanCodeText', () => {
  it('コメントと日本語を含む文字列リテラルを読み、どちらも無いファイルは入れない', () => {
    write('app/a.ts', "const s = '固定物'; // 行末\n/** 説明 */\n");
    write('app/b.ts', "const s = 'fixture';\nconst t = 'a/b';\n");
    write('app/c.mts', '// mts のコメント\n');
    write('app/notes.md', '// コードではない\n');

    const files = scanCodeText(root, ['app']);

    expect(files.map((file) => file.file)).toEqual(['app/a.ts', 'app/c.mts']);
    expect(files[0]?.lines.map((line) => line.text)).toEqual(['// 行末', '固定物', '/** 説明 */']);
    expect(files[0]?.lines.map((line) => line.line)).toEqual([1, 1, 2]);
  });

  it('日本語を含まない文字列リテラルは読まない(識別子・パス・英語のラベル)', () => {
    write('app/a.ts', "const a = 'plain';\nconst b = `template ${x}`;\n");

    expect(scanCodeText(root, ['app'])).toEqual([]);
  });

  it('リテラルを読まないと名指ししたファイルでは、コメントだけを読む', () => {
    write('gen/m.ts', "// コメント\nconst s = '外から届く面';\n");
    write('gen/n.ts', "const s = '外から届く面';\n");

    const files = scanCodeText(root, ['gen'], ['gen/m.ts', 'gen/n.ts']);

    expect(files.map((file) => [file.file, file.lines.map((line) => line.text)])).toEqual([['gen/m.ts', ['// コメント']]]);
  });

  it('テストのファイルは題だけを読む(入力と期待値のリテラルは読まない)', () => {
    write('app/__tests__/x.test.ts', "it('題は読む', () => {\n  run('入力は読まない');\n  expect(out).toBe('期待値は読まない');\n});\n");

    const files = scanCodeText(root, ['app']);

    expect(files[0]?.lines.map((line) => line.text)).toEqual(['題は読む']);
  });

  it('生成物(先頭に生成の目印があるファイル)と、実装の木の根の出力は読まない。同じ名前の深い場所は読む(点検 14 回目 C14-1)', () => {
    write('app/gen.ts', '// AUTO-GENERATED by `npm run generate` — 手編集禁止\n// 旧綴りのコメント\n');
    write('app/build/x.js', '// ビルド成果物\n');
    write('app/node_modules/y.js', '// 依存\n');
    write('app/ok.ts', '// 本物\n');
    write('app/src/build/z.ts', '// 深い場所の同じ名前は手で書くコード\n');

    expect(scanCodeText(root, ['app'], [], 'app').map((file) => file.file)).toEqual(['app/ok.ts', 'app/src/build/z.ts']);
  });

  it('木が無ければ何も読まない(壊れない)', () => {
    expect(scanCodeText(root, ['app', 'framework'])).toEqual([]);
  });
});

describe('scanHashComments', () => {
  it('シェルと YAML(拡張子なしのフック・.yml・.yaml・.sh)の # コメントを読む。ほかの拡張子は読まない', () => {
    write('hooks/pre-commit', '#!/bin/sh\n# フックの説明\nset -e\n');
    write('ci/workflows/ci.yml', 'jobs: {}\n# CI の説明\n');
    write('ci/x.yaml', '# 別の YAML\n');
    write('ci/run.sh', '# スクリプト\n');
    write('ci/README.md', '# 見出しであってコメントではない\n');
    write('ci/data.json', '# これも読まない\n');

    const files = scanHashComments(root, ['hooks', 'ci']);

    expect(files.map((file) => file.file)).toEqual([
      'hooks/pre-commit',
      'ci/run.sh',
      'ci/workflows/ci.yml',
      'ci/x.yaml',
    ]);
    expect(files[0]?.lines.map((line) => line.text)).toEqual(['#!/bin/sh', '# フックの説明']);
  });

  it('コメントの無いファイルは入れない・木が無ければ何も読まない', () => {
    write('hooks/empty', 'set -e\n');

    expect(scanHashComments(root, ['hooks', 'ci'])).toEqual([]);
  });
});

describe('scanTermCorpus: 範囲をまとめる', () => {
  it('規約の木 → 仕様の木 → 案内のファイル → コード → シェルと YAML の順に並べる', () => {
    write('docs/rules/r.md', '規約');
    write('docs/specs/s.md', '仕様');
    write('guide.md', '案内');
    write('app/c.ts', '// コメント\n');
    write('hooks/pre-commit', '# フック\n');

    const corpus = scanTermCorpus(
      root,
      scope({
        proseTrees: ['docs/rules'],
        specTrees: ['docs/specs'],
        proseFiles: ['guide.md', 'gone.md'],
        codeTrees: ['app'],
        hashCommentTrees: ['hooks'],
      }),
      ledger([]),
    );

    expect(corpus.files.map((file) => file.file)).toEqual([
      'docs/rules/r.md',
      'docs/specs/s.md',
      'guide.md',
      'app/c.ts',
      'hooks/pre-commit',
    ]);
  });
});

describe('scanSummaries(人が書く文の収集)', () => {
  it('ドメイン仕様の frontmatter の summary を、ファイルの順・名前順に集める', () => {
    write('docs/specs/domain/b/states.md', '---\ndoc_type: state_spec\nmachines:\n  - machine: m\n    summary: 節の要約です。\n    states:\n      - id: s\n        summary: 段の場面です。\n---\n本文\n');
    write('docs/specs/domain/a/entity.md', '---\ndoc_type: entity_spec\nsummary: 章の頭です。\n---\n');

    const found = scanSummaries(root, ['docs/specs/domain']);

    expect(found.map((item) => [item.file, item.pointer, item.text])).toEqual([
      ['docs/specs/domain/a/entity.md', 'summary', '章の頭です。'],
      ['docs/specs/domain/b/states.md', 'machines[0].summary', '節の要約です。'],
      ['docs/specs/domain/b/states.md', 'machines[0].states[0].summary', '段の場面です。'],
    ]);
  });

  it('木が無い・summary が無い・壊れた frontmatter でも壊れない(いまの本番の形)', () => {
    expect(scanSummaries(root, ['docs/specs/domain'])).toEqual([]);
    write('docs/specs/domain/a/entity.md', '---\ndoc_type: entity_spec\n---\n');
    write('docs/specs/domain/b/entity.md', '---\n: : 壊れた\n  - [\n---\n');
    expect(scanSummaries(root, ['docs/specs/domain'])).toEqual([]);
  });

  it('文字列でない summary と空の summary は拾わない', () => {
    write('docs/specs/domain/a/entity.md', '---\nsummary: 3\nitems:\n  - summary: "  "\n---\n');

    expect(scanSummaries(root, ['docs/specs/domain'])).toEqual([]);
  });

  it('雛形(template.*.md)の summary と語は数えない(置き換える前の書き方の例だから)', () => {
    write('docs/specs/domain/template.entity_spec.md', '---\nsummary: "{この集約が何か}"\nlabel: 雛形の語\n---\n');
    write('docs/specs/domain/a/entity.md', '---\nsummary: 章の頭です。\n---\n');

    expect(scanSummaries(root, ['docs/specs/domain']).map((item) => item.text)).toEqual(['章の頭です。']);
    expect(scanSpecText(root, ['docs/specs/domain'])).not.toContain('雛形');
  });

  it('scanTermCorpus は summaries を持ち帰る', () => {
    write('docs/specs/domain/a/entity.md', '---\nsummary: 章の頭です。\n---\n');

    const corpus = scanTermCorpus(root, scope({ summaryTrees: ['docs/specs/domain'] }), ledger([]));

    expect(corpus.summaries.map((item) => item.text)).toEqual(['章の頭です。']);
  });

  it('scanSpecText は frontmatter の文字列の値を集める(summary は入れない・壊れた frontmatter は読み飛ばす)', () => {
    write('docs/specs/domain/a/entity.md', '---\nlabel: 催し\nsummary: 章の頭です。\nfields:\n  - name: title\n    label: 題名\n---\n本文は入れない\n');
    write('docs/specs/domain/b/entity.md', '---\n: : 壊れた\n  - [\n---\n');

    const text = scanSpecText(root, ['docs/specs/domain']);

    expect(text.split('\n')).toEqual(['催し', 'title', '題名']);
    expect(text).not.toContain('章の頭');
    expect(text).not.toContain('本文');
  });
});
