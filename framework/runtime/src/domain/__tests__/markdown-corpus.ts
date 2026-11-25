/**
 * 書式つきの本文の描画のテストが共有する、敵対的な入力の表と出力の検算器。
 * 検算器は出力の字面を許可リスト(要素・属性・href の綴り)に当てる —— 入力ごとに期待を書かない。
 */

import { ALLOWED_TAGS } from '../markdown';

/** 要素ごとに許す属性(`renderMarkdown` の許可リストと同じ宣言。食い違えば下の表のどれかが鳴る)。 */
const ATTRIBUTES: Readonly<Record<string, readonly string[]>> = { a: ['href', 'rel'], ol: ['start'], code: ['class'] };

/**
 * 出力の HTML が許可リストの外に出ていないかの検算(違反の文を返す。空なら安全)。
 *
 * 要素は許可リストの中・属性は要素ごとの許可・`href` は絶対の http / https・`rel` は固定・`start` は数字・`class` は言語の印だけ、
 * そして**要素の外の `<` が無い**(文字は全部エスケープされている)こと。
 */
export function unsafeFindings(html: string): string[] {
  const findings: string[] = [];
  const tagPattern = /<(\/?)([A-Za-z][A-Za-z0-9]*)([^<>]*)>/gu;
  for (const match of html.matchAll(tagPattern)) {
    const [, closing, name = '', rest = ''] = match;
    if (!ALLOWED_TAGS.includes(name)) findings.push(`許可リストに無い要素 <${name}>`);
    if (closing === '/') {
      if (rest.trim() !== '') findings.push(`閉じ要素に属性 </${name}${rest}>`);
      continue;
    }
    const attrs = [...rest.matchAll(/\s+([A-Za-z-]+)(?:="([^"]*)")?/gu)];
    const consumed = attrs.map((attr) => attr[0]).join('');
    if (consumed !== rest.replace(/\s*\/$/u, '')) findings.push(`読み切れない属性 <${name}${rest}>`);
    for (const [, attr = '', value = ''] of attrs) {
      if (!(ATTRIBUTES[name] ?? []).includes(attr)) findings.push(`許可リストに無い属性 ${name}[${attr}]`);
      if (attr === 'href' && !/^https?:\/\/[^\s"<>]+$/u.test(value)) findings.push(`絶対の http / https でない href ${value}`);
      if (attr === 'rel' && value !== 'noopener noreferrer') findings.push(`rel が固定でない ${value}`);
      if (attr === 'start' && !/^[0-9]+$/u.test(value)) findings.push(`start が数字でない ${value}`);
      if (attr === 'class' && !/^language-[A-Za-z0-9_+-]{1,30}$/u.test(value)) findings.push(`class が言語の印でない ${value}`);
    }
  }
  if (html.replace(tagPattern, '').includes('<')) findings.push('要素の外に <');
  return findings;
}

/** 敵対的な入力の表(名前, 本文)。どれも出力が許可リストの外に出ないこと。 */
export const HOSTILE: readonly (readonly [string, string])[] = [
  // 生の HTML(要素)
  ['script 要素', '<script>alert(1)</script>'],
  ['大文字の SCRIPT', '<SCRIPT SRC=//evil.example/x.js></SCRIPT>'],
  ['入れ子で組み立てる script', '<scr<script>ipt>alert(1)</scr</script>ipt>'],
  ['img の onerror', '<img src=x onerror=alert(1)>'],
  ['引用符なしの属性と斜線', '<img/src=x/onerror=alert(1)>'],
  ['svg の onload', '<svg onload=alert(1)>'],
  ['svg の中の script', '<svg><script>alert(1)</script></svg>'],
  ['svg の animate で href を差し替え', '<svg><a><animate attributeName=href values=javascript:alert(1) /><text>x</text></a></svg>'],
  ['iframe の srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ['iframe の javascript:', '<iframe src="javascript:alert(1)"></iframe>'],
  ['object と embed', '<object data="data:text/html,<script>alert(1)</script>"></object><embed src="x">'],
  ['style 要素', '<style>body{display:none}</style>'],
  ['style 属性', '<p style="background:url(javascript:alert(1))">x</p>'],
  ['div の style と class', '<div class="a" style="position:fixed;inset:0">overlay</div>'],
  ['form と input', '<form action="/x"><input autofocus onfocus=alert(1)><button formaction="javascript:alert(1)">go</button></form>'],
  ['details の ontoggle', '<details open ontoggle=alert(1)>x</details>'],
  ['body の onload', '<body onload=alert(1)>'],
  ['base で相対 URL を乗っ取る', '<base href="https://evil.example/">'],
  ['meta の refresh', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
  ['link で外のスタイルシート', '<link rel="stylesheet" href="https://evil.example/x.css">'],
  ['math と mglyph の変異 XSS', '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">'],
  ['noscript の中の属性', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
  ['HTML コメントの後ろの script', '<!-- x --><script>alert(1)</script>'],
  ['CDATA', '<![CDATA[<script>alert(1)</script>]]>'],
  ['a 要素の javascript:', '<a href="javascript:alert(1)">x</a>'],
  ['a 要素の onclick', '<a href="https://example.org" onclick="alert(1)">x</a>'],
  ['a 要素の target', '<a href="https://example.org" target="_blank">x</a>'],
  ['video と source', '<video src=x onerror=alert(1)><source src=x onerror=alert(1)></video>'],
  ['template', '<template><script>alert(1)</script></template>'],
  // 記法のリンク
  ['javascript: のリンク', '[x](javascript:alert(1))'],
  ['大文字まじりの javascript:', '[x](JaVaScRiPt:alert(1))'],
  ['実体参照で綴る javascript:', '[x](java&#x73;cript:alert(1))'],
  ['10 進の実体参照で綴る javascript:', '[x](&#106;avascript:alert(1))'],
  ['タブを挟む javascript:', '[x](jav&#x09;ascript:alert(1))'],
  ['改行を挟む javascript:', '[x](jav&#x0A;ascript:alert(1))'],
  ['山括弧の中の先頭の空白', '[x](< javascript:alert(1)>)'],
  ['data: のリンク', '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
  ['vbscript:', '[x](vbscript:msgbox(1))'],
  ['file:', '[x](file:///etc/passwd)'],
  ['blob:', '[x](blob:https://example.org/uuid)'],
  ['ftp:', '[x](ftp://example.org/x)'],
  ['mailto:', '[x](mailto:a@example.org)'],
  ['tel:', '[x](tel:+81000000000)'],
  ['プロトコル相対', '[x](//evil.example/x)'],
  ['相対パス', '[x](/pages/about)'],
  ['フラグメントだけ', '[x](#top)'],
  ['ユーザー名つきの偽装', '[x](https://trusted.example@evil.example/)'],
  ['パスワードつき', '[x](https://user:pw@evil.example/)'],
  ['javascript: の自動リンク', '<javascript:alert(1)>'],
  ['参照形式の javascript:', '[x][1]\n\n[1]: javascript:alert(1)'],
  ['リンクの title で属性を閉じる', '[x](https://example.org "a\\" onmouseover=\\"alert(1)")'],
  ['URL の中の引用符', '[x](https://example.org/"onmouseover="alert(1))'],
  ['リンクの文字に HTML', '[<img src=x onerror=alert(1)>](https://example.org)'],
  ['リンクの文字が javascript:', '[javascript:alert(1)](javascript:alert(1))'],
  // 画像
  ['画像の javascript:', '![x](javascript:alert(1))'],
  ['画像の https', '![x](https://example.org/a.png)'],
  ['画像の data: svg', '![x](data:image/svg+xml,<svg onload=alert(1)>)'],
  ['画像だけのリンク', '[![x](https://example.org/a.png)](javascript:alert(1))'],
  ['参照形式の画像', '![x][1]\n\n[1]: https://example.org/a.png "t"'],
  ['alt に HTML', '![<script>alert(1)</script>](https://example.org/a.png)'],
  // 符号化・エスケープ
  ['エスケープされた script を文字として', '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['10 進の実体参照の山括弧', '&#60;script&#62;alert(1)&#60;/script&#62;'],
  ['16 進の実体参照の山括弧', '&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;'],
  ['セミコロンの無い実体参照', '&lt script&gt alert(1)'],
  ['バックスラッシュで山括弧を守る', '\\<script>alert(1)\\</script>'],
  ['全角の山括弧', '＜script＞alert(1)＜/script＞'],
  ['NUL を挟む script', '<scr\u0000ipt>alert(1)</scr\u0000ipt>'],
  ['NUL を挟む javascript:', '[x](java\u0000script:alert(1))'],
  ['右から左への上書き制御', '‮<script>alert(1)</script>'],
  ['アンパサンドの連なり', '&&&amp;&amp;amp;&#38;#60;script&#38;#62;'],
  // コード
  ['インラインコードの中の script', '`<script>alert(1)</script>`'],
  ['フェンスコードの中の HTML', '```html\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n```'],
  ['フェンスの言語に属性を差し込む', '```js" onclick="alert(1)\ncode\n```'],
  ['フェンスの言語に山括弧', '```<script>\ncode\n```'],
  ['インデントのコード', '    <script>alert(1)</script>'],
  // 入れ子
  ['引用の中の HTML', '> <script>alert(1)</script>\n> <img src=x onerror=alert(1)>'],
  ['リストの中の HTML', '- <script>alert(1)</script>\n- <b onclick=alert(1)>x</b>'],
  ['見出しの中の HTML', '# <img src=x onerror=alert(1)>'],
  ['強調の中の HTML', '*<script>alert(1)</script>* **<img src=x onerror=alert(1)>**'],
  ['リストの中の引用の中のリンク', '- > [x](javascript:alert(1))'],
  ['番号つきリストの開始番号', '99999999999999999999. x'],
  ['タスクリスト', '- [ ] <input checked> x\n- [x] y'],
  ['表の記法(解釈しない)', '| a | b |\n| - | - |\n| <script>alert(1)</script> | [x](javascript:alert(1)) |'],
  ['脚注の記法(解釈しない)', 'x[^1]\n\n[^1]: <script>alert(1)</script>'],
  ['HTML と Markdown の入れ子', '<div>\n\n*[x](javascript:alert(1))*\n\n</div>'],
];
