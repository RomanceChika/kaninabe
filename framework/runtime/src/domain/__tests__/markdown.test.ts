/**
 * 書式つきの本文(`format: markdown`)の描画と素の文の取り出しのテスト。
 *
 * 見るのは 3 つ: ①**敵対的な入力の表**(XSS の定番・符号化の細工・入れ子)がどれも許可リストの外へ出ない
 * ②**ふつうの Markdown が期待どおりの HTML になる** ③**描けない本文が例外を投げず素の文に縮退する**。
 * ①は「出力が安全か」を 1 つの検算器(`unsafeFindings`)で見る —— 入力ごとに期待を書かず、出力の字面を
 * 許可リスト(要素・属性・href の綴り)に当てる。検算器自身が効いていることは「壊した出力を渡すと鳴る」表で見る。
 */

import { isMainThread } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { MARKDOWN_RENDER_LIMIT, excerptOf, plainTextOf, renderMarkdown } from '../markdown';
import { HOSTILE, unsafeFindings } from './markdown-corpus';
import { MarkdownView } from '../markdown-view';

describe('renderMarkdown — 敵対的な入力の表(出力は許可リストの外に出ない)', () => {
  it.each(HOSTILE)('%s', (_name, body) => {
    const html = renderMarkdown(body);

    expect(unsafeFindings(html)).toEqual([]);
    // 危ない要素の字面が要素の位置に残っていないこと(コードや文の中の綴りは `&#x3C;` にエスケープされる)。属性は検算器が見る。
    expect(html).not.toMatch(/<(script|style|img|svg|iframe|object|embed|form|input|base|meta|link|template|video|math)/iu);
    expect(html).not.toMatch(/href="(?!https?:\/\/)/iu);
  });

});

describe('unsafeFindings — 検算器自身が効いている(壊した出力を渡すと鳴る)', () => {
  const broken: readonly (readonly [string, string])[] = [
    ['許可リストに無い要素', '<p>x</p><script>alert(1)</script>'],
    ['画像', '<p><img src="https://example.org/a.png"></p>'],
    ['許可リストに無い属性', '<p onclick="x">a</p>'],
    ['style 属性', '<p style="color:red">a</p>'],
    ['target', '<a href="https://example.org/" target="_blank" rel="noopener noreferrer">a</a>'],
    ['javascript: の href', '<a href="javascript:alert(1)" rel="noopener noreferrer">a</a>'],
    ['相対の href', '<a href="/x" rel="noopener noreferrer">a</a>'],
    ['rel の欠け', '<a href="https://example.org/" rel="noopener">a</a>'],
    ['class が言語の印でない', '<code class="x onclick">a</code>'],
    ['開始番号が数字でない', '<ol start="x">'],
    ['要素の外の <', '<p>1 < 2</p>'],
    ['閉じ要素に属性', '<p>x</p onclick="x">'],
  ];

  it.each(broken)('%s', (_name, html) => {
    expect(unsafeFindings(html)).not.toEqual([]);
  });

  it('安全な出力では鳴らない', () => {
    expect(unsafeFindings('<p>a <a href="https://example.org/" rel="noopener noreferrer">b</a></p><ol start="3"><li>c</li></ol><pre><code class="language-ts">x</code></pre>')).toEqual([]);
  });
});

describe('renderMarkdown — 生の HTML と危ない URL の具体的な出力', () => {
  it('生の HTML(script・イベント属性・画像・iframe・style・form)は文字ごと消える', () => {
    const html = renderMarkdown(
      [
        'こんにちは',
        '<script>alert(1)</script>',
        '<b onclick="x()">太字</b>',
        '![代替](https://example.org/a.png)',
        '<img src=x onerror="alert(2)">',
        '<iframe src="https://evil.example"></iframe>',
        '<style>body{display:none}</style>',
        '<form action="/x"><input></form>',
      ].join('\n\n'),
    );

    expect(html).toContain('こんにちは');
    expect(html).not.toContain('alert(');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('example.org/a.png');
    expect(html).not.toMatch(/<(script|img|iframe|style|form|input)/u);
  });

  it('javascript など許していない綴りの URL は href ごと(アンカーごと)落ち、文字だけが残る(大文字まじりも)', () => {
    const html = renderMarkdown('[a](javascript:alert(1)) [b](JaVaScRiPt:alert(2)) [c](vbscript:x) [d](data:text/html,x)');

    expect(html.toLowerCase()).not.toMatch(/javascript:|vbscript:|data:/u);
    expect(html).not.toContain('href');
    expect(html).not.toContain('<a');
    expect(html).toBe('<p>a b c d</p>');
  });

  it('http / https の絶対 URL 以外のリンク(相対・プロトコル相対・フラグメント・mailto・ユーザー名つき)は文字だけにする', () => {
    expect(renderMarkdown('[内](/pages/about) [連絡](mailto:a@example.org) [先](//evil.example/) [上](#top) [偽](https://a@evil.example/)')).toBe(
      '<p>内 連絡 先 上 偽</p>',
    );
  });

  it('生の HTML の要素は外れ、間の文字(alert(1) はただの文字)だけが残る', () => {
    expect(renderMarkdown('<b onclick="x()">太字</b>と<script>alert(1)</script>')).toBe('<p>太字とalert(1)</p>');
  });
});

describe('renderMarkdown — ふつうの Markdown', () => {
  it('段落・強調・コード・リスト・引用・区切り線を HTML にし、見出しは 1 段下げる', () => {
    expect(renderMarkdown('本文に*強調*と**太字**と`code`')).toBe('<p>本文に<em>強調</em>と<strong>太字</strong>と<code>code</code></p>');

    const html = renderMarkdown('# 一\n\n## 二\n\n###### 六\n\n- あ\n- い\n\n1. 一\n2. 二\n\n> 引用\n\n---');
    // 本文の見出しはページの h1 と並ばないよう 1 段下がる(h6 は動かない)。
    expect(html).toContain('<h2>一</h2>');
    expect(html).toContain('<h3>二</h3>');
    expect(html).toContain('<h6>六</h6>');
    expect(html).not.toContain('<h1');
    for (const tag of ['<ul>', '<ol>', '<blockquote>', '<hr>']) expect(html).toContain(tag);
  });

  it('安全なリンクは rel="noopener noreferrer" を持ち、target を持たない(外部も同じタブ)', () => {
    const html = renderMarkdown('[外](https://example.org/x) [別](http://example.org/y?a=1&b=2)');

    expect(html.match(/rel="noopener noreferrer"/gu)).toHaveLength(2);
    expect(html).toContain('href="https://example.org/x"');
    expect(html).toContain('href="http://example.org/y?a=1&#x26;b=2"');
    expect(html).not.toContain('target=');
  });

  it('リンクの href は safeHttpUrl が正規化した綴りで出る(ホストは小文字・空のパスは / )', () => {
    expect(renderMarkdown('[a](https://Example.org)')).toBe('<p><a href="https://example.org/" rel="noopener noreferrer">a</a></p>');
    // 大文字のスキームは許可リスト(小文字の http / https)に合わず、リンクにならない(迷ったら restrictive)。
    expect(renderMarkdown('[a](HTTPS://example.org/)')).toBe('<p>a</p>');
  });

  it('HTML として特別な字はエスケープされる', () => {
    expect(renderMarkdown('1 < 2 & "3"')).toBe('<p>1 &#x3C; 2 &#x26; "3"</p>');
  });

  it('番号つきリストの開始番号とフェンスコードの言語の印は残る(それ以外の属性は無い)', () => {
    expect(renderMarkdown('3. a\n4. b')).toBe('<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>');
    expect(renderMarkdown('```ts\nconst a = 1;\n```')).toBe('<pre><code class="language-ts">const a = 1;\n</code></pre>');
    expect(renderMarkdown('```js" onclick="alert(1)\nx\n```')).toBe('<pre><code>x\n</code></pre>');
  });

  it('空の本文は空文字', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('   \n\n  ')).toBe('');
  });
});

describe('renderMarkdown — 画像だけのリンクは空のアンカーを残さない', () => {
  it('画像だけのリンクは落ち、文字のあるリンクは文字を残す', () => {
    const imageOnly = renderMarkdown('前 [![代替](https://example.org/a.png)](https://example.org/x) 後');
    const withText = renderMarkdown('[![代替](https://example.org/a.png) 説明](https://example.org/x)');
    const emptyLabel = renderMarkdown('[](https://example.org/x)');

    expect(imageOnly).toBe('<p>前  後</p>');
    expect(emptyLabel).not.toContain('<a');
    expect(withText).toContain('<a href="https://example.org/x" rel="noopener noreferrer"> 説明</a>');
    expect(imageOnly).not.toContain('<a');
  });
});

describe('renderMarkdown / plainTextOf — 病的な本文でも例外を投げない', () => {
  // 本文の上限は欄の max_length(8,000 字)。その内側で木の再帰(ライブラリ側を含む)が深くなる形。
  const NESTED_QUOTES = '>'.repeat(5000) + 'x';

  it('引用を 5,000 段重ねても描画は例外を投げず、素の文の段落に縮退する(HTML は生まない)', () => {
    const html = renderMarkdown(NESTED_QUOTES);

    expect(html).toBe(`<p>${'&gt;'.repeat(5000)}x</p>`);
    expect(html).not.toContain('<blockquote');
  });

  it('縮退でも HTML の特別な字はエスケープされ、空行で段落が分かれる', () => {
    const html = renderMarkdown('>'.repeat(5000) + '<script>alert("x")</script>\n行\n\n\n次');

    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;<br>行</p><p>次</p>');
    expect(unsafeFindings(html.replaceAll('<br>', '<br>'))).toEqual([]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-MD-003
  it('解釈の長さの天井を超える本文は解釈せず素の文で出す(要素は p と br だけ)', () => {
    const body = `# 見出し\n\n[x](https://example.org) <script>alert(1)</script>\n\n${'あ'.repeat(MARKDOWN_RENDER_LIMIT)}`;
    const html = renderMarkdown(body);

    expect(html.startsWith('<p># 見出し</p><p>[x](https://example.org) &lt;script&gt;')).toBe(true);
    expect(html).not.toContain('<h');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('<script');
  });

  it('同じ本文から素の文を取っても例外を投げない', () => {
    const text = plainTextOf(NESTED_QUOTES, 120);

    expect(Array.from(text).length).toBeLessThanOrEqual(120);
    expect(Array.from(plainTextOf('あ'.repeat(MARKDOWN_RENDER_LIMIT + 1), 120)).length).toBeLessThanOrEqual(120);
  });

  // 天井の根拠(性能): 悪い入力は解釈の時間が長さの 2 乗に近く伸びる(`*a_` の繰り返しは 15,000 字で約 1.8 秒・20,000 字で約 3 秒・50,000 字で約 20 秒)。
  // 天井ちょうどの長さの悪い入力が、実測(約 0.5 秒以下)の約 10 倍の枠に収まることを見る。枠は計装下・負荷時の遅さで落ちない広さにしてあり、
  // 天井を 50,000 に戻す・解釈が 2 乗以上に悪化する変更は(桁が違うので)この枠を破る。
  //
  // **枠は CPU 時間で測る**(点検 19 回目 C19-4 の付記)。見たいのは解釈の計算量(長さの 2 乗の伸び)であり、壁時計は機械の混み具合も一緒に
  // 測る —— 全段の検査を並べた負荷 25(10 コア)の下で、CPU 時間は同じでも壁時計が 5,158〜5,161 ms になって枠を破った(実測 fwa-commit5)。
  // 解釈は同期の計算で、vitest の worker は子のプロセス(pool: forks)なので、`process.cpuUsage()` の差はこの解釈の CPU 時間になる
  // (worker が thread だと他のテストの CPU が混ざるので、その前提を見張る)。枠の数は 5,000 ms から 30,000 ms に広げた(kaninabe の CI: `vitest --coverage` の計装下の GitHub runner で `*a_` が CPU 11.4 秒になり 10,000 を破った。計装なし・手元の Linux で 2.1 秒、計装下で 5.1 秒。天井を 50,000 に戻す悪化は計装下で 100 秒を超えるので、30,000 でも桁の違いは見張れる。機械に依らない形(長さを 2 倍にしたときの CPU 時間の比)への置き換えは docs/known-gaps.md の 16)。
  describe('天井の長さの最悪ケースが時間の枠に収まる', () => {
    const BUDGET_MS = 30_000;
    /** 同期の処理が使った CPU 時間(ミリ秒。user + system)。 */
    const cpuMs = (run: () => void): number => {
      const before = process.cpuUsage();
      run();
      const used = process.cpuUsage(before);
      return (used.user + used.system) / 1000;
    };

    it('測り方の前提: worker は子のプロセス(CPU 時間が他のテストと混ざらない)', () => {
      expect(isMainThread).toBe(true);
    });
    const at = (unit: string): string => unit.repeat(Math.ceil(MARKDOWN_RENDER_LIMIT / unit.length)).slice(0, MARKDOWN_RENDER_LIMIT);

    it('天井は 10,000 字以下(性能の実測で決めた値。広げるときは最悪ケースを測り直す)', () => {
      expect(MARKDOWN_RENDER_LIMIT).toBeLessThanOrEqual(10_000);
    });

    it.each([
      ['`*a` の繰り返し', at('*a')],
      ['`*a_` の繰り返し', at('*a_')],
      ['`>` の繰り返し(引用の深い入れ子)', at('>')],
      ['`> ` の繰り返し', at('> ')],
      ['箇条書きの長い並び', at('- a\n')],
      ['リンクの長い並び', at('[a](https://example.org/x) ')],
      ['参照リンクの長い並び', at('[a][b] ')],
    ])('%s', (_name, body) => {
      expect(body).toHaveLength(MARKDOWN_RENDER_LIMIT);
      const results: unknown[] = [];
      const used = cpuMs(() => {
        results.push(renderMarkdown(body), plainTextOf(body, 120));
      });
      expect(results.map((result) => typeof result)).toEqual(['string', 'string']);
      expect(used).toBeLessThan(BUDGET_MS);
    });

    it('天井を超える本文は解釈しないので、悪い入力でも即座に返る', () => {
      const body = '*a_'.repeat(MARKDOWN_RENDER_LIMIT);
      const used = cpuMs(() => {
        renderMarkdown(body);
        plainTextOf(body, 120);
      });
      expect(used).toBeLessThan(1_000);
    });
  });
});

describe('plainTextOf', () => {
  it('記法を剥がして段落をまたいでも 1 本の文にし、生の HTML と画像は文字にしない', () => {
    expect(plainTextOf('# 見出し\n\n本文に**太字**と[リンク](https://example.org)と`code`。\n\n- 一つめ\n- 二つめ', 120)).toBe(
      '見出し 本文に太字とリンクとcode。 一つめ 二つめ',
    );
    expect(plainTextOf('前\n\n<script>alert(1)</script>\n\n![代替](https://example.org/a.png)\n\n後', 120)).toBe('前 後');
    expect(plainTextOf('一行目  \n二行目', 120)).toBe('一行目 二行目');
  });

  it('長いときは上限の字数(… を含む)に収め(サロゲートペアを割らない)、文字が無ければ空文字', () => {
    const text = plainTextOf('𠮷'.repeat(130), 120);

    expect(Array.from(text)).toHaveLength(120);
    expect(text.endsWith('…')).toBe(true);
    expect(plainTextOf('あ'.repeat(120), 120)).toBe('あ'.repeat(120));
    expect(plainTextOf('  \n\n', 120)).toBe('');
    expect(plainTextOf('<div></div>', 120)).toBe('');
  });
});

describe('excerptOf', () => {
  it('空白をたたんで上限に収める', () => {
    expect(excerptOf('  a \n\n b\tc ', 10)).toBe('a b c');
    expect(excerptOf('あいうえお', 3)).toBe('あい…');
  });
});

describe('MarkdownView', () => {
  it('本文を renderMarkdown の出力そのものとして載せる(包みの class だけを持つ)', () => {
    const element = MarkdownView({ value: '**a** <script>x</script>', className: 'prose' });

    expect(element?.type).toBe('div');
    expect(element?.props).toEqual({ className: 'prose', dangerouslySetInnerHTML: { __html: '<p><strong>a</strong> x</p>' } });
  });

  it('class が無ければ props に className を持たない', () => {
    expect(Object.keys(MarkdownView({ value: 'a' })?.props ?? {})).toEqual(['dangerouslySetInnerHTML']);
  });

  it('値が無い・空なら何も描かない', () => {
    expect(MarkdownView({ value: null })).toBeNull();
    expect(MarkdownView({ value: undefined })).toBeNull();
    expect(MarkdownView({ value: '' })).toBeNull();
  });
});
