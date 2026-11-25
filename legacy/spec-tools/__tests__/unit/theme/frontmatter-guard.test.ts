/**
 * ハンドブックの Markdown の頭(フロントマター)を実行しない関所(`docs/.vitepress/frontmatter-guard.ts`)のテスト。
 *
 * 1 回目の点検で spec-tools の読み取り(`lib/io/front-matter.ts`)は `---js` を拒むようにしたが、
 * ハンドブックを開く道(VitePress と vitepress-sidebar の gray-matter)は塞がっていなかった(3 回目 C-1)。
 * ここでは (1) 関所の判定の表、(2) **本物の VitePress** の描画器と build に `---js` を当てて、
 * マーカーが書かれないこと(build は失敗する)を確かめる。対照として、無害な木は同じ手順で build が通る。
 *
 * 4 回目 C4-1: 関所は先頭 512 バイトしか見ず、開きの行を `---` + 空白 600 個 + `js` にすると素通りした(PWNED-real)。
 * 4 回目 C4-2: `<!--@include: 根の外.md-->` の取り込みの先は VitePress が既定の gray-matter で読む(PWNED-include)。
 * どちらも反例の形をそのまま回帰に置き、gray-matter の既定のエンジンの表の差し替え(根治)も単体で確かめる。
 */

import { spawnSync } from 'node:child_process';
import { withoutGitEnv } from '../../helpers/git-env.js';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SAFE_GRAY_MATTER_OPTIONS,
  assertNoExecutableFrontmatter,
  disableExecutingGrayMatterEngines,
  findExecutableFrontmatter,
  findIncludeDirectives,
  hasIncludeDirective,
  hasLanguageTag,
} from '../../../../../docs/.vitepress/frontmatter-guard.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const DOCS = path.join(REPO_ROOT, 'docs');

/** docs の node_modules の gray-matter(vitepress-sidebar が import するのと同じ 1 本)の既定のエンジンの表。 */
const GRAY_MATTER_ENGINES = (createRequire(path.join(DOCS, '.vitepress', 'x.js'))('gray-matter') as { engines: Record<string, unknown> })
  .engines;
const ORIGINAL_ENGINES = { ...GRAY_MATTER_ENGINES };

let work = '';

beforeEach(() => {
  mkdirSync(path.join(REPO_ROOT, 'tmp'), { recursive: true });
  work = mkdtempSync(path.join(REPO_ROOT, 'tmp', 'fm-guard-'));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
  // 差し替えはプロセス全体に効くので、テストごとに元へ戻す(差し替えの有無を各テストが自分で決める)。
  for (const key of Object.keys(GRAY_MATTER_ENGINES)) delete GRAY_MATTER_ENGINES[key];
  Object.assign(GRAY_MATTER_ENGINES, ORIGINAL_ENGINES);
});

/** 4 回目 C4-1 の反例の開きの行(関所が読む先頭 512 バイトを空白で埋め、言語名をその外に置く)。 */
function longOpening(language: string): string {
  return `---${' '.repeat(600)}${language}`;
}

/** 実行されたら書かれるマーカーを作る md の頭つき本文。 */
function evilSource(language: string, marker: string): string {
  return `---${language}\n(function(){ process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(marker)},'x'); return {title:'x'}; })()\n---\n# evil\n`;
}

function put(root: string, rel: string, source: string): void {
  const target = path.join(root, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
}

describe('hasLanguageTag(開きの行の判定表)', () => {
  const rows: ReadonlyArray<readonly [string, string, boolean]> = [
    ['---js', '---js\nx\n---', true],
    ['---javascript', '---javascript\nx\n---', true],
    ['---JS(大文字)', '---JS\nx\n---', true],
    ['--- js(空白つき)', '--- js\nx\n---', true],
    ['---coffee', '---coffee\nx\n---', true],
    ['---yaml(YAML の明示も拒む)', '---yaml\nx: 1\n---', true],
    ['---json', '---json\n{}\n---', true],
    ['CRLF の ---js', '---js\r\nx\r\n---', true],
    ['BOM つきの ---js(BOM は呼び手が除く前提でなく、読み取りが除く)', '---js', true],
    ['--- だけ', '---\ntitle: x\n---', false],
    ['--- と末尾の空白', '---  \ntitle: x\n---', false],
    ['CRLF の ---', '---\r\ntitle: x\r\n---', false],
    ['---- (水平線。gray-matter も頭と見なさない)', '----\nx', false],
    ['頭が無い', '# title\n', false],
    ['先頭の空行のあとの ---js(gray-matter は頭と見なさない)', '\n---js\nx', false],
    ['空のファイル', '', false],
    // 4 回目 C4-1: 読む長さで切らない・許す形を 1 つに決める。
    ['--- + 空白 600 個 + js(PWNED-real の開き)', `${longOpening('js')}\nx\n---`, true],
    ['--- + 空白 600 個(言語名なし)は通す', `---${' '.repeat(600)}\ntitle: x\n---`, false],
    ['--- + タブ', '---\t\t\ntitle: x\n---', false],
    ['--- + NBSP + js(trim が NBSP を削る)', '---\u00a0js\nx\n---', true],
    ['--- + NBSP だけ(許す形でないので拒む側に倒す)', '---\u00a0\nx\n---', true],
    ['--- + 行区切り U+2028 + js', '---\u2028js\nx\n---', true],
    ['--- + CR + js(CR は改行でない)', '---\rjs\nx\n---', true],
    ['--- + 縦タブ', '---\v\nx\n---', true],
    ['改行の無い --- だけ', '---', false],
    ['改行の無い ---js', '---js', true],
    ['BOM 自体を含む頭の ---js', '\uFEFF---js\nx', true],
    ['BOM 自体を含む頭の ---', '\uFEFF---\nx', false],
  ];
  it.each(rows)('%s', (_name, head, expected) => {
    expect(hasLanguageTag(head)).toBe(expected);
  });
});

describe('findExecutableFrontmatter / assertNoExecutableFrontmatter', () => {
  it('どの深さの md の言語指定も見つける(verify が読まない knowledge / design / README も)', () => {
    put(work, 'README.md', evilSource('js', 'x'));
    put(work, 'knowledge/a/b/c.md', evilSource('javascript', 'x'));
    put(work, 'design/ok.md', '---\ntitle: ok\n---\n# ok\n');
    put(work, 'knowledge/node_modules/n.md', evilSource('js', 'x'));
    expect(findExecutableFrontmatter(work).sort()).toEqual([
      path.join('README.md'),
      path.join('knowledge', 'a', 'b', 'c.md'),
      path.join('knowledge', 'node_modules', 'n.md'),
    ].sort());
    expect(() => assertNoExecutableFrontmatter(work)).toThrow(/README\.md/);
  });

  it('根の直下の node_modules と .vitepress は歩かない(VitePress の srcExclude と同じ)', () => {
    put(work, 'node_modules/p/readme.md', evilSource('js', 'x'));
    put(work, '.vitepress/dist/x.md', evilSource('js', 'x'));
    put(work, 'ok.md', '# ok\n');
    expect(findExecutableFrontmatter(work)).toEqual([]);
    expect(() => assertNoExecutableFrontmatter(work)).not.toThrow();
  });

  it('BOM つきの ---js も拒む', () => {
    put(work, 'bom.md', `﻿${evilSource('js', 'x')}`);
    expect(findExecutableFrontmatter(work)).toEqual(['bom.md']);
  });

  it('md へのシンボリックリンク越しの ---js も見つける', () => {
    put(work, 'real/evil.md', evilSource('js', 'x'));
    mkdirSync(path.join(work, 'view'), { recursive: true });
    symlinkSync(path.join(work, 'real', 'evil.md'), path.join(work, 'view', 'link.md'));
    expect(findExecutableFrontmatter(work).sort()).toEqual([path.join('real', 'evil.md'), path.join('view', 'link.md')]);
  });

  it('PWNED-real の形(開きの行が 512 バイトを越える)を book/ でも見つける', () => {
    put(work, 'book/zz-evil.md', `${longOpening('js')}\n({order: 1})\n---\n# t\n`);
    put(work, 'book/ok-long.md', `---${' '.repeat(600)}\norder: 1\n---\n# ok\n`);
    expect(findExecutableFrontmatter(work)).toEqual([path.join('book', 'zz-evil.md')]);
  });

  it('上限(64 KiB)まで読んでも改行が無い --- 始まりは読めないとして拒む・--- 始まりでない長い行は通す', () => {
    put(work, 'huge-open.md', `---${' '.repeat(70 * 1024)}`);
    put(work, 'huge-limit.md', `---${' '.repeat(64 * 1024)}`);
    put(work, 'huge-text.md', `${'a'.repeat(100 * 1024)}\n# t\n`);
    put(work, 'just-under.md', `---${' '.repeat(64 * 1024 - 10)}\ntitle: x\n---\n`);
    expect(findExecutableFrontmatter(work).sort()).toEqual(['huge-limit.md', 'huge-open.md']);
  });

  it('改行がチャンクの境目(2 塊目の先頭 = 4096 バイト目)にあっても 1 行目を正しく切る', () => {
    put(work, 'edge-ok.md', `---${' '.repeat(4093)}\njs: 1\n`);
    put(work, 'edge-bad.md', `---${' '.repeat(4091)}js\nx\n`);
    expect(findExecutableFrontmatter(work)).toEqual(['edge-bad.md']);
  });

  it('実際の docs/ は緑(関所が正常な体系を止めない)', () => {
    expect(() => assertNoExecutableFrontmatter(DOCS)).not.toThrow();
    expect(findIncludeDirectives(DOCS)).toEqual([]);
  });
});

describe('hasIncludeDirective(VitePress の取り込みの指令の判定表)', () => {
  const rows: ReadonlyArray<readonly [string, string, boolean]> = [
    ['PWNED-include の形', '<!--@include: ../outside/evil.md-->', true],
    ['空白つき', '<!--  @include:   ./a.md   -->', true],
    ['@ で始まる根の基準', '<!--@include: @/x.md-->', true],
    ['範囲つき', '<!-- @include: ./a.md{1,3} -->', true],
    ['区画つき', '<!-- @include: ./a.md#part -->', true],
    ['改行をまたぐ', '<!--\n  @include:\n./a.md\n-->', true],
    ['コードブロックの中(VitePress は生の本文を置き換える)', '```md\n<!--@include: ./a.md-->\n```', true],
    ['中身が空(VitePress は何もしないが一律に拒む)', '<!--@include:-->', true],
    ['注釈でない @include:', '@include: ./a.md', false],
    ['コロンの無い include', '<!-- include ./a.md -->', false],
    ['閉じない注釈', '<!--@include: ./a.md', false],
    ['大文字(VitePress の式は大小を区別する)', '<!--@INCLUDE: ./a.md-->', false],
  ];
  it.each(rows)('%s', (_name, source, expected) => {
    expect(hasIncludeDirective(source)).toBe(expected);
  });

  it('findIncludeDirectives / assertNoExecutableFrontmatter: 取り込みを書いた md を名指しで拒む', () => {
    put(work, 'index.md', '# home\n\n<!--@include: ../outside/evil.md-->\n');
    put(work, 'knowledge/n.md', '# n\n');
    expect(findIncludeDirectives(work)).toEqual(['index.md']);
    expect(() => assertNoExecutableFrontmatter(work)).toThrow(/include.*index\.md/s);
  });
});

describe('disableExecutingGrayMatterEngines(gray-matter の既定のエンジンの表の差し替え = 根治)', () => {
  it('渡した表の実行するエンジンを全部拒む関数にし、yaml / json は残す', () => {
    const table: Record<string, unknown> = { yaml: 'Y', json: 'J', javascript: 'EVAL' };
    disableExecutingGrayMatterEngines(table);
    expect(table.yaml).toBe('Y');
    expect(table.json).toBe('J');
    for (const name of ['js', 'javascript', 'coffee', 'coffeescript', 'cson']) {
      const engine = table[name] as { parse: () => unknown };
      expect(() => engine.parse(), name).toThrow(/受け付けません/);
    }
  });

  it('vitepress-sidebar の読み取り(オプションなしの gray-matter)に ---js を当てても評価されない(関所を通さずに直接)', async () => {
    const marker = path.join(work, 'SIDEBAR_MARKER.txt');
    put(work, 'evil.md', evilSource('js', marker).replace('return {title', 'return {order: 7, title'));
    disableExecutingGrayMatterEngines();
    const helper = (await import(pathToFileURL(path.join(DOCS, 'node_modules/vitepress-sidebar/dist/helper.js')).href)) as {
      getOrderFromFrontmatter: (file: string, fallback: number) => number;
    };
    expect(helper.getOrderFromFrontmatter(path.join(work, 'evil.md'), 0)).toBe(0);
    expect(existsSync(marker)).toBe(false);
    // 対照: yaml の頭は差し替えの後も読める(差し替えが gray-matter を壊していない)。
    put(work, 'ok.md', '---\norder: 3\n---\n# ok\n');
    expect(helper.getOrderFromFrontmatter(path.join(work, 'ok.md'), 0)).toBe(3);
  });

  it('assertNoExecutableFrontmatter は判定の前に既定の表を差し替える(無害な木でも)', () => {
    put(work, 'ok.md', '# ok\n');
    assertNoExecutableFrontmatter(work);
    const engine = GRAY_MATTER_ENGINES.javascript as { parse: () => unknown };
    expect(() => engine.parse()).toThrow(/受け付けません/);
  });
});

describe('実物の VitePress に ---js を当てる', () => {
  it('描画器: 実行するエンジンは例外になり、マーカーは書かれない(yaml の頭は通る)', async () => {
    const vitepress = (await import(pathToFileURL(path.join(DOCS, 'node_modules/vitepress/dist/node/index.js')).href)) as {
      createMarkdownRenderer: (srcDir: string, options: object) => Promise<{ render: (src: string, env?: object) => string }>;
    };
    const md = await vitepress.createMarkdownRenderer(work, { frontmatter: SAFE_GRAY_MATTER_OPTIONS });
    for (const language of ['js', 'javascript', 'JS', 'coffee', 'cson']) {
      const marker = path.join(work, `marker-${language}.txt`);
      expect(() => md.render(evilSource(language, marker), {}), language).toThrow();
      expect(existsSync(marker), language).toBe(false);
    }
    const env: { frontmatter?: Record<string, unknown> } = {};
    md.render('---\ntitle: safe\n---\n# safe\n', env);
    expect(env.frontmatter?.title).toBe('safe');
  });

  // 小さな木に docs/.vitepress の設定一式を複写し、docs の node_modules を引いて本物の `vitepress build` を回す。
  function buildSite(site: string, extra: (site: string) => void): ReturnType<typeof spawnSync> {
    mkdirSync(site, { recursive: true });
    cpSync(path.join(DOCS, '.vitepress'), path.join(site, '.vitepress'), {
      recursive: true,
      // 出力・キャッシュと独自テーマ(ブックの CSS を引く)は複写しない。設定とその部品(config.ts / frontmatter-guard.ts ほか)が検査の対象。
      filter: (source) => !['dist', 'cache', 'theme'].some((name) => source.includes(`${path.sep}.vitepress${path.sep}${name}`)),
    });
    symlinkSync(path.join(DOCS, 'node_modules'), path.join(site, 'node_modules'));
    for (const dir of ['rules', 'specs', 'book']) put(site, `${dir}/README.md`, `# ${dir}\n`);
    put(site, 'index.md', '# home\n');
    put(site, 'package.json', '{"type":"module"}');
    extra(site);
    return spawnSync(process.execPath, [path.join(DOCS, 'node_modules/vitepress/bin/vitepress.js'), 'build', '.'], {
      cwd: site,
      env: withoutGitEnv(),
      encoding: 'utf8',
      timeout: 300_000,
    });
  }

  it('build: ---js の md(verify が読まない knowledge に置く)があると build は失敗し、マーカーは書かれない', () => {
    const marker = path.join(work, 'BUILD_MARKER.txt');
    const result = buildSite(path.join(work, 'evil-site'), (site) => put(site, 'knowledge/note.md', evilSource('js', marker)));
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('knowledge');
    expect(existsSync(marker)).toBe(false);
  }, 360_000);

  it('build: PWNED-real の形(開きの行が長い ---js を book/ に置く)は build が失敗し、マーカーは書かれない', () => {
    const marker = path.join(work, 'BUILD_MARKER_LONG.txt');
    const result = buildSite(path.join(work, 'long-site'), (site) =>
      put(site, 'book/zz-evil.md', evilSource(`${' '.repeat(600)}js`, marker)),
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('zz-evil.md');
    expect(existsSync(marker)).toBe(false);
  }, 360_000);

  it('build: PWNED-include の形(根の外の ---js を取り込む)は build が失敗し、マーカーは書かれない', () => {
    const marker = path.join(work, 'BUILD_MARKER_INCLUDE.txt');
    put(work, 'outside/evil.md', evilSource('js', marker));
    const result = buildSite(path.join(work, 'include-site'), (site) =>
      put(site, 'index.md', '# home\n\n<!--@include: ../outside/evil.md-->\n'),
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('@include');
    expect(existsSync(marker)).toBe(false);
  }, 360_000);

  it('build(対照): 無害な木は同じ手順で通る(失敗の原因が複写の不備でないことの確認)', () => {
    const result = buildSite(path.join(work, 'ok-site'), (site) => put(site, 'knowledge/note.md', '---\ntitle: note\n---\n# note\n'));
    expect(`${result.stdout}${result.stderr}`).toContain('build complete');
    expect(result.status).toBe(0);
  }, 360_000);
});
