/**
 * ハンドブックの無害化の無作為検査(Vue の構文木とコンパイルで判定する)の語彙と乱数。
 * 語彙は敵対的な仕様の文字列が使う道具: 記法の行頭・閉じていない / 余分な閉じの許可表のタグ・スロット・`<template>`。
 */

/** 乱数の種(固定。同じ種なら同じ文書の列)。 */
export const FUZZ_SEED = 20_261_019;

/** 第 2 の実行の既定の種(固定)。 */
const SECOND_SEED = 20_261_101;

/**
 * 赤になったことのある種の固定の反例集。無作為の検査は、毎回ここの種も回す。
 *
 * 種 517594764(点検 13 回目 C13-5): `<section>` が自動リンクの URL に飲まれて閉じタグだけが残り、Vue のコンパイルが落ちた(`.md` の経路。`book-sanitize-balance.ts` で直した)。
 * **足し方**: 取り込みの定型が赤になったら、その実行が出した種をここへ足し、直してから取り込む。
 */
export const COUNTEREXAMPLE_SEEDS: readonly number[] = [517_594_764];

/**
 * 第 2 の実行の種。**既定は固定**で、CI と pre-commit は固定のまま回る。取り込みの定型(`merge-check.sh`)だけが毎回新しい種を環境変数 `FUZZ_SEED` で渡して、その種を出力する。
 *
 * 通常の実行に乱数を入れると、無関係のコミットの CI がたまに赤になる(点検 13 回目 C13-5)。夜間の workflow は作らない。fast-check の種も同じ変数で決まる(`fast-check-seed.ts`)。
 *
 * @returns 32 ビットの整数
 */
export function variableSeed(): number {
  const fromEnvironment = Number(process.env['FUZZ_SEED'] ?? '');
  return Number.isInteger(fromEnvironment) && fromEnvironment > 0 ? fromEnvironment : SECOND_SEED;
}

/** 線形合同法の乱数(0 以上 1 未満)。 */
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/** 構造の行(行頭に置く記法)。 */
export const STRUCTURE: readonly string[] = [
  '', '', '', '```', '```', '~~~', '```js', ' ```', '  ```', '   ```', ' ~~~', '   ~~~', '    ```', '\t```', '````', '~~~~', '<pre>', '</pre>', '<pre>x</pre>', '<textarea>', '</textarea>',
  '<div>', '</div>', '<details>', '<table>', '<b>', '<b>x</b> ', '<span>', '<!--', '-->', '<!-- x -->', '<![CDATA[', '<?x', '<!X', '> ', '>> ', '- ', '* ', '1. ', '    ', '\t',
  '|a|b|', '|--|--|', '# ', '## T {#a}', '### T {#app}', '=====', '-----', '***', '[a]: http://x', '<Steps>', '<template #a>',
  '</Steps>', '<Fold kind="axiom">', '</Fold>', '<template #x>', '</template>', '<template v-slot:x>', '<template>', '</span>', '</b>', '<p>', '</p>', '<ul>', '</ul>', '<li>', '</li>',
  '<svg viewBox="0 0 1 1">', '</svg>', '<Grid>', '</Grid>',
  '<span class="a"', '<div', '>', '> x', '<b title="a', 'b">x</b>', '<span class="a"\n>x</span>', '<div\n>', '<b\n  class="a">x</b>',
  '```x"y', '~~~x"y', '```x\\"y', '```x"v-html="1"', '```\tx"y', '```x&#61;"y', '~~~ a"b', '> ```x"y', '- ```x"y', '  ```x\'y', '````x"y', '```x<y', '```js {1,3}"', '~~~~',
  '::: tip', '::: details', '::: v-pre', '::: code-group', ':::', '::::', '  :::', '> :::', '- ::: tip', '<template #default>', '<template #a>', '<Fold kind="x">',
];

/** 敵対的な行・断片。 */
export const HOSTILE: readonly string[] = [
  '{{ 1+1 }}', '{ v-html=1}', '{v-html=1}', '{#id}', '`{{ 1+1 }}`', '{&#123; 1 }}', '&#123;&#123; 1 &#125;&#125;', '<a href="//x">x</a>', '<img src=x onerror=1>', 'x{', '}}',
  '｛｛ 1 ｝｝', 'text', 'text', '&lt;script&gt;', '{{', '{ {', '{<!-- -->{ 1 }}', '{<b></b>{ 1+1 }}', '{<br>{ 1+1 }}', '}<b></b>}', '<a title="{{ 1 }}">x</a>', '<!-- {{ 1 }} -->',
  `<Steps :items='[1]&#34;'>`, `<Grid :cells='alert(1)'>`, '<script>alert(1)</script>', '<style>x</style>', '<a href="jav&#x61;script:1">x</a>', '`', '``', '\\`',
  '<div>', '</div>', '<div>x', 'x</div>', '<b><i>x</b></i>', '<Fold kind="x">y', 'y</Fold>', '<template #x>y</template>', '<template #x>', '</template>', '<Fold><template v-slot:x>y</template></Fold>',
  '<Fold kind="x"><template #a>y</template></Fold>', '<span>x</span>',
  '<span class="a" class="b">x</span>', '<b id="x" ID="y">z</b>', '<div hidden hidden>x</div>', '<a data-x="1" data-x="2">x</a>', '<span CLASS="a" class="b">x</span>', '<img src="a.png" src="b.png">',
  '<b>`x`</b>', '<b>`</b>', '`a|b`', '|`a|b`|', '<i>`', '`</i>',
  '::: tip', ':::', '<Fold kind="x"><template #a>y</template><template #a>z</template></Fold>', '<Fold kind="x"><template #default>y</template>text</Fold>', '<div #x>y</div>', '</Steps>', '<svg><path d="M0 0" /></svg>', '</svg>', '<p>', '</p></p>',
];

/** 「語の寄せ集め」の無作為な文書の語: 許可表のタグの開き・閉じ・部品・スロット・Markdown の記号・属性の記法・改行と空行。 */
export const SOUP_TOKENS: readonly string[] = (() => {
  const names = ['b', 'i', 'em', 'div', 'span', 'ul', 'li', 'p', 'a', 'table', 'tr', 'td', 'details', 'summary', 'Fold', 'Grid', 'Steps', 'template', 'svg', 'section', 'h2', 'code', 'small', 'dl', 'dt', 'dd'];
  const tokens: string[] = [];
  for (const name of names) tokens.push(`<${name}>`, `</${name}>`);
  tokens.push('<template #a>', '<template #b>', '<Fold kind="x">', '<a href="/x">', '<br>', '<br />', '<img src="a.png">', '<div class="c">');
  tokens.push(
    '\n', '\n', '\n', '\n\n', '\n\n', ' ', ' ', 'word', 'a_b', '_', '*', '**', '`', '``', '```', '~~~', '|', '\\', '[', ']', '(', ')', '[a](b)', '#', '# ', '> ', '- ', '1. ', '    ', '\t', '  ',
    'http://x.y/z', 'a.md', '&lt;', '&#60;', '<!--', '-->', '{{ 1 }}', '{', '}', '{ #app}', '{#app}', '{.a #app}', '{ #a #b}',
    '<span class="a"\n>', '<div\n>', '\n>', '<b\n', '<b title="x\ny">',
    '```x"y', '~~~x"y', '```x"v-html="1"', '```', '~~~',
    '<span class="a" class="b">', '<b id="x" ID="y">', '<div hidden hidden>', ':::', '::: tip\n', '\n::: details\n', '<template #default>', '<template #a>x</template>', '<template #a>', '---', '===', ':::', '!',
  );
  return tokens;
})();
