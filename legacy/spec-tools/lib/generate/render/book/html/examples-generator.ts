/**
 * 書き方の例の章(`examples.html`)の生成器。
 *
 * この章だけは入力が仕様モデルではなく**リポジトリの実ファイル**であり、抜粋を引けないことは仕様の問題ではなく鮮度エラーである(解決は
 * `examples-page.ts` の `resolvedExamples` を使う)。本の HTML の生成器(`generator.ts`)から分けて別の生成器にしているのは、実ファイルを読む
 * 生成器を 1 つずつ名指せるようにするため(置き場の配置を差し替える検査は、写し元が実在しない配置でこの種の生成器を外す)。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../../../gen-kit/generator.js';
import { bookFile } from '../chapters.js';
import { resolvedExamples } from '../examples-page.js';
import { EXAMPLES_TITLE, examplesChapter } from './examples-chapter.js';
import { BOOK_TITLE } from './generator.js';
import { renderPage } from './page.js';

export const bookHtmlExamplesGenerator: DocGenerator = {
  id: 'book-html-examples',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    // action_spec を読めていない環境・印が 1 つも無い環境では出さない。
    const examples = resolvedExamples(model, ctx);
    if (examples === null) return [];
    const chapter = examplesChapter(examples);
    return [
      {
        file: bookFile(ctx.roots, 'examples.html'),
        content: renderPage({ file: 'examples.html', title: EXAMPLES_TITLE, bookTitle: BOOK_TITLE, body: chapter.body, headings: chapter.headings, modes: true }),
        wholeFile: true,
      },
    ];
  },
};
