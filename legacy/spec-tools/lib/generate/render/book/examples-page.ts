/**
 * 「書き方の例」の章(docs/book/examples.html)の生成器。
 *
 * 独自記法(5 形の設定・query の写像・screen の testid・保証の見張りテスト・通知の 3 行 …)の
 * 「書き方の例」を 1 か所に集める。**手で写さない** —— 実コードに置いた印(`// #region example:…`)と
 * 仕様 md の見出しアンカーから、この生成器が毎回切り出す。索引・題材・繋ぎの文は
 * examples-page-catalog*.ts が持ち、抜粋そのものの解決と検査(未解決の印・40 行上限)は
 * examples-page-render.ts が持つ。規約の正: code-examples.md。
 *
 * 未解決の印・上限超過があれば `resolveExamples` が例外を投げ(HTML 版 `html/examples-chapter.ts` も同じ解決を読む)、
 * `npm run generate` / `generate:check` をそのまま落とす(この章だけの生成エラー)。
 */

import type { SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { exampleCategories } from './examples-page-catalog.js';
import { exampleCategoriesRest } from './examples-page-catalog-rest.js';
import { resolveExamples, type ResolvedCategory } from './examples-page-render.js';
import { type Segment } from './text-segments.js';
import { generatedFileTexts } from './examples-page-overlay.js';
import { hasExamplesChapter, scanExampleSourceFiles } from '../code-examples.js';

/** 規約(コード例の書き方)のファイルへの href(本の置き場 `docs/book/` からの相対。HTML も同じ階層に置く)。 */
export const CODE_EXAMPLES_HREF = '../rules/process/common/tooling/standards/code-examples.md';

/** ページの導入(定型)。規約へのリンクが文の途中に入る。 */
export const EXAMPLES_LEAD: readonly Segment[] = [
  'このシステム独自の記法(5 形の設定・query の写像・screen の testid・保証の見張りテスト・通知の 3 行 …)は、' +
    '規約を読むだけでは「結局どう書くか」が像を結びにくい。ここに並ぶ例はすべて**実コード・実仕様からの抜粋**であり、' +
    '手で書き写したものは 1 行も無い —— 実コードに置いた印(`// #region example:…`)と仕様 md の見出しから、' +
    '`npm run generate` のたびにこの生成器が切り出す。索引は CLAUDE.md のルーティング表と同じ並び(' +
    'タスク種別ごと)にしてある。**印の文法・1 例 40 行上限の理由**は',
  { label: 'code-examples.md', to: 'code-examples' },
  ' が正。',
];

/** 章の題。 */
export const EXAMPLES_TITLE = '書き方の例';

/**
 * 章の抜粋を実ファイルから解決する(共有のものを読む)。
 * action_spec を読めていない環境・印が 1 つも置かれていない環境では null(章を生成しない)。未解決の印・上限超過は例外(`resolveExamples`)。
 *
 * @param model ドメイン仕様全体
 * @param ctx 生成コンテキスト
 */
export function resolvedExamples(model: SpecModel, ctx: GenerateContext): readonly ResolvedCategory[] | null {
  // 抜粋の起点(生成対象のリポジトリ)が無い、または印が 1 つも置かれていなければこの章は
  // 生成しない —— 例は**そのリポジトリの実コード**からしか採れないので、印の無いリポジトリに
  // 他所のコードを載せない(束 ⑲-1 #4)。判定は表紙の章立てと同じ述語である。
  if (!hasExamplesChapter(ctx) || ctx.repoRoot === undefined) return null;
  const sourceFiles = scanExampleSourceFiles(ctx.repoRoot, ctx.roots, ctx.layout);
  // 生成ブロックの中の見出しを指す抜粋は、この回の生成結果を当てた本文から引く(ディスクは前回の結果で、
  // 見出しを直した回に章が見出しを見失って、生成が 1 回で揃わない)。
  const generatedTexts = generatedFileTexts(model, ctx);
  return resolveExamples(
    [...exampleCategories(ctx.roots, ctx.layout), ...exampleCategoriesRest(ctx.roots, ctx.layout)],
    ctx.repoRoot,
    sourceFiles,
    generatedTexts,
  );
}
