/**
 * 「どのブロックにも属さない標識」の検査(`generate` のエラー)。
 *
 * `code-examples.ts` の「未参照の印」と同じ形である。印を消したら鳴り、章が参照していなければ鳴る。
 * ここでは 2 つの向きを見る:
 *
 * - **属さない標識** — 手書きの標識か判断ポイントを持つ仕様ファイルが、どのブロックにも割り付かない
 *   (`blockOf` が null)。母集合から外すと宣言したファイル(案内・雛形・用語の台帳)は数えない。
 *   外した理由は `chapter-files.ts` の宣言に書いてある
 * - **章が出していない標識** — ブロックに割り付いて標識を持つのに、割り付け先の章がその引用を
 *   出していない(章の生成器が引用を書き忘れた・章そのものが生成されていない)。見るのは HTML の章(`htmlPageOf`)の本文で、
 *   引用の頭の行の印(`signMarkerTag`)を探す
 *
 * どちらも**基線なしで 0 件**である。標識は人が書いた判断の記録なので、レビューの動線から
 * 落ちたまま黙っていることを許さない。純粋関数で、`generate` の CLI が結果を印字して止める。
 */

import type { SpecModel } from '../../../model/types.js';
import type { GeneratedSection, GenerateContext } from '../../../gen-kit/generator.js';
import { collectSigns } from '../../prose.js';
import { collectLedgerEntries } from '../semantic-review-counts.js';
import { signMarkerTag } from './html/layer-chapter.js';
import { bookLayout } from './face-scope.js';
import { blockOf, EXEMPT_KIND_NAMES, exemptionOf, exemptKindOf, type ExemptKind } from './chapter-files.js';

/** 標識の置き場の問題 1 件。 */
export interface BlockProblem {
  /** 何が問題か(1 文)。 */
  readonly message: string;
  /** 対処(どう直すか)。 */
  readonly suggestion: string;
  /** 該当の仕様ファイル。 */
  readonly file: string;
}

/**
 * 標識の置き場の問題を全部返す(0 件なら空配列)。
 *
 * @param model ドメイン仕様全体
 * @param ctx 生成コンテキスト(`specSources` に仕様の木の全ファイルが載っていること)
 * @param chapters 章ページのファイル → 生成した本文(全体を生成する章だけ。引用の有無を見る)
 */
export function blockProblems(
  model: SpecModel,
  ctx: GenerateContext,
  chapters: ReadonlyMap<string, string>,
): BlockProblem[] {
  const sources = ctx.specSources ?? new Map<string, string>();
  const layout = bookLayout(model, ctx);
  const decls = new Map(collectLedgerEntries(model, ctx).map((entry) => [entry.file, entry.declCount]));
  const files = new Set([...sources.keys(), ...decls.keys()]);
  const problems: BlockProblem[] = [];
  for (const file of [...files].sort()) {
    const source = sources.get(file) ?? '';
    if (exemptionOf(file, source) !== null) continue;
    const signs = collectSigns(source).length;
    const block = blockOf(file, model, ctx.roots, layout);
    if (block === null) {
      if (signs > 0 || (decls.get(file) ?? 0) > 0) {
        problems.push({
          file,
          message: `${file} の標識 ${signs} 本・判断ポイント ${decls.get(file) ?? 0} 件が、どのブロックにも属していません`,
          suggestion:
            'blockOf(chapter-files.ts)にこのファイルの章と節を足す。標識を数える母集合から外すなら、' +
            '外す種類と理由を exemptionOf に宣言する(ファイルの一覧は持たない)',
        });
      }
      continue;
    }
    if (signs === 0) continue;
    const page = htmlPageOf(block.chapter);
    if (chapters.get(page)?.includes(signMarkerTag(file, signs)) !== true) {
      problems.push({
        file,
        message: `${file} の標識 ${signs} 本を、章 ${page}(節「${block.section}」)が出していません`,
        suggestion:
          'その章の HTML の組み立てで signFold(file, ctx, 章のファイル)を呼ぶ(html/layer-chapter.ts)。章が生成されていないなら、' +
          '章立て(bookChapters)と HTML の生成器(html/generator.ts)に足す',
      });
    }
  }
  return problems;
}

/** 章の識別(章立ての `.md` の名前)から、書き出す HTML のページを引く(同じ場所・拡張子だけが違う)。 */
export function htmlPageOf(chapter: string): string {
  return chapter.replace(/\.md$/, '.html');
}

/**
 * 生成した全セクションから、標識の置き場の問題を返す(`blockProblems` の入口)。
 *
 * 章の本文(全体を生成するセクション = `wholeFile`)だけを集めて `blockProblems` に渡す。
 * `generate` の CLI と通し実行のハーネスが**同じ組み立て**を呼ぶための 1 本で、組み立てを 2 か所に書かない。
 *
 * @param byFile ファイル → そのファイルに書くセクション(全生成器の出力をファイルごとにまとめたもの)
 * @param model ドメイン仕様全体
 * @param ctx 生成コンテキスト(`specSources` に仕様の木の全ファイルが載っていること)
 */
export function placementProblemsOf(
  byFile: ReadonlyMap<string, readonly Pick<GeneratedSection, 'content' | 'wholeFile'>[]>,
  model: SpecModel,
  ctx: GenerateContext,
): BlockProblem[] {
  const chapterTexts = new Map<string, string>();
  for (const [file, sections] of byFile) {
    for (const section of sections) if (section.wholeFile === true) chapterTexts.set(file, section.content);
  }
  return blockProblems(model, ctx, chapterTexts);
}

/**
 * 標識を数える母集合から外したファイルの本数を、`generate` の出力 1 行にする(外した種類ごとの標識の本数)。
 * 外す種類は宣言(`exemptionOf`)で決まる。ここで数を見せるのは、免除が増えたときに人の目に付くためである。
 *
 * @param ctx 生成コンテキスト(`specSources` に仕様の木の全ファイルが載っていること)
 */
export function exemptionSummary(ctx: GenerateContext): string {
  const counts = new Map<ExemptKind, { files: number; signs: number }>();
  for (const [file, source] of ctx.specSources ?? new Map<string, string>()) {
    const kind = exemptKindOf(file, source);
    if (kind === null) continue;
    const entry = counts.get(kind) ?? { files: 0, signs: 0 };
    counts.set(kind, { files: entry.files + 1, signs: entry.signs + collectSigns(source).length });
  }
  const parts = (Object.keys(EXEMPT_KIND_NAMES) as ExemptKind[]).map((kind) => {
    const entry = counts.get(kind) ?? { files: 0, signs: 0 };
    return `${EXEMPT_KIND_NAMES[kind]} ${entry.files} 枚・標識 ${entry.signs} 本`;
  });
  return `標識を数える母集合から外した宣言: ${parts.join(' / ')}`;
}
