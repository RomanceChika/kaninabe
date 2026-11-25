/**
 * markdown-links(構文木によるリンクの抽出)のテスト。
 * 対象の要求: リンク・画像・参照の定義の行き先を読み、外部・アンカーだけ・コードの中・コメントの中・
 * AUTO-GENERATED ブロックの中・フロントマターの中は読まないこと。行番号はファイル先頭からの 1 始まり。
 * 正規表現では誤る形(入れ子の括弧・山括弧つきの行き先・エスケープ)は表で固定する。
 */

import { describe, expect, it } from 'vitest';
import { extractLinks } from '../../../../lib/model/docs/markdown-links.js';

/** 読んだ行き先だけ。 */
function hrefs(source: string): string[] {
  return extractLinks(source).map((link) => link.href);
}

describe('extractLinks 読む形(正例)', () => {
  const cases: ReadonlyArray<[string, string, string[]]> = [
    ['インラインのリンク', '[a](./a.md)\n', ['./a.md']],
    ['アンカー付き(アンカーごと返す)', '[a](./a.md#節)\n', ['./a.md#節']],
    ['画像', '![図](./diagram.png)\n', ['./diagram.png']],
    ['参照の定義(使われ方に依らず定義の行き先を読む)', '[r]: ./ref.md\n', ['./ref.md']],
    ['参照リンクと定義', '[x][r]\n\n[r]: ./ref.md "題"\n', ['./ref.md']],
    ['先頭が /(サイトルート)', '[a](/rules/README.md)\n', ['/rules/README.md']],
    ['先頭が ../', '[a](../up.md)\n', ['../up.md']],
    ['山括弧つきの行き先(空白を含む)', '[a](<./a b.md>)\n', ['./a b.md']],
    ['入れ子の括弧', '[a](./x(1).md)\n', ['./x(1).md']],
    ['タイトル付き', '[a](./a.md "題")\n', ['./a.md']],
    ['見出しの中', '## 9. 防衛線(→ [詳細](./guards.md))\n', ['./guards.md']],
    ['リストと引用の中', '- [a](./a.md)\n> [b](./b.md)\n', ['./a.md', './b.md']],
    ['表の行の中(表の記法を解かなくても段落のリンクとして読む)', '| a | b |\n|---|---|\n| [x](./x.md) | y |\n', ['./x.md']],
    ['リンクの中の画像(両方)', '[![図](./i.png)](./a.md)\n', ['./a.md', './i.png']],
    ['出現順', '[b](./b.md) [a](./a.md)\n', ['./b.md', './a.md']],
    ['コードの外の同じ形は読む', '`x` [a](./a.md)\n', ['./a.md']],
  ];

  it.each(cases)('%s', (_name, source, expected) => {
    expect(hrefs(source)).toEqual(expected);
  });
});

describe('extractLinks 読まない形(負例)', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['http', '[a](http://example.com/a)\n'],
    ['https', '[a](https://example.com/a)\n'],
    ['mailto', '[a](mailto:a@example.com)\n'],
    ['scheme 相対(//)', '[a](//example.com/a)\n'],
    ['ページ内のアンカーだけ', '[a](#節)\n'],
    ['空の行き先', '[a]()\n'],
    ['自動リンク(外部)', '<https://example.com>\n'],
    ['外部の参照の定義', '[r]: https://example.com/a\n'],
    ['定義の無い参照リンク(行き先が無い)', '[x][nowhere]\n'],
    ['フェンス付きコードの中', '```md\n[a](./in-fence.md)\n```\n'],
    ['チルダのフェンスの中', '~~~\n[a](./in-fence.md)\n~~~\n'],
    ['インラインコードの中', '`[a](./in-inline.md)`\n'],
    ['二重バッククォートのコードの中', '`` [a](./in-inline.md) ``\n'],
    ['インデントのコードブロックの中', 'text\n\n    [a](./in-indent.md)\n'],
    ['HTML コメントの中(1 行)', '<!-- [a](./in-comment.md) -->\n'],
    ['HTML コメントの中(複数行)', '<!--\n[a](./in-comment.md)\n-->\n'],
    ['バックスラッシュで打ち消した括弧', '[a]\\(./escaped.md)\n'],
    ['AUTO-GENERATED ブロックの中', '<!-- AUTO-GENERATED:x -->\n[a](./gen.md)\n<!-- /AUTO-GENERATED:x -->\n'],
    ['フロントマターの中', '---\nref: "[a](./in-front.md)"\n---\n'],
  ];

  it.each(cases)('%s', (_name, source) => {
    expect(hrefs(source)).toEqual([]);
  });
});

describe('extractLinks 境界', () => {
  it('AUTO-GENERATED ブロックの前後のリンクは読む', () => {
    const source = [
      '[前](./before.md)',
      '',
      '<!-- AUTO-GENERATED:x -->',
      '[生成](./generated.md)',
      '<!-- /AUTO-GENERATED:x -->',
      '',
      '[後](./after.md)',
    ].join('\n');

    expect(hrefs(source)).toEqual(['./before.md', './after.md']);
  });

  it('行番号はフロントマターを含めたファイル先頭からの 1 始まりで付く', () => {
    const source = '---\na: 1\n---\n\n[x](./a.md)\n\n[r]: ./ref.md\n';

    expect(extractLinks(source)).toEqual([
      { href: './a.md', line: 5 },
      { href: './ref.md', line: 7 },
    ]);
  });

  it('閉じていないフロントマターは本文として読む(閉じ区切りの検査は M1 の持ち場)', () => {
    expect(hrefs('---\n[a](./a.md)\n')).toEqual(['./a.md']);
  });

  it('空のソースからは何も読まない', () => {
    expect(extractLinks('')).toEqual([]);
  });
});
