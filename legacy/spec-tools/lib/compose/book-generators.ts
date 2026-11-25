/**
 * ハンドブック(人の唯一の入口。HTML)の各ページと、章が使う資材・結果表の元データを出す生成器の一覧。
 *
 * 本は HTML を直接書き出す(`book-html` が表紙・横断の章・集約の章・新しい形の章を、`book-html-examples` が書き方の例を書く。Markdown の本は出さない)。
 *
 * **この 1 本が「ハンドブックだけを出す」入口(`cli/generate-book.ts`)と全部入りの並び(`index.ts` の
 * `CORE_GENERATORS`)の両方の元**で、同じ並びを 2 か所に書かない(片方だけ章を足し忘れると、部分利用の入口が別の本を
 * 出す)。`CORE_GENERATORS` はここを同じ位置に展開するので、全体の出力の順序は変わらない。
 *
 * ここに並ぶ生成器の実行時の依存の閉包に SQL を作るファイル(`lib/sql/**`)と変異の層(`lib/mutation/**`)は
 * 入らない(`CLOSURE_BANS`。設計メモ framework-modules §11 / §13)。だから**この一覧だけを回す入口は、DDL・RLS・RPC 本文の
 * 生成器も変異の検出器も読み込まずに動く**。章が他の生成器の出力を読む形(生成器どうしの依存)は無い —— 生成器は
 * 文脈を受け取るだけで、互いの結果を渡し合わない。
 *
 * 新しい章を足すときは、生成器を作ってここに 1 行足す(全部入りの並びにも自動で入る)。
 */

import type { DocGenerator } from '../gen-kit/generator.js';
import { bookHtmlGenerator } from '../generate/render/book/html/generator.js';
import { bookHtmlExamplesGenerator } from '../generate/render/book/html/examples-generator.js';
import { bookAssetsGenerator } from '../generate/render/book/book-assets.js';
import { bookResultsDataGenerator } from '../generate/render/book/results-data.js';

/** ハンドブックの各ページ(HTML。丸ごと生成物)と、章が使う資材・結果表の元データを出す生成器。 */
export const BOOK_GENERATORS: readonly DocGenerator[] = [bookHtmlGenerator, bookHtmlExamplesGenerator, bookAssetsGenerator, bookResultsDataGenerator];
