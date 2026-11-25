/**
 * ブロックごとの標識と判断ポイントの集計(章の合計も節ごとの数も手引きの数もここから出る)。
 *
 * ブロック = 章の 1 節と仕様ファイル 1 枚の組(`chapter-files.ts` の `blockOf`)。
 * 数えるものは 2 つで、**単位が違うので足さない**:
 *
 * - **標識** — 仕様ファイルの手書きの段落・箇条(`prose.ts`)。人が書いた判断の記録
 * - **判断ポイント** — 仕様の宣言から数えた、人が判断する場所(`semantic-review-counts.ts`)
 *
 * 以前は 2 つの数の出どころが別々で、章への割り付けも判断ポイントの側にしか無かったため、
 * 手書きの標識を持つのにどの章にも割り付かないファイル(テーブル仕様・ロール・外から届く surface・
 * ユースケース)の標識が、集計にも章にも出ていなかった。ここは**母集合を 1 つにする**:
 * 判断ポイントの台帳に載るファイルと、仕様の木にある標識を持つファイルの和である。
 *
 * 規約どおりファイル I/O はしない純粋関数である(仕様ファイルの生テキストは `specSources`)。
 */

import type { SpecModel } from '../../../model/types.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { RESULT_WORDS } from '../../../messages/messages-results.js';
import { collectSigns } from '../../prose.js';
import { collectLedgerEntries, type LedgerPart } from '../semantic-review-counts.js';
import { actionsPage, usecasesPage } from './chapters.js';
import { blockOf, exemptionOf } from './chapter-files.js';
import { bookLayout } from './face-scope.js';
import { resultReasonKindTotal, saveReasonKindTotal } from './results-section.js';
import { RESULT_SECTION } from './sections.js';

/** ブロック 1 つ分の集計(章の 1 節 × 仕様ファイル 1 枚)。 */
export interface BlockLoad {
  /** 章ページのファイル(リポジトリルート相対)。 */
  readonly chapter: string;
  /** 節の名前(`sections.ts`)。 */
  readonly section: string;
  /** 仕様ファイル(リポジトリルート相対)。結果表のように特定のファイルを持たないブロックは null。 */
  readonly file: string | null;
  /** 標識の本数(手書きの段落・箇条)。 */
  readonly signCount: number;
  /** 判断ポイントの数(宣言から数えたもの)。 */
  readonly declCount: number;
  /** 判断ポイントの内訳(0 件の部は含めない)。 */
  readonly parts: readonly LedgerPart[];
}

/**
 * 全ブロックの集計を返す。並びは判断ポイントの台帳の順(ドメイン → query → … → design_token)に、
 * 台帳に載らず標識だけを持つファイルが続き、最後に結果表のブロックが来る。
 *
 * どのブロックにも属さないファイルはここでは落とす(落としたものを見つけて止めるのは
 * `block-check.ts`)。母集合から外すと宣言したファイル(`exemptionOf`)も数えない。
 */
export function blockLoads(model: SpecModel, ctx: GenerateContext): BlockLoad[] {
  const sources = ctx.specSources ?? new Map<string, string>();
  const layout = bookLayout(model, ctx);
  const loads: BlockLoad[] = [];
  const seen = new Set<string>();
  for (const entry of collectLedgerEntries(model, ctx)) {
    seen.add(entry.file);
    const block = blockOf(entry.file, model, ctx.roots, layout);
    if (block === null) continue;
    loads.push({
      ...block,
      file: entry.file,
      signCount: collectSigns(sources.get(entry.file) ?? '').length,
      declCount: entry.declCount,
      parts: entry.parts,
    });
  }
  for (const [file, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
    if (seen.has(file) || exemptionOf(file, source) !== null) continue;
    const block = blockOf(file, model, ctx.roots, layout);
    const signCount = collectSigns(source).length;
    if (block === null || signCount === 0) continue;
    loads.push({ ...block, file, signCount, declCount: 0, parts: [] });
  }
  return [...loads, ...resultBlocks(model, ctx)];
}

/**
 * 結果表の ❌ の理由の種類(宣言の本数には現れない判断ポイント)。操作の章と、保存点を持つタスクの章に
 * ある。どちらも特定の仕様ファイルを持たないので、ファイルの無いブロックとして数える。
 */
function resultBlocks(model: SpecModel, ctx: GenerateContext): BlockLoad[] {
  const kinds: readonly [string, number][] = [
    [actionsPage(ctx.roots), resultReasonKindTotal(model, ctx)],
    [usecasesPage(ctx.roots), saveReasonKindTotal(model, ctx)],
  ];
  return kinds
    .filter(([, count]) => count > 0)
    .map(([chapter, count]) => ({
      chapter,
      section: RESULT_SECTION,
      file: null,
      signCount: 0,
      declCount: count,
      parts: [{ label: RESULT_WORDS.reasonKindsLabel, count }],
    }));
}
